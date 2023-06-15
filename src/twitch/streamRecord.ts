import { type AccessToken } from '@twurple/auth'
import { getData, modifyData } from '../db.js'
import { sortByProp, type MaybeReadonly } from '../util.js'
import { type AccountType } from './twitchApi.js'

type StreamRecordBase = {
	streamID: string
	startTime: number
	endTime?: number
	videoURL?: string
	streamStatus: 'live' | 'ended'
	streamInfo?: boolean
	title?: string
	games: string[]
	thumbnailURL?: string
	thumbnailIndex?: number
}

export type ParentStreamRecord = StreamRecordBase & {
	messageID?: string
	pingButtons?: 'posted' | 'cleaned'
}

export type ChildStreamRecord = StreamRecordBase & {
	parentStreamID: string
}

export type StreamRecord = ParentStreamRecord | ChildStreamRecord

export function createStreamRecord(streamID: string, parentStreamID?: string) {
	const streamRecord: StreamRecord = {
		streamID,
		streamStatus: 'live',
		startTime: Date.now(),
		games: [],
	}
	if (parentStreamID)
		(streamRecord as ChildStreamRecord).parentStreamID = parentStreamID
	const streams = sortByProp([...getData().streams, streamRecord], 'startTime')
	if (parentStreamID) {
		// No need to trim old streams if this is a child stream
		modifyData({ streams })
	} else {
		const keepStreams: MaybeReadonly<StreamRecord>[] = []
		let keptParentStreams = 0
		for (let i = 0; i < streams.length; i++) {
			const stream = streams[streams.length - i]
			keepStreams.unshift(stream)
			if (!('parentStream' in stream)) keptParentStreams++
			if (keptParentStreams === 5) break
		}
		modifyData({ streams: keepStreams })
	}
	return cloneStreamRecord(streamRecord) as StreamRecord
}

export function updateStreamRecord<T extends StreamRecord>(
	partialRecord: Partial<T> & { streamID: string },
	deleteProperties: (keyof T)[] = []
) {
	const streamRecords = getStreamRecords()
	const existingRecord = streamRecords.find(
		(sr) => sr.streamID === partialRecord.streamID
	)
	if (!existingRecord)
		throw `Trying to update non-existent stream record ID ${partialRecord.streamID}`
	const existingRecordIndex = streamRecords.indexOf(existingRecord)
	const updatedRecord: T = { ...existingRecord, ...partialRecord } as T
	for (const deleteProperty of deleteProperties) {
		delete updatedRecord[deleteProperty]
	}
	streamRecords.splice(existingRecordIndex, 1, updatedRecord)
	modifyData({ streams: streamRecords })
	return cloneStreamRecord(updatedRecord) as T
}

export const getStreamRecords = () =>
	getData().streams.map(cloneStreamRecord) as StreamRecord[]

const cloneStreamRecord = <T extends StreamRecord>(
	streamRecord: MaybeReadonly<T>
) =>
	({
		...streamRecord,
		games: [...streamRecord.games],
	} as T)

export const getStreamRecord = (streamID: string): StreamRecord | null => {
	const streamRecord = getData().streams.find((sr) => sr.streamID === streamID)
	if (!streamRecord) return null
	return cloneStreamRecord(streamRecord) as StreamRecord
}

export const getChildStreams = (streamID: string): ChildStreamRecord[] =>
	getData()
		.streams.filter(
			(sr) => 'parentStreamID' in sr && sr.parentStreamID === streamID
		)
		.map(cloneStreamRecord) as ChildStreamRecord[]

export const getTwitchToken = (accountType: AccountType) =>
	cloneTwitchToken(getData().twitchTokens[accountType]) as AccessToken

const cloneTwitchToken = (token: MaybeReadonly<AccessToken> | null) =>
	(token && {
		...token,
		scope: [...token.scope],
	}) ||
	null

export const setTwitchToken = (
	accountType: AccountType,
	token: AccessToken | null
) =>
	modifyData({
		twitchTokens: { ...getData().twitchTokens, [accountType]: token },
	})
