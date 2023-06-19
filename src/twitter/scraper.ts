import puppeteer from 'puppeteer'
import { scrollPageToBottom } from 'puppeteer-autoscroll-down'
import {
	deleteTweetRecord,
	getTweetRecords,
	tweetIDIsAfter,
	tweetIDIsBefore,
} from './tweetRecord.js'
import { deleteTweetMessage } from '../discord.js'
import { checkTweetPingButtons, postTweet } from './twitter.js'
import { DEV_MODE, timestampLog } from '../util.js'

// Make this a separate module on NPM?

const USERNAME = process.env.TWITTER_USERNAME
const INCLUDE_RETWEETS = process.env.TWITTER_INCLUDE_RETWEETS === 'true'
const SCRAPE_INTERVAL = 30 * 1000 // 30 seconds

let page: puppeteer.Page
let checkingForTweets = false
let tempLatestTweetID: string | null = null

export async function initTwitterScraper() {
	const browser = await puppeteer.launch()
	page = await browser.newPage()
	// await setPageRequestInterceptions(page)
	await page.setViewport({ width: 1600, height: 3000 })
	console.log('Tweet scraper connected')
	checkForTweets()
	setInterval(checkForTweets, SCRAPE_INTERVAL)
}

async function checkForTweets() {
	if (checkingForTweets && DEV_MODE) {
		timestampLog(
			`Tried to check tweets while previous check (${(
				SCRAPE_INTERVAL / 1000
			).toFixed(0)}s ago) was still running`
		)
		return
	}
	// if (DEV_MODE) timestampLog('checking for tweets')
	checkingForTweets = true
	try {
		await page.goto(`https://twitter.com/${USERNAME}`)
	} catch (e: any) {
		const errorString = e instanceof Error ? e.message : String(e)
		const message = errorString.includes('context was destroyed')
			? '(context destroyed)'
			: errorString.includes('Page.navigate timed out') ||
			  errorString.includes('Navigation timeout')
			? '(timed out)'
			: e
		timestampLog(`Error navigating to twitter.com/${USERNAME}`, message)
		checkingForTweets = false
		return
	}
	try {
		await page.waitForSelector('article')
	} catch (e) {
		timestampLog(
			`No <article> element found! Does ${USERNAME} have no tweets, or are they protected?`
		)
		checkingForTweets = false
		return
	}
	const recordedTweets = getTweetRecords()
	const newestRecordedTweet = recordedTweets.at(-1)
	const oldestRecordedTweet = recordedTweets[0]

	let scrapedTweets: ScrapedTweet[]

	try {
		scrapedTweets = await scrapeTweets(
			page,
			tempLatestTweetID || oldestRecordedTweet?.tweet_id
		)
	} catch (e) {
		timestampLog('Error scraping tweets:', e)
		checkingForTweets = false
		return
	}
	if (scrapedTweets.length === 0) {
		checkingForTweets = false
		return
	}
	scrapedTweets.reverse() // Sort oldest to newest
	if (INCLUDE_RETWEETS) createNewRetweetIDs(scrapedTweets)
	const prevTempLatestTweetID = tempLatestTweetID
	tempLatestTweetID = scrapedTweets.at(-1)!.tweetID

	// Post recent unrecorded tweets
	for (const { tweetID, timestamp, retweet } of scrapedTweets) {
		if (!newestRecordedTweet) {
			// If there are no recorded tweets, only post brand new tweets
			if (new Date(timestamp).getTime() < Date.now() - SCRAPE_INTERVAL * 3)
				continue
		} else {
			// Don't post any tweet older than the newest recorded tweet
			if (
				!tweetIDIsAfter(
					tweetID,
					prevTempLatestTweetID || newestRecordedTweet.tweet_id
				)
			)
				continue
		}
		await postTweet(tweetID, { retweet })
	}

	// Check for deleted tweets
	for (const tweetRecord of recordedTweets) {
		// Ignore tweets outside of scrape range
		if (tweetIDIsBefore(tweetRecord.tweet_id, scrapedTweets[0].tweetID))
			continue
		const scraped = scrapedTweets.find(
			(st) =>
				st.tweetID === tweetRecord.tweet_id ||
				(st.retweet && st.retweet.tweetID === tweetRecord.retweetOf)
		)
		if (scraped) continue
		timestampLog(
			`Deleting message ID ${tweetRecord.message_id} for tweet ID ${tweetRecord.tweet_id}`
		)
		deleteTweetRecord(tweetRecord)
		await deleteTweetMessage(tweetRecord.message_id)
	}
	checkTweetPingButtons()
	checkingForTweets = false
}

// How unknown retweet IDs are handled:
// Scrape the timeline until first non-retweet before or equal to cutoffTweetID is reached
// This cutoff ID can be synthetic since we're just using it to compare IDs
// Once we have a full picture of the timeline, assign synthetic IDs to retweets
// Synthetic IDs are based on the next oldest non-retweet ID
// The tweet ID that was retweeted is saved in the tweet record

