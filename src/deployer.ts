import '@polkadot/api-augment'
import { KeyringPair } from '@polkadot/keyring/types'
import { Abi, CodePromise } from '@polkadot/api-contract'
import {BN, BN_ZERO, bnFromHex, BN_THOUSAND, BN_TWO, bnMin} from '@polkadot/util'
import { SubmittableExtrinsic } from '@polkadot/api/types'
import { useWeightImpl } from './useWeight'
import { CodeSubmittableResult } from '@polkadot/api-contract/base'
import { ContractSubmittableResult } from '@polkadot/api-contract/base/Contract'
import { ISubmittableResult } from '@polkadot/types/types'
import {DispatchError, EventRecord, WeightV2} from '@polkadot/types/interfaces'
import { ApiPromise } from '@polkadot/api'
import { Registry } from '@polkadot/types-codec/types/registry'

interface DryRunResult {
    contract: null | SubmittableExtrinsic<'promise'>
    error: null | string
}

export interface UseWeight {
    executionTime: number
    isEmpty: boolean
    isValid: boolean
    isWeightV2: boolean
    megaGas: BN
    megaRefTime: BN
    proofSize: BN
    percentage: number
    weight: BN
    weightV2: WeightV2
}



export const A_DAY = new BN(24 * 60 * 60 * 1000)
const THRESHOLD = BN_THOUSAND.div(BN_TWO)
const DEFAULT_TIME = new BN(6_000)


export function dispatchErrorHandler(registry: Registry, event: EventRecord): Error {
    const dispatchError = event.event.data[0] as DispatchError
    let message: string = dispatchError.type

    if (dispatchError.isModule) {
        try {
            const mod = dispatchError.asModule
            const error = registry.findMetaError(
                new Uint8Array([mod.index.toNumber(), bnFromHex(mod.error.toHex().slice(0, 4)).toNumber()])
            )
            message = `${error.section}.${error.name}${
                Array.isArray(error.docs) ? `(${error.docs.join('')})` : error.docs || ''
            }`
        } catch (error) {
            // swallow
        }
    }
    return new Error(message)
}

export function calcInterval(api: ApiPromise): BN {
    return bnMin(
        A_DAY,
        // Babe, e.g. Relay chains (Substrate defaults)
        api.consts
            ? api.consts.babe?.expectedBlockTime ||
            // POW, eg. Kulupu
            api.consts.difficulty?.targetBlockTime ||
            // Subspace
            api.consts.subspace?.expectedBlockTime ||
            // Check against threshold to determine value validity
            (api.consts.timestamp?.minimumPeriod.gte(THRESHOLD)
                ? // Default minimum period config
                api.consts.timestamp.minimumPeriod.mul(BN_TWO)
                : api.query.parachainSystem
                    ? // default guess for a parachain
                    DEFAULT_TIME.mul(BN_TWO)
                    : // default guess for others
                    DEFAULT_TIME)
            : DEFAULT_TIME
    )
}


export class ContractDeployer {
    private api: ApiPromise
    private abi: Abi
    private wasm: Uint8Array
    private readonly code: CodePromise
    private readonly pair: KeyringPair
    private readonly params: any[]
    private readonly constructorIndex: number
    private readonly value: number
    private readonly logger: any
    private readonly salt?: string

    constructor(
        api: ApiPromise,
        abi: Abi,
        wasm: Uint8Array,
        pair: KeyringPair,
        params: any[] = [],
        value = 0,
        constructorIndex = 0,
        salt?: string,
    ) {
        this.api = api
        this.abi = abi
        this.wasm = this.api.registry.createType('Raw', wasm)
        this.pair = pair
        this.params = params
        this.constructorIndex = constructorIndex
        this.value = value
        this.salt = salt
        this.logger = console
        console.log("Getting code promise")
        this.code = new CodePromise(api, abi, wasm)
    }

    async deploy(): Promise<any> {
        const weight = await getWeight(this.api)
        const { contract, error } = await dryRunDeploy(
            this.code,
            this.api,
            this.abi,
            this.wasm,
            this.pair,
            this.params,
            this.value,
            weight,
            this.constructorIndex,
            this.salt
        )
        console.debug('Weight', weight.weightV2?.toHuman())

        const nonce = await this.api.rpc.system.accountNextIndex(this.pair.address)

        if (contract) {
            return new Promise(async (resolve, reject) => {
                const unsub = await contract?.signAndSend(this.pair, { nonce }, (result: ISubmittableResult) => {
                    if (result.status.isFinalized || result.status.isInBlock) {
                        result.events
                            .filter(({ event: { section } }: any): boolean => section === 'system')
                            .forEach((event): void => {
                                const {
                                    event: { method },
                                } = event

                                if (method === 'ExtrinsicFailed') {
                                    unsub()
                                    console.log('ExtrinsicFailed')
                                    reject(dispatchErrorHandler(this.api.registry, event))
                                }
                            })

                        // ContractEmitted is the current generation, ContractExecution is the previous generation
                        unsub()
                        resolve(new ContractSubmittableResult(result))
                    } else if (result.isError) {
                        unsub()
                        console.log('isError')
                        reject(new Error(result.status.type))
                    }
                })
            })
        } else {
            throw new Error(error || 'Unknown error')
        }
    }
}

async function getWeight(api: ApiPromise): Promise<UseWeight> {
    const expectedBlockTime = calcInterval(api)
    return await useWeightImpl(api as ApiPromise, expectedBlockTime, new BN(10))
}

// Taken from apps/packages/page-contracts/src/Codes/Upload.tsx
export async function dryRunDeploy(
    code: CodePromise,
    api: ApiPromise,
    contractAbi: Abi,
    wasm: Uint8Array,
    pair: KeyringPair,
    params: any[] = [],
    value = 0,
    weight: UseWeight,
    constructorIndex = 0,
    salt?: string
): Promise<DryRunResult> {
    const accountId = pair.address
    let contract: SubmittableExtrinsic<'promise'> | null = null
    let error: string | null = null

    try {
        const message = contractAbi?.constructors[constructorIndex]
        if ("method" in message) {
            const method = message.method
            if (code && message && accountId) {
                const dryRunParams: Parameters<typeof api.call.contractsApi.instantiate> = [
                    pair.address,
                    message.isPayable
                        ? api.registry.createType('Balance', value)
                        : api.registry.createType('Balance', BN_ZERO),
                    weight.weightV2,
                    null,
                    {Upload: api.createType('Raw',wasm)},
                    message.toU8a(params),
                    '',
                ]

                const dryRunResult = await api.call.contractsApi.instantiate(...dryRunParams)
                console.log('dryRunResult', dryRunResult.toHuman())
                contract = code.tx[method](
                    {
                        gasLimit: dryRunResult.gasRequired,
                        storageDepositLimit: dryRunResult.storageDeposit.isCharge
                            ? dryRunResult.storageDeposit.asCharge
                            : null,
                        //storageDepositLimit: null,
                        value: message.isPayable ? value : undefined,
                        salt,
                    },
                    ...params
                )
        }
        }
    } catch (e) {
        error = (e as Error).message
    }

    return { contract, error }
}
