import {
  createWalletClient,
  http,
  publicActions,
  Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, optimism } from "viem/chains";
import { parseUnits, stringify } from "viem/utils";
import dotenv from "dotenv";

// Load .env file
dotenv.config();

// ————— Account setup —————
const privateKey: Hex = (process.env.PRIVATE_KEY as Hex) || "0x";
const account = privateKeyToAccount(privateKey);

// ————— API key setup —————
const meeApiKey = process.env.MEE_API_KEY || "mee_3ZZmXCSod4xVXDRCZ5k5LTHg"; // Default MEE API key

// ————— Source chain config —————
const sourceChain = base;
const sourceChainId = sourceChain.id; // Base chain id
const sourceChainRpcUrl = process.env.SOURCE_CHAIN_RPC_URL; // Source chain RPC

// ————— Destination chain config —————
const destinationChain = optimism;
const destinationChainId = destinationChain.id;

// ————— Source Token config —————
const sourceTokenAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC token
const sourceTokenAmount = parseUnits("0.1", 6); // amount to send with 6 decimals for USDC token

// ————— Destination Token config —————
const destinationTokenAddress = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"; // USDC token

// ————— Client config —————
const client = createWalletClient({
  account,
  chain: sourceChain,
  transport: http(sourceChainRpcUrl),
}).extend(publicActions);

const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const extendedUpperBoundTimestamp = Math.floor(Date.now() / 1000) + 22 * 60; // 22 minutes execution window time to handle the large CCIP finality

const main = async () => {
  // ————— Build token withdrawal to EOA on destination chain —————
  const ccipFlow = {
    type: "/instructions/build-ccip",
    data: {
        srcChainId: sourceChainId,
        dstChainId: destinationChainId,
        srcToken: sourceTokenAddress,
        dstToken: destinationTokenAddress,
        amount: sourceTokenAmount
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
          constraints: { gte: 1n },
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
        amount: sourceTokenAmount
      },
    ],
    feeToken: {
      address: sourceTokenAddress,
      chainId: sourceChainId,
      gasRefundAddress: account.address,
    },
    upperBoundTimestamp: extendedUpperBoundTimestamp,
    composeFlows: [ccipFlow, withdrawFlow],
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

  if (quote.code === 400) {
    throw new Error(`Failed to fetch quote. Error: ${quote.message}`);
  }

  // ————— Sign the quote —————
  for (let i = 0; i < quote.payloadToSign.length; i++) {
    let signature = "0x";

    if (quote.quoteType === "simple") {
      signature = await client.signMessage({
        ...quote.payloadToSign[0],
        account
      });
    } else if (quote.quoteType === "permit") {
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
