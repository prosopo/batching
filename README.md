# Investigation into tx fees in ink! smart contracts

## Prerequisites

### Substrate node running on local machine

```bash
docker run -p 9944:9944 -p 9933:9933 -p 9615:9615 -d prosopo/substrate:dev-aura-aadbbed50ede27817158c7517f13f6f61c9cf000
```

### Build the contract

```bash
cd contract &&
RUST_LOG=debug cargo contract build --manifest-path ./Cargo.toml --verbose --keep-debug-symbols --generate all
```

### Set up env vars
Copy the `env.development` file and set the path to your contract resources

```bash
cp env.development .env.development
```

```bash
DAPP_WASM_PATH=<YOUR_PATH>batching/contract/target/ink/dapp.wasm
DAPP_ABI_PATH=<YOUR_PATH>batching/contract/target/ink/dapp.json
```
### Install the dependencies and build

```bash
npm i && \
npm run build
```

### Deploy the contract

```bash
npm run deploy
```

## Run the transactions

```bash
npm run tx
```

> Sending address:  5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
Payment Info:  1.9845 Unit
faucet response.storageDeposit { Charge: '480.0000 Unit' }
Block number 13886
Balance before: 995284288 UNIT, Balance after: 995283806 UNIT
>
> Tx Cost: 481 UNIT for extrinsic without sub call
>
> Sending address:  5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
Payment Info:  1.9845 Unit
faucetWithStore response.storageDeposit { Charge: '480.0000 Unit' }
Block number 13887
Balance before: 995283806 UNIT, Balance after: 995283324 UNIT
>
> Tx Cost: 481 UNIT for extrinsic with sub call
>
> Sending address:  5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
Payment Info:  1.9845 Unit
terminate response.storageDeposit { Refund: '2.4090 kUnit' }
Block number 13888
Balance before: 995283324 UNIT, Balance after: 995285832 UNIT
>
> Tx Cost: -2507 UNIT for terminate extrinsic


