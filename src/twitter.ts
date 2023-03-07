import { type MessageCreateOptions } from 'discord.js'
import {
	ETwitterStreamEvent,
	type TweetStream,
	type TweetV2SingleStreamResult,
	TwitterApi,
	type UserV2,
} from 'twitter-api-v2'
import {
	deleteTweetRecord,
	getTweetRecords,
	recordTweet,
	updateTweetRecord,
} from './db.js'
import {
	createTweetMessage,
	deleteTweetMessage,
	editTweetMessage,
} from './discord.js'
import { getTwitterPingButtons, getTwitterPingRole } from './pings.js'
import { DEV_MODE, sleep, timestampLog } from './util.js'

const USERNAME = process.env.TWITTER_USERNAME
const INCLUDE_RETWEETS = process.env.TWITTER_INCLUDE_RETWEETS === 'true'
const INCLUDE_REPLIES = process.env.TWITTER_INCLUDE_REPLIES === 'true'
const TWEET_QUERY = `from:${USERNAME}${INCLUDE_RETWEETS ? '' : ' -is:retweet'}`
const TWEET_TAG = `spice bot: ${TWEET_QUERY}`
const timelineExclude: ('retweets' | 'replies')[] = []
if (!INCLUDE_RETWEETS) timelineExclude.push('retweets')
if (!INCLUDE_REPLIES) timelineExclude.push('replies')

let client: TwitterApi
let user: UserV2

export async function initTwitter() {
	client = new TwitterApi(process.env.TWITTER_TOKEN)
	const rules = await client.readOnly.v2.streamRules()
	// Delete unused rules, if any
	const deleteRules = rules.data.filter((rule) => rule.tag !== TWEET_TAG)
	if (deleteRules.length > 0) {
		await client.readOnly.v2.updateStreamRules({
			delete: { ids: deleteRules.map((rule) => rule.id) },
		})
	}
	// Add rule if not found
	if (!rules.data.find((rule) => rule.tag === TWEET_TAG)) {
		await client.readOnly.v2.updateStreamRules({
			add: [{ value: TWEET_QUERY, tag: TWEET_TAG }],
		})
	}
	let stream: TweetStream<TweetV2SingleStreamResult> | null = null
	while (!stream) {
		try {
			stream = await client.readOnly.v2.searchStream({
				'tweet.fields': ['in_reply_to_user_id'],
			})
		} catch (streamError: any) {
			if (streamError.data?.connection_issue === 'TooManyConnections') {
				console.log(
					'Last Twitter stream still open, trying again in 5 seconds...'
				)
				await sleep(5000)
			} else if (streamError.data?.title === 'Too Many Requests') {
				const waitUntil = streamError.rateLimit?.reset
					? streamError.rateLimit.reset * 1000
					: Date.now() + 5 * 60 * 1000
				const waitMs = waitUntil - Date.now()
				timestampLog(
					`Rate limit exceeded, retrying in ${waitMs}ms`,
					streamError.rateLimit
				)
				await sleep(waitMs)
			} else {
				console.log('Unknown error initializing Twitter stream!')
				throw streamError
			}
		}
	}
	stream.autoReconnect = true
	stream.autoReconnectRetries = 1000
	user = (await client.readOnly.v2.userByUsername(USERNAME)).data
	if (!user) throw `Twitter user "${USERNAME}" not found!`
	stream.on(ETwitterStreamEvent.Data, (tweet) => {
		if (DEV_MODE) console.log(JSON.stringify(tweet))
		// Ensure tweet matches rule
		if (!tweet.matching_rules.some(({ tag }) => tag === TWEET_TAG)) return
		// All replies are included because we can't exclude only non-self replies
		// So we check the user ID being replied to
		const isReply = !!tweet.data.in_reply_to_user_id
		const isSelfReply = tweet.data.in_reply_to_user_id === user.id
		if (isReply && !isSelfReply && !INCLUDE_REPLIES) {
			// Don't include replies to other users
			return
		}
		postTweet(tweet.data.id)
	})
	console.log('Twitter stream connected')
	// Check for tweets missed while Spice Bot was offline
	await checkRecentTweets()
	// Check again for every tweet stream reconnected event
	stream.on(ETwitterStreamEvent.Reconnected, () => checkRecentTweets())
	// Check for deleted tweets every 60 seconds
	await checkDeletedTweets()
	setInterval(() => checkDeletedTweets(), 60 * 1000)
}

