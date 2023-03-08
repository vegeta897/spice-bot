import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import {
	type DeepReadonly,
	DEV_MODE,
	sortByProp,
	MaybeReadonly,
} from './util.js'
import { type AccessToken } from '@twurple/auth'
import { type SessionRecord } from './dbSessionStore.js'
import { type AccountType } from './twitch/twitchApi.js'

type TweetRecord = {
	tweet_id: string
	recorded_time: number
	message_id: string
	pingButtons?: 'posted' | 'cleaned'
}

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

type DBData = {
	tweets: TweetRecord[]
	streams: StreamRecord[]
	expressSessions: SessionRecord[]
	expressSessionSecret: string | null
	twitchEventSubSecret: string | null
	twitchTokens: Record<AccountType, AccessToken | null>
	twichGraceTrainRecord: number
	emoteCounts: [string, number][]
	redeemCounts: [string, number][]
}

const filename = DEV_MODE ? 'db-dev.json' : 'db.json'
const file = join(dirname(fileURLToPath(import.meta.url)), '..', filename)
const adapter = new JSONFile<DBData>(file)
const db = new Low<DBData>(adapter)

export async function initDB() {
	await db.read()
	db.data ||= {
		tweets: [],
		streams: [],
		expressSessions: [],
		expressSessionSecret: null,
		twitchEventSubSecret: null,
		twitchTokens: { bot: null, streamer: null, admin: null },
		twichGraceTrainRecord: 0,
		emoteCounts: [],
		redeemCounts: [],
	}
	let fileLocked = true
	do {
		try {
			await db.write() // Creates the initial db file if it doesn't exist
			fileLocked = false
		} catch (_) {}
	} while (fileLocked) // Retry if write fails (can happen on dev-mode restarts)
	console.log('Database connected')
}

export const getData = (): DeepReadonly<DBData> => db.data!

export async function modifyData(data: MaybeReadonly<Partial<DBData>>) {
	db.data = <DBData>{ ...db.data, ...data }
	await db.write()
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

export function recordTweet({
	messageID,
	tweetID,
	pingButtons,
}: {
	messageID: string
	tweetID: string
	pingButtons?: boolean
}) {
	const tweetRecord: TweetRecord = {
		tweet_id: tweetID,
		message_id: messageID,
		recorded_time: Date.now(),
	}
	if (pingButtons) tweetRecord.pingButtons = 'posted'
	const tweets = [...getData().tweets, tweetRecord]
	// Sorting by tweet_id as a string is safe because all tweets from 2019 onward are 19 digits
	// Tweet IDs won't gain another digit until the year 2086
	const sortedTrimmed = sortByProp(tweets, 'tweet_id').slice(-20)
	modifyData({ tweets: sortedTrimmed })
	return { ...tweetRecord }
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

export function updateTweetRecord(tweetRecord: TweetRecord) {
	const tweetRecords = getTweetRecords()
	const existingRecord = tweetRecords.find(
		(tr) => tr.tweet_id === tweetRecord.tweet_id
	)
	if (!existingRecord)
		throw `Trying to update non-existent tweet record ID ${tweetRecord.tweet_id}`
	const existingRecordIndex = tweetRecords.indexOf(existingRecord)
	tweetRecords.splice(existingRecordIndex, 1, tweetRecord)
	modifyData({ tweets: tweetRecords })
}

export function deleteTweetRecord(tweetRecord: TweetRecord) {
	modifyData({
		tweets: getData().tweets.filter(
			(tr) => tr.tweet_id !== tweetRecord.tweet_id
		),
	})
}

export const getStreamRecords = () =>
	getData().streams.map(cloneStreamRecord) as StreamRecord[]

export const getTweetRecords = () =>
	getData().tweets.map((tr) => ({ ...tr })) as TweetRecord[]

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
