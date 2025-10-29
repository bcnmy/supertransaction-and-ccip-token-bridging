import {
  createWalletClient,
  http,
  zeroAddress,
  encodeAbiParameters,
  publicActions,
  erc20Abi,
  Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, optimism } from "viem/chains";
import { formatEther, parseUnits, stringify } from "viem/utils";
import { routerAbi } from "./abi/router-abi";
import {
  calculateTokenAmount,
  getTokenInfoByAddress,
  getTokenPriceUSDById,
} from "./helpers/token-utils";
import dotenv from "dotenv";

// Load .env file
dotenv.config();

// ————— Account setup —————
const privateKey: Hex = (process.env.PRIVATE_KEY as Hex) || "0x";
const account = privateKeyToAccount(privateKey);

// ————— API key setup —————
const meeApiKey = process.env.MEE_API_KEY || "mee_3ZZmXCSod4xVXDRCZ5k5LTHg"; // Default MEE API key
const coinmarketcapApiKey = process.env.COIN_MARKET_CAP_API_KEY || "";

// ————— Source chain config —————
const sourceChain = base;
const sourceChainId = sourceChain.id; // Base chain id
const routerAddress = "0x881e3A65B4d4a04dD529061dd0071cf975F58bCD"; // Base CCIP router
const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL; // Source chain RPC

// ————— Destination chain config —————
const destinationChain = optimism;
const destinationChainId = destinationChain.id;
const destinationChainSelector = 3734403246176062136n; // Optimism chain selector

// ————— Source Token config —————
const sourceTokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC token
const sourceTokenAmount = parseUnits("0.01", 6); // amount to send with 6 decimals for USDC token

// ————— Destination Token config —————
const destinationTokenAddress = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"; // USDC token
const minimumExpectedDestinationTokenAmount = parseUnits("0.01", 6); // amount to send with 6 decimals for USDC token
const extendedUpperBoundTimestamp = Math.floor(Date.now() / 1000) + 22 * 60; // 22 minutes

// ————— Client config —————
const client = createWalletClient({
  account,
  chain: sourceChain,
  transport: http(sourceChainRpcUrl),
}).extend(publicActions);

