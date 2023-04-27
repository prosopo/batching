import '@polkadot/api-augment'
import { batch } from './batchTx'
import { oneUnit } from './helpers'
import { useWeightImpl } from './useWeight'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { Abi, ContractPromise } from '@polkadot/api-contract'
import fse from 'fs-extra'
import path from 'node:path'
import { KeyringPair } from '@polkadot/keyring/types'
import { cryptoWaitReady } from '@polkadot/util-crypto'
import { Keyring } from '@polkadot/keyring'
import { BN, BN_ONE, BN_ZERO } from '@polkadot/util'
import { SubmittableExtrinsic } from '@polkadot/api/promise/types'
import { AbiMessage, ContractOptions } from '@polkadot/api-contract/types'
import { createType } from '@polkadot/types'
import { ApiBase } from '@polkadot/api/types'
import { Weight } from '@polkadot/types/interfaces/runtime/index'
import { DispatchError, StorageDeposit, WeightV2 } from '@polkadot/types/interfaces'
import dotenv from 'dotenv'

const CONTRACT_METHOD_NAME = 'faucet'

export function getEnv() {
    return process.env.NODE_ENV || 'development'
}

export function loadEnv(rootDir?: string, filename?: string, filePath?: string) {
    const args = { path: getEnvFile(path.resolve(rootDir || '.'), filename, filePath) }
    dotenv.config(args)
}

export function getEnvFile(rootDir?: string, filename = '.env', filepath = path.join(__dirname, '../..')) {
    const env = getEnv()
    const envPath = path.join(rootDir || filepath, `${filename}.${env}`)
    console.info(`Env path: ${envPath}`)
    return envPath
}
// will be running from within dist folder so look one level up
loadEnv('.')

// 4_999_999_999_999
const MAX_CALL_WEIGHT = new BN(5_000_000_000_000).isub(BN_ONE)

// The values returned by the dry run transactions are sometimes not large enough
// to guarantee that the transaction will succeed. This is a safety margin to ensure
// that the transaction will succeed.
const GAS_INCREASE_FACTOR = 1.01

class Batcher extends ContractPromise {
    logger: any
    pair: KeyringPair
    private nonce: bigint

    constructor(api: ApiPromise, abi: Abi, address: string, pair: KeyringPair, startNonce: bigint) {
        super(api, abi, address)
        this.nonce = startNonce
        this.pair = pair
        this.logger = console
    }

    async runBatch(extrinsic: SubmittableExtrinsic): Promise<void> {
        const extrinsics = [extrinsic]
        // get the extrinsics that are to be batched
        for (const x of Array(1).keys()) {
            extrinsics.push(extrinsic)
        }
        // commit and get the Ids of the commitments that were committed on-chain
        await batch(this, this.pair, extrinsics, this.logger)
    }

    /** Run call outside of batch */
    async runCall(extrinsic): Promise<void> {
        const result = new Promise((resolve, reject) => {
            extrinsic.signAndSend(this.pair, {}, (result) => {
                if (result.status.isInBlock || result.status.isFinalized) {
                    console.debug('Block number', result.blockNumber?.toString())
                    resolve(result)
                }
                if (result.isError) {
                    reject(result)
                }
            })
        })
        await result
    }

    async getExtrinsic(method: string): Promise<{ extrinsic?: SubmittableExtrinsic; error?: DispatchError }> {
        const args = [this.pair.address]
        const fragment = this.abi.findMessage(method)
        const encodedArgs: Uint8Array[] = encodeStringArgs(this.abi, fragment, args)
        const { extrinsic, error } = await this.buildExtrinsic(method, encodedArgs)
        if (error) {
            const decodedError = decodeError(error, this.api as ApiPromise)
            this.logger.error(decodedError)
        }
        return { extrinsic, error }
    }

    /**
     * Get the extrinsic for submitting in a transaction
     * @return {SubmittableExtrinsic} extrinsic
     */
    async buildExtrinsic<T>(
        contractMethodName: string,
        args: T[],
        value?: number | BN | undefined
    ): Promise<{ extrinsic?: SubmittableExtrinsic; options?: ContractOptions; error?: DispatchError }> {
        // Always query first as errors are passed back from a dry run but not from a transaction
        const message = this.abi.findMessage(contractMethodName)
        const encodedArgs: Uint8Array[] = encodeStringArgs(this.abi, message, args)
        const expectedBlockTime = new BN(this.api.consts.babe?.expectedBlockTime)
        const weight = await useWeightImpl(this.api as ApiPromise, expectedBlockTime, new BN(10))
        const gasLimit = weight.isWeightV2 ? weight.weightV2 : weight.isEmpty ? -1 : weight.weight
        this.logger.debug('Sending address: ', this.pair.address)
        const initialOptions = {
            value,
            gasLimit,
            storageDepositLimit: null,
        }
        const extrinsic = this.query[message.method](this.pair.address, initialOptions, ...encodedArgs)

        const response = await extrinsic
        if (response.result.isOk) {
            let options = getOptions(this.api, message.isMutating, value, response.gasRequired, response.storageDeposit)
            const extrinsicTx = this.tx[contractMethodName](options, ...encodedArgs)
            // paymentInfo is larger than gasRequired returned by query so use paymentInfo
            const paymentInfo = await extrinsicTx.paymentInfo(this.pair.address)
            this.logger.debug('Payment Info: ', paymentInfo.partialFee.toHuman())
            // increase the gas limit again to make sure the tx succeeds
            const increasedWeight = createType(this.api.registry, 'WeightV2', {
                refTime: Math.floor(paymentInfo.weight.refTime.toNumber() * GAS_INCREASE_FACTOR),
                proofSize: Math.floor(paymentInfo.weight.proofSize.toNumber() * GAS_INCREASE_FACTOR),
            })
            console.log(contractMethodName, 'response.storageDeposit', response.storageDeposit.toHuman())
            options = getOptions(this.api, message.isMutating, value, increasedWeight, undefined)
            return { extrinsic: this.tx[contractMethodName](options, ...encodedArgs), options }
        } else {
            return { error: response.result.asErr }
        }
    }
}