async function checkRecentTweets() {
	const recordedTweets = getTweetRecords()
	if (recordedTweets.length === 0) return
	// Get tweets since last recorded tweet
	// Up to 10 tweets are fetched by default, which should be enough
	// Excluding replies does not exclude self-replies, unlike the stream API
	const timeline = await client.readOnly.v2.userTimeline(user.id, {
		since_id: recordedTweets.at(-1)!.tweet_id,
		exclude: timelineExclude,
	})
	if (timeline.meta.result_count === 0) return
	// Fetched tweets are newest to oldest, so reverse them
	const oldestToNewest = [...timeline.data.data].reverse()
	for (const tweet of oldestToNewest) {
		if (!recordedTweets.find((rt) => rt.tweet_id === tweet.id)) {
			console.log(`Recent tweet ID ${tweet.id} was missed`)
			await postTweet(tweet.id)
		}
	}
}

export async function postTweet(tweetID: string) {
	timestampLog(`Posting tweet ID ${tweetID}`)
	const messageOptions: MessageCreateOptions = {
		content: `https://twitter.com/${USERNAME}/status/${tweetID}`,
	}
	const twitterPingRole = getTwitterPingRole()
	if (twitterPingRole) {
		messageOptions.content += ` ${twitterPingRole.toString()}`
		messageOptions.components = getTwitterPingButtons()
	}
	const message = await createTweetMessage(messageOptions)
	if (!message?.id) {
		console.log('Failed to create Discord message for tweet!')
		return
	}
	const tweetRecordsWithButtons = getTweetRecords().filter(
		(tr) => tr.pingButtons === 'posted'
	)
	// Remove buttons from previous tweets
	for (const tweetRecord of tweetRecordsWithButtons) {
		editTweetMessage(tweetRecord.message_id, {
			content: `https://twitter.com/${USERNAME}/status/${tweetRecord.tweet_id}`,
			components: [],
		})
		tweetRecord.pingButtons = 'cleaned'
		updateTweetRecord(tweetRecord)
	}
	recordTweet({
		messageID: message.id,
		tweetID,
		pingButtons: !!twitterPingRole,
	})
}

async function checkDeletedTweets() {
	const recordedTweets = getTweetRecords()
	if (recordedTweets.length === 0) return
	const fetchedTweets = await client.readOnly.v2.tweets(
		recordedTweets.map((t) => t.tweet_id)
	)
	if (!fetchedTweets.errors) return // No deleted tweets found
	timestampLog(`Found ${fetchedTweets.errors.length} deleted tweet(s)`)
	for (const deletedTweet of fetchedTweets.errors) {
		const tweetRecord = recordedTweets.find(
			(rt) => rt.tweet_id === deletedTweet.resource_id
		)
		if (!tweetRecord) continue
		console.log(
			`Deleting message ID ${tweetRecord.message_id} for tweet ID ${tweetRecord.tweet_id}`
		)
		deleteTweetRecord(tweetRecord)
		await deleteTweetMessage(tweetRecord.message_id)
	}
	checkTweetPingButtons()
}

// Add ping buttons to last tweet message if latest was deleted
export async function checkTweetPingButtons() {
	if (!getTwitterPingRole()) return
	const newestTweetRecord = getTweetRecords().at(-1)
	if (!newestTweetRecord || newestTweetRecord.pingButtons === 'posted') return
	editTweetMessage(newestTweetRecord.message_id, {
		components: getTwitterPingButtons(),
	})
	newestTweetRecord.pingButtons = 'posted'
	updateTweetRecord(newestTweetRecord)
}
