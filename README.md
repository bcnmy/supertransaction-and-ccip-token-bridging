# Supertransaction X CCIP Token bridging

This is a example repository which shows how the CCIP token bridging can be combined with Supertransaction to perform a complex cross chain orchestration with custom arbitrary instructions.

## How to run the example

1. Copy the .env.example file as .env file and configure all the envs
2. Fund your EOA wallet with some USDC token on base chain
3. Install all the dependencies by `bun install`
4. Run the script by `bun run index.ts`

## How to customize the script
To customize the script to experiment bridging and orchestration for different chains and different tokens, please modify all the source chain and destination chain configs inside the index.ts file such as token addresses, router addresses, etc...