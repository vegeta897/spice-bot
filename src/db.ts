import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { type DeepReadonly, DEV_MODE, sortByProp } from './util.js'

type TweetRecord = {
	tweet_id: string
	recorded_time: number
	message_id: string
	pingButtons?: 'posted' | 'cleaned'
}

export type StreamRecord = {
	streamID: string
	startTime: number
	liveMessageID?: string
	endMessageID?: string
	streamStatus: 'live' | 'ended'
	streamInfo?: boolean
	endMessagePingButtons?: 'posted' | 'cleaned'
	title?: string
	games: string[]
	thumbnailURL?: string
}

type DBData = {
	tweets: TweetRecord[]
	streams: StreamRecord[]
	twitchEventSubSecret: string | null
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
		twitchEventSubSecret: null,
	}
	if (DEV_MODE)
		db.data.streams = db.data.streams.filter((s) => s.streamID !== 'test')
	db.write()
	console.log('Database connected')
}

export const getData = (): DeepReadonly<DBData> => db.data!

export async function modifyData(data: Partial<DBData>) {
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
	modifyData({ streams: sortedTrimmed as StreamRecord[] })
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
	const sortedTrimmed = sortByProp(tweets, 'tweet_id').slice(-20)
	modifyData({ tweets: sortedTrimmed })
	return { ...tweetRecord }
}

export function updateStreamRecord(
	partialRecord: Partial<StreamRecord> & { streamID: string }
) {
	const streamRecords = getStreamRecords()
	const existingRecord = streamRecords.find(
		(sr) => sr.streamID === partialRecord.streamID
	)
	if (!existingRecord)
		throw `Trying to update non-existent stream record ID ${partialRecord.streamID}`
	const otherStreams = streamRecords.filter(
		(s) => s.streamID !== partialRecord.streamID
	)
	const updatedRecord = { ...existingRecord, ...partialRecord }
	modifyData({ streams: [...otherStreams, updatedRecord] })
	return cloneStreamRecord(updatedRecord) as StreamRecord
}

export function updateTweetRecord(tweetRecord: TweetRecord) {
	const otherTweets = getTweetRecords().filter(
		(t) => t.tweet_id !== tweetRecord.tweet_id
	)
	modifyData({ tweets: [...otherTweets, tweetRecord] })
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

const cloneStreamRecord = (
	streamRecord: StreamRecord | DeepReadonly<StreamRecord>
) => ({
	...streamRecord,
	games: [...streamRecord.games],
})
