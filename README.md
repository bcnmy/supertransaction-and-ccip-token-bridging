# Supertransaction X CCIP Token bridging

This is a example repository which shows how the CCIP token bridging can be combined with Supertransaction to perform a complex cross chain orchestration with custom arbitrary instructions.

## Examples
There are two examples here
1. ccip-with-supertransaction.ts - CCIP token bridging support with supertransaction API. Not easy to integrate
2. native-ccip-with-supertransaction.ts - Native CCIP token bridging support with supertransaction API. Everything is handled by API and has a full integration with many chains.

## How to run the example

1. Copy the .env.example file as .env file and configure all the envs
2. Fund your EOA wallet with some USDC token on base chain
3. Install all the dependencies by `bun install`
4. Run the script by `bun run ccip-with-supertransaction.ts` or `bun run native-ccip-with-supertransaction.ts`

## How to customize the script
To customize the script to experiment bridging and orchestration for different chains and different tokens, please modify all the source chain and destination chain configs inside the index.ts file such as token addresses, router addresses, etc...