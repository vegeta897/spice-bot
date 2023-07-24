import puppeteer from 'puppeteer'
import { scrollPageToBottom } from 'puppeteer-autoscroll-down'
import {
	TweetRecord,
	deleteTweetRecord,
	getTweetRecords,
	tweetIDIsAfter,
	tweetIDIsBefore,
} from './tweetRecord.js'
import { deleteTweetMessage } from '../discord.js'
import { checkTweetPingButtons, postTweet } from './twitter.js'
import { DEV_MODE } from '../util.js'
import { timestampLog } from '../logger.js'

// Make this a separate module on NPM?

// TODO: Scrape nitter.net instead

const AUTH_TOKEN = process.env.TWITTER_AUTH_TOKEN_COOKIE
const USERNAME = process.env.TWITTER_USERNAME
const INCLUDE_RETWEETS = process.env.TWITTER_INCLUDE_RETWEETS === 'true'
const SCRAPE_INTERVAL = (DEV_MODE ? 1 : 3) * 60 * 1000 // 3 minutes
const ERROR_THRESHOLD = 30 * 60 * 1000 // 30 minutes

let page: puppeteer.Page
let checkingForTweets = false
let firstErrorTime: number | null = null
let tempLatestTweetID: string | null = null

export async function initTwitterScraper() {
	const browser = await puppeteer.launch({ headless: 'new' })
	page = await browser.newPage()
	// await setPageRequestInterceptions(page)
	await page.setViewport({ width: 1600, height: 3000 })
	await page.setCookie({
		name: 'auth_token',
		value: AUTH_TOKEN,
		httpOnly: true,
		secure: true,
		domain: '.twitter.com',
	})
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

	const recordedTweets = getTweetRecords()
	const newestRecordedTweet = recordedTweets.at(-1)
	const oldestRecordedTweet = recordedTweets[0]

	let scrapedTweets: ScrapedTweet[]
	// if (DEV_MODE) timestampLog('checking for tweets')
	checkingForTweets = true

	try {
		await page.goto(`https://twitter.com/${USERNAME}`)
		await page.waitForSelector('article')
		scrapedTweets = await scrapeTweets(
			page,
			tempLatestTweetID || oldestRecordedTweet?.tweet_id
		)
	} catch (e: any) {
		if (DEV_MODE) {
			const errorString = e instanceof Error ? e.message : String(e)
			console.log(errorString)
		}
		// const message = errorString.includes('context')
		// 	? '(context destroyed)'
		// 	: errorString.includes('Page.navigate timed out') ||
		// 	  errorString.includes('Navigation timeout')
		// 	? '(timed out)'
		// 	: errorString
		// timestampLog(`Error navigating to twitter.com/${USERNAME}`, message)
		const now = Date.now()
		firstErrorTime ||= now
		if (now - firstErrorTime >= ERROR_THRESHOLD) {
			timestampLog(
				`Tweet scraper failed all attempts for 30 minutes. Does ${USERNAME} have no tweets, or are they protected?`
			)
			firstErrorTime = now
		}
		checkingForTweets = false
		return
	}
	firstErrorTime = null

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
	const tweetsToCheck: TweetRecord[] = []
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
			`Recorded tweet ID ${tweetRecord.tweet_id} not found in scrape`
		)
		tweetsToCheck.push(tweetRecord)
	}
	// Verify each missing tweet before deleting
	if (tweetsToCheck.length > 0) {
		for (const tweetToCheck of tweetsToCheck) {
			const tweetExists = await doesTweetExist(page, tweetToCheck.tweet_id)
			if (tweetExists) {
				timestampLog(
					`Tweet ID ${tweetToCheck.tweet_id} exists, skipping delete`
				)
			} else {
				timestampLog(
					`Deleting message ID ${tweetToCheck.message_id} for tweet ID ${tweetToCheck.tweet_id}`
				)
				deleteTweetRecord(tweetToCheck)
				await deleteTweetMessage(tweetToCheck.message_id)
			}
		}
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
		const { scrapedTweets, timelineIndexOffset } = await scrapeProfile(page, [
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

const scrapeProfile = (
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

const doesTweetExist = async (page: puppeteer.Page, tweetID: string) => {
	await page.goto(`https://twitter.com/${USERNAME}/status/${tweetID}`)
	await page.waitForNetworkIdle()
	return await page.$$eval(
		'div',
		(divElements) =>
			!divElements.some(
				(div) => div.getAttribute('data-testid') === 'error-detail'
			)
	)
}

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
