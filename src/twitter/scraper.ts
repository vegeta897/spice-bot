import puppeteer from 'puppeteer'
import { scrollPageToBottom } from 'puppeteer-autoscroll-down'
import { deleteTweetRecord, getTweetRecords } from './tweetRecord.js'
import { deleteTweetMessage } from '../discord.js'
import { checkTweetPingButtons, postTweet } from './twitter.js'
import { DEV_MODE, sortByProp, timestampLog } from '../util.js'

// Make this a separate module on NPM?

const USERNAME = process.env.TWITTER_USERNAME
const INCLUDE_RETWEETS = process.env.TWITTER_INCLUDE_RETWEETS === 'true'
const SCRAPE_INTERVAL = 30 * 1000 // 30 seconds

let page: puppeteer.Page
let checkingForTweets = false

type ScrapedTweet = {
	tweetID: string
	timestamp: string
	content?: string
	username: string
	isThread: boolean
	isRetweet: boolean
	isPinned: boolean
	// TODO: Add timeline position number so new retweets can be detected
}

export async function initTwitterScraper() {
	const browser = await puppeteer.launch(/*{ headless: !DEV_MODE }*/)
	page = await browser.newPage()
	await setPageRequestInterceptions(page)
	await page.setViewport({ width: 1600, height: 3000 })
	checkForTweets()
	setInterval(checkForTweets, SCRAPE_INTERVAL)
	console.log('Tweet scraper connected')
}

async function checkForTweets() {
	if (checkingForTweets) {
		timestampLog(
			`Tried to check tweets while previous check (${(
				SCRAPE_INTERVAL / 1000
			).toFixed(0)} sec ago) was still running`
		)
		return
	}
	if (DEV_MODE) timestampLog('checking for tweets')
	checkingForTweets = true
	try {
		await page.goto(`https://twitter.com/${USERNAME}`)
	} catch (e) {
		timestampLog(`Error navigating to twitter.com/${USERNAME}`, e)
		return
	}
	try {
		await page.waitForSelector('article')
	} catch (e) {
		timestampLog(
			`No <article> element found! Does ${USERNAME} have any tweets, or are they protected?`
		)
		return
	}
	const recordedTweets = getTweetRecords()
	const newestRecordedTweet = recordedTweets.at(-1)

	const scrapedTweets = sortByProp(
		await scrapeTweets(page, newestRecordedTweet?.tweet_id),
		'tweetID'
	)
	if (scrapedTweets.length === 0) return
	const oldestScrapedTweet = scrapedTweets[0]

	// Post recent unrecorded tweets
	for (const { tweetID, timestamp } of scrapedTweets) {
		if (!newestRecordedTweet) {
			// If there are no recorded tweets, only post brand new tweets
			if (new Date(timestamp).getTime() < Date.now() - SCRAPE_INTERVAL * 4)
				continue
		} else {
			// Don't post any tweet older than the newest recorded tweet

			// TODO: This won't work right with retweets since they don't have current IDs or timestamps!

			if (tweetID <= newestRecordedTweet.tweet_id) continue
		}
		await postTweet(tweetID)
	}

	// Check for deleted tweets
	for (const tweetRecord of recordedTweets) {
		// Ignore tweets outside of scrape range
		if (tweetRecord.tweet_id < oldestScrapedTweet.tweetID) continue
		if (scrapedTweets.find((st) => st.tweetID === tweetRecord.tweet_id))
			continue
		timestampLog(
			`Deleting message ID ${tweetRecord.message_id} for tweet ID ${tweetRecord.tweet_id}`
		)
		deleteTweetRecord(tweetRecord)
		await deleteTweetMessage(tweetRecord.message_id)
	}
	checkTweetPingButtons()
	checkingForTweets = false
}

const scrapeTweets = async (
	page: puppeteer.Page,
	afterTweetID?: string
): Promise<ScrapedTweet[]> => {
	const tweets: ScrapedTweet[] = []
	let oldestTweet: ScrapedTweet | null = null
	let prevOldestTweetID = ''
	do {
		const scrapedTweets = await scrapePage(page)
		for (const scrapedTweet of scrapedTweets) {
			if (tweets.find((t) => t.tweetID === scrapedTweet.tweetID)) continue
			if (
				!scrapedTweet.isPinned &&
				!scrapedTweet.isRetweet &&
				(!oldestTweet || scrapedTweet.tweetID < oldestTweet.tweetID)
			) {
				oldestTweet = scrapedTweet
			}
			tweets.push(scrapedTweet)
		}
		// Break if no more tweets can be found
		if (prevOldestTweetID === oldestTweet?.tweetID) break
		if (afterTweetID && oldestTweet && oldestTweet.tweetID > afterTweetID) {
			// Scroll to load more tweets
			try {
				// @ts-ignore
				await scrollPageToBottom(page, { size: 500, delay: 50 })
				await page.waitForResponse((response) => response.status() === 200)
			} catch (e) {
				timestampLog('Error scrolling for more tweets', e)
				break
			}
		}
		// Break if we found at least one tweet, and no afterTweetID requirement
		if (!afterTweetID && oldestTweet) break
		prevOldestTweetID = oldestTweet?.tweetID || ''
	} while (afterTweetID && (!oldestTweet || oldestTweet.tweetID > afterTweetID))
	return tweets
}

const scrapePage = (page: puppeteer.Page) =>
	page.$$eval(
		'article',
		(articleElements, includeRetweets) => {
			return articleElements
				.map((articleElement) => {
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
					return {
						timestamp: timeEl.dateTime,
						content: articleElement.querySelector('[data-testid="tweetText"]')
							?.textContent,
						username,
						tweetID,
						isThread,
						isRetweet:
							socialContext?.textContent?.endsWith('Retweeted') ?? false,
						isPinned: socialContext?.textContent === 'Pinned Tweet',
					}
				})
				.filter(
					(tweetData) => tweetData && (includeRetweets || !tweetData.isRetweet)
				) as ScrapedTweet[]
		},
		INCLUDE_RETWEETS
	)

// Ignore requests for unnecessary resources like media and fonts
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
