import { IKeyringPair, SignatureOptions } from '@polkadot/types/types'
import { SubmittableResult } from '@polkadot/api'
import { SubmittableExtrinsic } from '@polkadot/api/types'
import { ContractPromise } from '@polkadot/api-contract'
import { formatBatchInterruptedEvent, formatEvent } from './helpers'

/**
 * Batch commits an array of transactions to the contract
 * @param contract
 * @param pair
 * @param extrinsics
 * @param logger
 */
export async function batch(
    contract: ContractPromise,
    pair: IKeyringPair,
    extrinsics: SubmittableExtrinsic<any>[],
    logger: any
): Promise<void> {
    const nonce = (await contract.api.rpc.system.accountNextIndex(pair.address)).toNumber()
    const genesisHash = await contract.api.rpc.chain.getBlockHash(0)
    const blockHash = await contract.api.rpc.chain.getBlockHash()
    const runtimeVersion = await contract.api.rpc.state.getRuntimeVersion(blockHash)

    const options: SignatureOptions = {
        nonce: nonce,
        tip: 0,
        genesisHash,
        blockHash,
        runtimeVersion,
    }

    const batchExtrinsic = contract.api.tx.utility.batch(extrinsics)
    const paymentInfo = await batchExtrinsic.paymentInfo(pair)
    logger.info('Payment Info', paymentInfo.partialFee.toHuman())
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
        const unsub = await batchExtrinsic.signAndSend(pair, options, async (result: SubmittableResult) => {
            const batchInterruptedEvent = result.events.filter((e) => e.event.method === 'BatchInterrupted')
            const tooManyCallsEvent = result.events.filter((e) => e.event.method === 'TooManyCalls')
            //const extrinsicSuccess = result.events.filter((e) => e.event.method === 'ExtrinsicSuccess')
            if (tooManyCallsEvent.length > 0) {
                logger.error('Too many calls')
                const message = formatEvent(tooManyCallsEvent[0].event)
                reject(new Error(message))
            }

            if (batchInterruptedEvent.length > 0) {
                logger.error('Batch interrupted')
                const message = formatBatchInterruptedEvent(batchInterruptedEvent[0].event)
                reject(new Error(message))
            }

            if (result.status.isFinalized || result.status.isInBlock) {
                unsub()
                //const events = filterAndDecodeContractEvents(result, contract.abi, logger)
                logger.debug('Block number', result.blockNumber?.toString())
                resolve()
            } else if (result.isError) {
                unsub()
                reject(new Error(result.status.type))
            }
        })
    })
}
