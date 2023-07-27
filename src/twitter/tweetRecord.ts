import { getData, modifyData } from '../db.js'
import { sortByProp } from '../util.js'

export type TweetRecord = {
	tweet_id: string
	recorded_time: number
	message_id: string
	pingButtons?: 'posted' | 'cleaned'
}

export const getTweetRecords = () =>
	getData().tweets.map((tr) => ({ ...tr })) as TweetRecord[]

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

export const padTweetID = (tweetID: string) => tweetID.padStart(19, '0')
export const tweetIDIsBefore = (a: string, b: string) =>
	padTweetID(a) < padTweetID(b)
export const tweetIDIsAfter = (a: string, b: string) =>
	padTweetID(a) > padTweetID(b)
