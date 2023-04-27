import { Abi } from '@polkadot/api-contract'
import { AccountId, EventRecord } from '@polkadot/types/interfaces'
import { cryptoWaitReady, randomAsHex } from '@polkadot/util-crypto'
import { ContractDeployer } from './deployer'
import path from 'path'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { Keyring } from '@polkadot/keyring'
import fse from 'fs-extra'
import { hexToU8a, isWasm } from '@polkadot/util'
import { getEnv, loadEnv } from './txs'
import fs from 'fs'
import dotenv from 'dotenv'
import { glob } from 'glob'

async function deploy(wasm: Uint8Array, abi: Abi) {
    await cryptoWaitReady()
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 })
    const pair = keyring.addFromUri('//Bob')
    const wsProvider = new WsProvider('ws://localhost:9944')
    const api = new ApiPromise({ provider: wsProvider })
    await api.isReady
    // initialSupply, faucetAmount
    const params = ['1000000000000000', 1000]
    const deployer = new ContractDeployer(api, abi, wasm, pair, params, 0, 0, randomAsHex())
    return await deployer.deploy()
}

export async function AbiJSON(filePath: string): Promise<Abi> {
    try {
        const json = JSON.parse(
            await fse.readFile(path.resolve(__dirname, filePath), {
                encoding: 'utf8',
            })
        )
        return new Abi(json)
    } catch (e) {
        console.error(`Error loading contract json: ${e}`)
        process.exit(1)
    }
}

export async function Wasm(filePath: string): Promise<Uint8Array> {
    const wasm: `0x${string}` = `0x${fse.readFileSync(path.resolve(__dirname, filePath)).toString('hex')}`
    const wasmBytes = hexToU8a(wasm)
    if (isWasm(wasmBytes)) {
        return wasmBytes
    } else {
        console.error(`Error loading contract wasm: ${wasm.slice(0, 10)}...`)
        process.exit(1)
    }
}
export async function findEnvFiles(logger: any) {
    const env = getEnv()
    const fileName = `.env.${env}`
    // options is optional
    logger.info('Searching for files')
    return await glob.glob(`./**/${fileName}`, {
        ignore: [
            'node_modules/**',
            'node_modules/**',
            '../../**/node_modules/**',
            '../node_modules/**',
            '../../node_modules/**',
        ],
    })
}

export async function updateEnvFiles(varNames: string[], varValue: string, logger: any) {
    const files = await findEnvFiles(logger)
    logger.info('Env files found', files)
    files.forEach((file) => {
        let write = false
        // the following code loads a .env file, searches for the variable and replaces it
        // then saves the file
        const filePath = path.resolve(process.cwd(), file)
        const envConfig = dotenv.parse(fs.readFileSync(filePath))
        for (const varName of varNames) {
            if (varName in envConfig) {
                envConfig[varName] = varValue
                write = true
            }
        }
        if (write) {
            // write the file back
            fs.writeFileSync(
                path.resolve(__dirname, filePath),
                Object.keys(envConfig)
                    .map((k) => `${k}=${envConfig[k]}`)
                    .join('\n')
            )
        }
    })
}

export async function run(): Promise<AccountId> {
    const wasm = await Wasm(path.resolve(process.env.DAPP_WASM_PATH || '.'))
    const abi = await AbiJSON(path.resolve(process.env.DAPP_ABI_PATH || '.'))
    const deployResult = await deploy(wasm, abi)

    const instantiateEvent: EventRecord | undefined = deployResult.events.find(
        (event) => event.event.section === 'contracts' && event.event.method === 'Instantiated'
    )
    console.log('instantiateEvent', instantiateEvent?.toHuman())
    const dappContractAddress = instantiateEvent?.event.data['contract'].toString()
    await updateEnvFiles(['DAPP_CONTRACT_ADDRESS'], dappContractAddress.toString(), console)
    return dappContractAddress
}

// run the script if the main process is running this file
if (typeof require !== 'undefined' && require.main === module) {
    // file will be runnnig from within ./dist
    loadEnv(path.resolve('..'))
    run()
        .then((deployResult) => {
            console.log('Deployed with address', deployResult)
            process.exit(0)
        })
        .catch((e) => {
            console.error(e)
            process.exit(1)
        })
}