const scrapeTweets = async (
	page: puppeteer.Page,
	cutoffTweetID?: string
): Promise<ScrapedTweet[]> => {
	const tweets: ScrapedTweet[] = []
	let highestTimelineIndex = -1
	let prevHighestTimelineIndex = -1
	let staleScrollAttempts = 0
	let oldestNonRetweet: ScrapedTweet | null = null
	const timelineIndexMap: Map<string, number> = new Map()
	do {
		const { scrapedTweets, timelineIndexOffset } = await scrapePage(page, [
			...timelineIndexMap.entries(),
		])
		if (timelineIndexOffset === 0 && timelineIndexMap.size > 0) {
			// Lost track of index, abort
			break
		}
		for (let i = 0; i < scrapedTweets.length; i++) {
			const scrapedTweet = scrapedTweets[i]
			const adjustedIndex = timelineIndexOffset + scrapedTweet.timelineIndex
			if (adjustedIndex <= highestTimelineIndex) continue
			if (!scrapedTweet.retweet && !scrapedTweet.isPinned) {
				timelineIndexMap.set(scrapedTweet.tweetID, adjustedIndex)
			}
			if (
				!scrapedTweet.retweet &&
				!scrapedTweet.isPinned &&
				(!oldestNonRetweet ||
					tweetIDIsBefore(scrapedTweet.tweetID, oldestNonRetweet.tweetID))
			) {
				oldestNonRetweet = scrapedTweet
			}
			// Don't include pinned tweet if older than cutoff ID
			if (
				cutoffTweetID &&
				scrapedTweet.isPinned &&
				!tweetIDIsAfter(scrapedTweet.tweetID, cutoffTweetID)
			)
				continue
			highestTimelineIndex = adjustedIndex
			tweets.push(scrapedTweet)
		}
		if (highestTimelineIndex > prevHighestTimelineIndex) {
			staleScrollAttempts = 0
		} else if (staleScrollAttempts === 4) {
			break
		}
		if (
			cutoffTweetID &&
			oldestNonRetweet &&
			tweetIDIsAfter(oldestNonRetweet.tweetID, cutoffTweetID)
		) {
			// Scroll to load more tweets
			try {
				// @ts-ignore
				await scrollPageToBottom(page, { size: 500, delay: 100, stepsLimit: 6 })
			} catch (_) {}
			staleScrollAttempts++
		}
		prevHighestTimelineIndex = highestTimelineIndex
	} while (
		cutoffTweetID &&
		(!oldestNonRetweet ||
			!tweetIDIsBefore(oldestNonRetweet.tweetID, cutoffTweetID))
	)
	return tweets
}

// Tweets expected to be sorted oldest to newest
function createNewRetweetIDs(tweets: ScrapedTweet[]) {
	let previousTweetID = '0'.repeat(19)
	for (let i = 0; i < tweets.length; i++) {
		const tweet = tweets[i]
		if (tweet.retweet) tweet.tweetID = previousTweetID + '+r'
		previousTweetID = tweet.tweetID
	}
}

const scrapePage = (
	page: puppeteer.Page,
	timelineIndexes: [string, number][]
) =>
	page.$$eval(
		'article',
		(articleElements, includeRetweets, timelineIndexes) => {
			const timelineIndexesMap = new Map(timelineIndexes)
			let timelineIndexOffset = 0
			const scrapedTweets = articleElements
				.map((articleElement, i) => {
					const timeEl = articleElement.querySelector('time')
					if (!timeEl) return false // Probably a deleted tweet
					const [, username, , tweetID] = timeEl
						.parentElement!.getAttribute('href')!
						.split('/')
					if (!tweetID) return false // Just in case
					const threadLinks = [
						...articleElement.querySelectorAll(
							`a[href$="${username}/status/${tweetID}"`
						),
					]
					const isThread = threadLinks.some(
						(a) => a.textContent === 'Show this thread'
					)
					const socialContext = articleElement.querySelector(
						'[data-testid="socialContext"]'
					)
					const isRetweet =
						socialContext?.textContent?.endsWith('Retweeted') ?? false
					if (
						!isRetweet &&
						timelineIndexesMap.size > 0 &&
						timelineIndexOffset === 0
					) {
						const existingIndex = timelineIndexesMap.get(tweetID)
						if (existingIndex) timelineIndexOffset = existingIndex - i
					}
					const isPinned = socialContext?.textContent === 'Pinned Tweet'
					const tweet: ScrapedTweet = {
						timestamp: timeEl.dateTime,
						content:
							articleElement.querySelector('[data-testid="tweetText"]')
								?.textContent || undefined,
						username,
						tweetID,
						isThread,
						isPinned,
						timelineIndex: i,
					}
					if (isRetweet) tweet.retweet = { username, tweetID }
					return tweet
				})
				.filter(
					(tweetData) => tweetData && (includeRetweets || !tweetData.retweet)
				) as ScrapedTweet[]
			return { scrapedTweets, timelineIndexOffset }
		},
		INCLUDE_RETWEETS,
		timelineIndexes
	)

type ScrapedTweet = {
	tweetID: string
	timestamp: string
	content?: string
	username: string
	isThread: boolean
	isPinned: boolean
	retweet?: { username: string; tweetID: string }
	timelineIndex: number
}

// Ignore requests for unnecessary resources like media and fonts
// This causes a memory leak so we're not doing it anymore
async function setPageRequestInterceptions(page: puppeteer.Page) {
	await page.setRequestInterception(true)
	page.on('request', (interceptedRequest) => {
		if (interceptedRequest.isInterceptResolutionHandled()) return
		const resourceType = interceptedRequest.resourceType()
		if (
			resourceType === 'image' ||
			resourceType === 'media' ||
			resourceType === 'font'
		) {
			interceptedRequest.abort()
		} else interceptedRequest.continue()
	})
}
