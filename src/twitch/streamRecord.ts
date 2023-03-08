import { type AccessToken } from '@twurple/auth'
import { getData, modifyData } from '../db.js'
import { sortByProp, type MaybeReadonly } from '../util.js'
import { type AccountType } from './twitchApi.js'

export type StreamRecord = {
	streamID: string
	startTime: number
	messageID?: string
	streamStatus: 'live' | 'ended'
	streamInfo?: boolean
	videoInfo?: boolean
	pingButtons?: 'posted' | 'cleaned'
	title?: string
	games: string[]
	thumbnailURL?: string
	thumbnailIndex?: number
}

export function recordStream(
	partialRecord: Partial<StreamRecord> & {
		streamID: string
		streamStatus: StreamRecord['streamStatus']
	}
) {
	const streamRecord: StreamRecord = {
		...partialRecord,
		startTime: partialRecord.startTime || Date.now(),
		games: partialRecord.games || [],
	}
	const streams = [...getData().streams, streamRecord]
	const sortedTrimmed = sortByProp(streams, 'startTime').slice(-5)
	modifyData({ streams: sortedTrimmed })
	return cloneStreamRecord(streamRecord) as StreamRecord
}

export function updateStreamRecord(
	partialRecord: Partial<StreamRecord> & { streamID: string },
	deleteProperties: (keyof StreamRecord)[] = []
) {
	const streamRecords = getStreamRecords()
	const existingRecord = streamRecords.find(
		(sr) => sr.streamID === partialRecord.streamID
	)
	if (!existingRecord)
		throw `Trying to update non-existent stream record ID ${partialRecord.streamID}`
	const existingRecordIndex = streamRecords.indexOf(existingRecord)
	const updatedRecord: StreamRecord = { ...existingRecord, ...partialRecord }
	for (const deleteProperty of deleteProperties) {
		delete updatedRecord[deleteProperty]
	}
	streamRecords.splice(existingRecordIndex, 1, updatedRecord)
	modifyData({ streams: streamRecords })
	return cloneStreamRecord(updatedRecord) as StreamRecord
}

export const getStreamRecords = () =>
	getData().streams.map(cloneStreamRecord) as StreamRecord[]

const cloneStreamRecord = (streamRecord: MaybeReadonly<StreamRecord>) => ({
	...streamRecord,
	games: [...streamRecord.games],
})

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