const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const main = async () => {
  // TODO: This needs to be fetched from getOrchestratorAddresses endpoint
  const orchestratorAddress = "0xC9540b320111bCBa149436533fc34Da9004b8bad";

  const receiverBytes = encodeAbiParameters(
    [{ type: "address" }],
    [orchestratorAddress]
  );

  // ————— Build CCIP message —————
  const message = {
    receiver: receiverBytes,
    data: "0x", // no extra payload
    tokenAmounts: [{ token: sourceTokenAddress, amount: sourceTokenAmount }],
    feeToken: zeroAddress, // native token payment for CCIP
    extraArgs: "0x", // default, no special args
  };

  const ETH_TOKEN_ID = 1027;
  const tokenId = await getTokenInfoByAddress(
    sourceTokenAddress,
    coinmarketcapApiKey
  );

  // ————— Get CCIP message fees and token rate infos —————
  const [
    tokenPrice,
    ethPrice,
    sourceTokenDecimals,
    ccipFee,
    orchestratorEthBalance,
  ] = await Promise.all([
    getTokenPriceUSDById(tokenId, coinmarketcapApiKey),
    getTokenPriceUSDById(ETH_TOKEN_ID, coinmarketcapApiKey),
    client.readContract({
      address: sourceTokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    client.readContract({
      address: routerAddress,
      abi: routerAbi,
      functionName: "getFee",
      args: [destinationChainSelector, message],
    }),
    client.getBalance({
      address: orchestratorAddress,
    }),
  ]);

  const ccipFeeAmountInEth = ccipFee as unknown as bigint;

  // If there is not enough ETH for CCIP fees ? Token swap will be done to get the eth for CCIP fees
  const isCCIPFeeSwapRequired = orchestratorEthBalance < ccipFeeAmountInEth;

  let swapFlow;
  let ccipTokenFees = 0n;

  if (isCCIPFeeSwapRequired) {
    // If there is any leftover funds, this will reuse those funds for CCIP fees
    const requiredEthFees = ccipFeeAmountInEth - orchestratorEthBalance;

    const tokensNeeded = calculateTokenAmount(
      formatEther(requiredEthFees),
      ethPrice.toString(),
      tokenPrice.toString()
    );

    ccipTokenFees = parseUnits(tokensNeeded, sourceTokenDecimals);
    ccipTokenFees = (ccipTokenFees * 105n) / 100n; // 5% buffer for slippage consideration

    // ————— Build token swap to pay for CCIP fees —————
    swapFlow = {
      type: "/instructions/intent-simple",
      data: {
        srcChainId: sourceChainId,
        dstChainId: sourceChainId,
        srcToken: sourceTokenAddress, // USDC
        dstToken: zeroAddress, // ETH
        amount: ccipTokenFees,
        slippage: 0.01,
      },
    };
  }

  // ————— Build token approval for CCIP router —————
  const approvalFlow = {
    type: "/instructions/build",
    data: {
      functionSignature: "function approve(address spender, uint256 value)",
      args: [routerAddress, sourceTokenAmount],
      to: sourceTokenAddress,
      chainId: sourceChainId,
    },
  };

  // ————— Build CCIP call to send the token across the chain via burn and mint —————
  const sendCCIPFlow = {
    type: "/instructions/build",
    data: {
      functionSignature:
        "function ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message)",
      args: [
        destinationChainSelector,
        [
          message.receiver,
          message.data,
          message.tokenAmounts.map((tokenAmountInfo) => [
            tokenAmountInfo.token,
            tokenAmountInfo.amount,
          ]),
          message.feeToken,
          message.extraArgs,
        ],
      ],
      to: routerAddress,
      chainId: sourceChainId,
      value: ccipFeeAmountInEth,
    },
  };

  // ————— Build token withdrawal to EOA on destination chain —————
  const withdrawFlow = {
    type: "/instructions/build",
    data: {
      functionSignature: "function transfer(address to, uint256 value)",
      args: [
        account.address,
        {
          type: "runtimeErc20Balance",
          tokenAddress: destinationTokenAddress,
          constraints: { gte: minimumExpectedDestinationTokenAmount },
        },
      ],
      to: destinationTokenAddress,
      chainId: destinationChainId,
    },
  };

  // ————— Compose and get quote —————
  const quoteRequest = {
    mode: "eoa",
    ownerAddress: account.address,
    fundingTokens: [
      {
        tokenAddress: sourceTokenAddress,
        chainId: sourceChainId,
        amount: sourceTokenAmount + ccipTokenFees, // If no swap required, ccipTokenFees will be zero here
      },
    ],
    feeToken: {
      address: sourceTokenAddress,
      chainId: sourceChainId,
      gasRefundAddress: account.address,
    },
    upperBoundTimestamp: extendedUpperBoundTimestamp,
    composeFlows: swapFlow
      ? [swapFlow, approvalFlow, sendCCIPFlow, withdrawFlow]
      : [approvalFlow, sendCCIPFlow, withdrawFlow],
  };

  const quoteResponse = await fetch("https://api.biconomy.io/v1/quote", {
    method: "POST",
    headers: {
      "X-API-Key": meeApiKey,
      "Content-Type": "application/json",
    },
    body: stringify(quoteRequest),
  });

  const quote = await quoteResponse.json();

  // ————— Sign the quote —————
  for (let i = 0; i < quote.payloadToSign.length; i++) {
    let signature = "0x";

    if (quote.quoteType === "permit") {
      signature = await client.signTypedData({
        ...quote.payloadToSign[0].signablePayload,
        account,
      });
    } else if (quote.quoteType === "onchain") {
      // Send approval transaction on-chain
      const approvalTxHash = await client.sendTransaction({
        to: quote.payloadToSign[0].signablePayload.to,
        data: quote.payloadToSign[0].signablePayload.data,
        value: quote.payloadToSign[0].signablePayload.value || 0n,
      });

      // Wait for confirmation
      await client.waitForTransactionReceipt({ hash: approvalTxHash });

      // Use txHash as signature
      signature = approvalTxHash;
    }

    quote.payloadToSign[i].signature = signature;
  }

  // ————— Execute quote —————
  const executeResponse = await fetch("https://api.biconomy.io/v1/execute", {
    method: "POST",
    headers: {
      "X-API-Key": meeApiKey,
      "Content-Type": "application/json",
    },
    body: stringify(quote),
  });

  // ————— View status in MEE explorer —————
  const {
    supertxHash,
    code,
    message: errorMessage,
  } = await executeResponse.json();

  if (code === 400) {
    throw new Error(errorMessage);
  }

  console.log(
    "Supertransaction link: ",
    `https://meescan.biconomy.io/details/${supertxHash}`
  );

  let ccipExplorerLinkPrinted = false;

  while (true) {
    const explorerResponse = await fetch(
      `https://network.biconomy.io/v1/explorer/${supertxHash}`,
      {
        method: "GET",
        headers: {
          "X-API-Key": meeApiKey,
          "Content-Type": "application/json",
        },
      }
    );

    const { userOps } = await explorerResponse.json();

    if (
      userOps[1].executionStatus === "MINED_SUCCESS" &&
      !ccipExplorerLinkPrinted
    ) {
      // ————— View CCIP status in CCIP explorer —————
      console.log(
        "CCIP explorer link: ",
        `https://ccip.chain.link/tx/${userOps[1].executionData}`
      );

      ccipExplorerLinkPrinted = true;
    }

    const isStxFinalized = userOps.every((userOp) =>
      ["MINED_FAIL", "FAILED", "MINED_SUCCESS"].includes(userOp.executionStatus)
    );

    // Sleep 1 seconds before checking for the status again
    await sleep(1000);

    if (isStxFinalized) {
      break;
    }
  }

  console.log("Supertransaction execution has been completed");
};

main().catch((err) => {
  console.error("Error sending supertransaction:", err);
});