function decodeError(error: DispatchError, api: ApiPromise) {
    let message = 'Unknown dispatch error'
    if (error.isModule) {
        const decoded = api?.registry.findMetaError(error.asModule)
        if (decoded.method === 'StorageDepositLimitExhausted' || decoded.method === 'StorageDepositNotEnoughFunds') {
            message = 'Not enough funds in the selected account.'
        } else {
            message = `${decoded?.section.toUpperCase()}.${decoded?.method}: ${decoded?.docs}`
        }
    }
    return message
}

function getOptions(
    api: ApiBase<'promise'>,
    isMutating?: boolean,
    value?: number | BN,
    gasLimit?: Weight | WeightV2,
    storageDeposit?: StorageDeposit
): ContractOptions {
    const _gasLimit: Weight | WeightV2 | undefined = gasLimit
        ? gasLimit
        : isMutating
        ? (api.registry.createType('WeightV2', {
              proofTime: new BN(1_000_000),
              refTime: MAX_CALL_WEIGHT,
          }) as WeightV2)
        : undefined
    return {
        gasLimit: _gasLimit,
        //storageDepositLimit: new BN('1448339956379238'),
        storageDepositLimit: storageDeposit
            ? storageDeposit.isCharge
                ? storageDeposit.asCharge.muln(GAS_INCREASE_FACTOR)
                : storageDeposit.isRefund
                ? storageDeposit.asRefund
                : null
            : null,
        value: value || BN_ZERO,
    }
}

/** Encodes arguments to the ABI types
 * @return encoded arguments
 */
function encodeStringArgs(abi: Abi, methodObj: AbiMessage, args: any[]): Uint8Array[] {
    const encodedArgs: Uint8Array[] = []
    // args must be in the same order as methodObj['args']
    methodObj.args.forEach((methodArg, idx) => {
        const argVal = args[idx]
        encodedArgs.push(abi.registry.createType(methodArg.type.type, argVal).toU8a())
    })
    return encodedArgs
}

async function AbiJSON(filePath: string): Promise<Abi> {
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

async function run() {
    const wsProvider = new WsProvider('ws://localhost:9944')
    const api = new ApiPromise({ provider: wsProvider })
    await api.isReady
    const abi = await AbiJSON(process.env.DAPP_ABI_PATH || '')
    const address = process.env.DAPP_CONTRACT_ADDRESS || ''
    await cryptoWaitReady()
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 })
    const pair = keyring.addFromUri('//Bob')
    const batcher = new Batcher(api, abi, address, pair, 0n)

    const unit = await oneUnit(api)

    // Check the price for a tx without a sub call, in and outside a batch
    const { extrinsic: extrinsicWithoutSubcall } = await batcher.getExtrinsic('faucet')
    if (extrinsicWithoutSubcall) {
        let balanceBefore = (await api.query.system.account(pair.address)).data.free
        await batcher.runCall(extrinsicWithoutSubcall)
        let balanceAfter = (await api.query.system.account(pair.address)).data.free
        console.log(`Balance before: ${balanceBefore.div(unit)} UNIT, Balance after: ${balanceAfter.div(unit)} UNIT`)
        console.warn(`\nTx Cost: ${balanceBefore.sub(balanceAfter).div(unit)} UNIT for extrinsic without sub call\n`)

        // Check the price for a tx with a sub call inside a batch
        balanceBefore = (await api.query.system.account(pair.address)).data.free
        await batcher.runBatch(extrinsicWithoutSubcall)
        balanceAfter = (await api.query.system.account(pair.address)).data.free
        console.log(`Balance before: ${balanceBefore.div(unit)} UNIT, Balance after: ${balanceAfter.div(unit)} UNIT`)
        console.warn(
            `\nTx Cost: ${balanceBefore.sub(balanceAfter).div(unit)} UNIT for extrinsic without sub call in batch\n`
        )
    }

    // Check the price for a tx with a sub call, in and outside a batch
    const { extrinsic: extrinsicWithSubcall } = await batcher.getExtrinsic('faucetWithSubcall')
    if (extrinsicWithSubcall) {
        let balanceBefore = (await api.query.system.account(pair.address)).data.free
        await batcher.runCall(extrinsicWithSubcall)
        let balanceAfter = (await api.query.system.account(pair.address)).data.free
        console.log(`Balance before: ${balanceBefore.div(unit)} UNIT, Balance after: ${balanceAfter.div(unit)} UNIT`)
        console.warn(`\nTx Cost: ${balanceBefore.sub(balanceAfter).div(unit)} UNIT for extrinsic with sub call\n`)

        // Check the price for a tx with a sub call inside a batch
        balanceBefore = (await api.query.system.account(pair.address)).data.free
        await batcher.runBatch(extrinsicWithSubcall)
        balanceAfter = (await api.query.system.account(pair.address)).data.free
        console.log(`Balance before: ${balanceBefore.div(unit)} UNIT, Balance after: ${balanceAfter.div(unit)} UNIT`)
        console.warn(
            `\nTx Cost: ${balanceBefore.sub(balanceAfter).div(unit)} UNIT for extrinsic with sub call in batch\n`
        )
    }
}

if (typeof require !== 'undefined' && require.main === module) {
    run().then(() => process.exit(0))
}
