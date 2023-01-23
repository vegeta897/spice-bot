import { type MessageCreateOptions } from 'discord.js'
import {
	ETwitterStreamEvent,
	type TweetStream,
	type TweetV2SingleStreamResult,
	TwitterApi,
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
import { sleep, timestampLog } from './util.js'

const USERNAME = process.env.TWITTER_USERNAME
const RT_QUERY =
	process.env.TWITTER_INCLUDE_RETWEETS === 'true' ? '' : ' -is:retweet'
const REPLY_QUERY =
	process.env.TWITTER_INCLUDE_REPLIES === 'true' ? '' : ' -is:reply'
const timelineExclude: ('retweets' | 'replies')[] = []
if (RT_QUERY) timelineExclude.push('retweets')
if (REPLY_QUERY) timelineExclude.push('replies')
const TWEET_QUERY = `from:${USERNAME}${RT_QUERY}${REPLY_QUERY}`
const TWEET_TAG = `spice bot: ${TWEET_QUERY}`

let client: TwitterApi

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
			stream = await client.readOnly.v2.searchStream()
		} catch (streamError: any) {
			if (streamError.data?.connection_issue === 'TooManyConnections') {
				console.log(
					'Last Twitter stream still open, trying again in 5 seconds...'
				)
				await sleep(5000)
			} else {
				console.log('Unknown error initializing Twitter stream!')
				throw streamError
			}
		}
	}
	stream.autoReconnect = true
	stream.autoReconnectRetries = 1000
	stream.on(ETwitterStreamEvent.Data, (tweet) => {
		console.log(JSON.stringify(tweet))
		// Ensure tweet matches rule
		if (!tweet.matching_rules.some(({ tag }) => tag === TWEET_TAG)) return
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
	const user = await client.readOnly.v2.userByUsername(USERNAME)
	const timeline = await client.readOnly.v2.userTimeline(user.data.id, {
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

async function postTweet(tweetID: string) {
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
	if (message?.id) {
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
	} else {
		console.log('Failed to create Discord message for tweet!')
	}
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
	// Add buttons to latest tweet message if latest was deleted
	if (getTwitterPingRole()) {
		const newestTweetRecord = getTweetRecords().at(-1)
		if (!newestTweetRecord || newestTweetRecord.pingButtons === 'posted') return
		editTweetMessage(newestTweetRecord.message_id, {
			components: getTwitterPingButtons(),
		})
		newestTweetRecord.pingButtons = 'posted'
		updateTweetRecord(newestTweetRecord)
	}
}
