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
Payment Info:  1.9141 Unit
faucet response.storageDeposit { Charge: '0' }
Block number 52135
Balance before: 988072951 UNIT, Balance after: 988072949 UNIT
> 
> Tx Cost: **1 UNIT** for extrinsic **without sub call**
>
> Payment Info 2.7895 Unit
Block number 52136
Balance before: 988072949 UNIT, Balance after: 988072947 UNIT
>
> Tx Cost: **2 UNIT** for extrinsic **without sub call in batch**
>
> Sending address:  5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty
Payment Info:  1.9841 Unit
faucetWithSubcall response.storageDeposit { Charge: '480.0000 Unit' }
Block number 52137
Balance before: 988072947 UNIT, Balance after: 988072465 UNIT
>
> Tx Cost: **481 UNIT** for **extrinsic with sub call**
>
> Payment Info 2.7895 Unit
Block number 52135
Block number 52138
Balance before: 988072465 UNIT, Balance after: 988071502 UNIT
>
> Tx Cost: **962 UNIT** for extrinsic **with sub call in batch**`

