export const ccipSendRequestedEvent =   {
    anonymous: false,
    inputs: [
      {
        components: [
          {
            internalType: "uint64",
            name: "sourceChainSelector",
            type: "uint64",
          },
          { internalType: "address", name: "sender", type: "address" },
          { internalType: "address", name: "receiver", type: "address" },
          { internalType: "uint64", name: "sequenceNumber", type: "uint64" },
          { internalType: "uint256", name: "gasLimit", type: "uint256" },
          { internalType: "bool", name: "strict", type: "bool" },
          { internalType: "uint64", name: "nonce", type: "uint64" },
          { internalType: "address", name: "feeToken", type: "address" },
          { internalType: "uint256", name: "feeTokenAmount", type: "uint256" },
          { internalType: "bytes", name: "data", type: "bytes" },
          {
            components: [
              { internalType: "address", name: "token", type: "address" },
              { internalType: "uint256", name: "amount", type: "uint256" },
            ],
            internalType: "struct Client.EVMTokenAmount[]",
            name: "tokenAmounts",
            type: "tuple[]",
          },
          { internalType: "bytes[]", name: "sourceTokenData", type: "bytes[]" },
          { internalType: "bytes32", name: "messageId", type: "bytes32" },
        ],
        indexed: false,
        internalType: "struct Internal.EVM2EVMMessage",
        name: "message",
        type: "tuple",
      },
    ],
    name: "CCIPSendRequested",
    type: "event",
  };