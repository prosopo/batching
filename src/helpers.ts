// Get the error from inside the batch interrupted event
import { DispatchError, Event } from '@polkadot/types/interfaces'
import { ApiPromise, SubmittableResult } from '@polkadot/api'
import { Abi } from '@polkadot/api-contract'
import { DecodedEvent } from '@polkadot/api-contract/types'
import { Bytes } from '@polkadot/types-codec'
import { BN } from '@polkadot/util'

export function formatBatchInterruptedEvent({ data: [index, error] }: Event): string {
    return `error: ${index.toString()}: ${getDispatchError(error as DispatchError)}`
}

// Convert a dispatch error to a readable message
export function getDispatchError(dispatchError: DispatchError): string {
    let message: string = dispatchError.type

    if (dispatchError.isModule) {
        try {
            const mod = dispatchError.asModule
            const error = dispatchError.registry.findMetaError(mod)

            message = `${error.section}.${error.name}`
        } catch (error) {
            // swallow
        }
    } else if (dispatchError.isToken) {
        message = `${dispatchError.type}.${dispatchError.asToken.type}`
    }

    return message
}

export function formatEvent(event: Event): string {
    return `${event.section}.${event.method}${
        'docs' in event ? ('docs' in event && Array.isArray(event['docs']) ? `(${event['docs'].join('')})` : event['docs'] || '') : ''
    }`
}

export function filterAndDecodeContractEvents(result: SubmittableResult, abi: Abi, logger: any): DecodedEvent[] {
    return result.events
        .filter(
            (e) =>
                e.event.section === 'contracts' && ['ContractEmitted', 'ContractExecution'].indexOf(e.event.method) > -1
        )
        .map((eventRecord): DecodedEvent | null => {
            const {
                event: {
                    data: [, data],
                },
            } = eventRecord
            try {
                return abi.decodeEvent(data as Bytes)
            } catch (error) {
                logger.error(`Unable to decode contract event: ${(error as Error).message}`)
                logger.error(eventRecord.event.toHuman())

                return null
            }
        })
        .filter((decoded): decoded is DecodedEvent => !!decoded)
}

export function oneUnit(api: ApiPromise): BN {
    const chainDecimals = new BN(api.registry.chainDecimals[0])
    return new BN((10 ** chainDecimals.toNumber()).toString())
}
