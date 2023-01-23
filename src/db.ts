import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { type DeepReadonly, DEV_MODE, sortByProp } from './util.js'
import * as randomstring from 'randomstring'

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
	twitchEventSubSecret: string
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
		twitchEventSubSecret: randomstring.generate(),
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
	streamRecord: Partial<StreamRecord> & {
		streamID: string
		streamStatus: StreamRecord['streamStatus']
	}
) {
	streamRecord.startTime ||= Date.now()
	streamRecord.games ||= []
	modifyData({ streams: [...getStreamRecords(), streamRecord as StreamRecord] })
	return cloneStreamRecord(streamRecord as StreamRecord) as StreamRecord
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

export function recordTweet({
	messageID,
	tweetID,
	pingButtons,
}: {
	messageID: string
	tweetID: string
	pingButtons?: boolean
}) {
	const record: TweetRecord = {
		tweet_id: tweetID,
		message_id: messageID,
		recorded_time: Date.now(),
	}
	if (pingButtons) record.pingButtons = 'posted'
	modifyData({ tweets: [...getData().tweets, record] })
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

export function getStreamRecords(): StreamRecord[] {
	const streamRecords = sortByProp(
		getData().streams.map(cloneStreamRecord),
		'startTime'
	)
	return truncateRecords(streamRecords, 'streams', 5)
}

export function getTweetRecords(): TweetRecord[] {
	const tweetRecords = sortByProp(
		getData().tweets.map((tr) => ({ ...tr })),
		'tweet_id'
	)
	return truncateRecords(tweetRecords, 'tweets', 20)
}

function truncateRecords<T extends 'streams' | 'tweets'>(
	records: DBData[T],
	type: T,
	max: number
) {
	const truncated = records.slice(records.length - max)
	if (truncated.length < records.length) modifyData({ [type]: truncated })
	return truncated as DBData[T]
}

const cloneStreamRecord = (
	streamRecord: StreamRecord | DeepReadonly<StreamRecord>
) => ({
	...streamRecord,
	games: [...streamRecord.games],
})
