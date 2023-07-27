import { deleteTweetMessage } from '../discord.js'
import { spiceLog, timestampLog } from '../logger.js'
import { DEV_MODE } from '../util.js'
import {
	deleteTweetRecord,
	getTweetRecords,
	tweetIDIsAfter,
	tweetIDIsBefore,
} from './tweetRecord.js'
import { checkTweetPingButtons, postTweet } from './twitter.js'

const USERNAME = process.env.TWITTER_USERNAME
const INCLUDE_RETWEETS = process.env.TWITTER_INCLUDE_RETWEETS === 'true'
const INCLUDE_REPLIES = process.env.TWITTER_INCLUDE_REPLIES === 'true'
const SCRAPE_INTERVAL = (DEV_MODE ? 0.5 : 1) * 60 * 1000 // 1 minute
const ERROR_THRESHOLD = 15 * 60 * 1000 // 15 minutes

let firstErrorTime: number | null = null
const pendingDelete: Map<string, number> = new Map()

export async function initTwitterScraper() {
	spiceLog('Tweet scraper connected')
	checkForTweets()
	setInterval(checkForTweets, SCRAPE_INTERVAL)
}

async function checkForTweets() {
	const recordedTweets = getTweetRecords()
	const newestRecordedTweet = recordedTweets.at(-1)

	let scrapedTweets: ScrapedTweet[]
	try {
		const timelinePage = await fetch(
			`https://syndication.twitter.com/srv/timeline-profile/screen-name/${USERNAME}?showReplies=true`
		)
		const timelinePageText = await timelinePage.text()
		const timelineJson =
			timelinePageText.substring(
				timelinePageText.indexOf('json">{') + 6,
				timelinePageText.lastIndexOf('}</script>')
			) + '}'
		const timeline: RawTweetData[] =
			JSON.parse(timelineJson).props.pageProps.timeline.entries
		scrapedTweets = timeline.map((t) => ({
			tweetID: t.content.tweet.id_str,
			timestamp: t.content.tweet.created_at,
			permalink: t.content.tweet.permalink,
			retweetOfUser:
				t.content.tweet.retweeted_status?.user.screen_name || undefined,
			replyToUser: t.content.tweet.in_reply_to_screen_name,
			sortIndex: t.sort_index,
		}))
		if (!INCLUDE_RETWEETS) {
			scrapedTweets = scrapedTweets.filter(
				(t) => !t.retweetOfUser || t.retweetOfUser === USERNAME
			)
		}
		if (!INCLUDE_REPLIES) {
			scrapedTweets = scrapedTweets.filter(
				(t) => !t.replyToUser || t.replyToUser === USERNAME
			)
		}
	} catch (e) {
		if (DEV_MODE) {
			const errorString = e instanceof Error ? e.message : String(e)
			console.log(errorString)
		}
		const now = Date.now()
		firstErrorTime ||= now
		if (now - firstErrorTime >= ERROR_THRESHOLD) {
			timestampLog(
				`Tweet scraper failed all attempts for 15 minutes. Does ${USERNAME} have no tweets, or are they protected?`
			)
			firstErrorTime = now
		}
		return
	}
	firstErrorTime = null

	if (scrapedTweets.length === 0) return

	// Post recent unrecorded tweets
	for (const { tweetID, timestamp } of scrapedTweets) {
		if (newestRecordedTweet) {
			// Don't post any tweet older than the newest recorded tweet
			if (!tweetIDIsAfter(tweetID, newestRecordedTweet.tweet_id)) break
		} else {
			// If there are no recorded tweets, only post brand new tweets
			if (new Date(timestamp).getTime() < Date.now() - SCRAPE_INTERVAL * 3)
				break
		}
		// Last-ditch effort protection against reposts
		if (recordedTweets.find((t) => t.tweet_id === tweetID)) continue
		await postTweet(tweetID)
	}

	// Check for deleted tweets
	for (const tweetRecord of recordedTweets) {
		// Ignore tweets outside of scrape range
		if (tweetIDIsBefore(tweetRecord.tweet_id, scrapedTweets.at(-1)!.tweetID))
			continue
		const scraped = scrapedTweets.find(
			(st) => st.tweetID === tweetRecord.tweet_id
		)
		if (scraped) continue
		// Make sure tweet is really deleted
		const strikes = (pendingDelete.get(tweetRecord.tweet_id) ?? 0) + 1
		timestampLog(
			`Recorded tweet ID ${tweetRecord.tweet_id} not found in scrape (strike ${strikes}/3)`
		)
		if (strikes === 3) {
			// 3 strikes and you're out
			pendingDelete.delete(tweetRecord.tweet_id)
			deleteTweetRecord(tweetRecord)
			await deleteTweetMessage(tweetRecord.message_id)
		} else {
			pendingDelete.set(tweetRecord.tweet_id, strikes)
		}
	}
	checkTweetPingButtons()
}

type ScrapedTweet = {
	tweetID: string
	timestamp: string
	permalink: string
	retweetOfUser?: string
	replyToUser?: string
	sortIndex: string
}

type RawTweetData = {
	entry_id: string
	sort_index: string
	content: {
		tweet: {
			id_str: string
			created_at: string
			permalink: string
			conversation_id_str: string
			in_reply_to_screen_name: string
			retweeted_status?: {
				user: {
					screen_name: string
				}
			}
		}
	}
}
