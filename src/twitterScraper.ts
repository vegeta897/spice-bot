import puppeteer from 'puppeteer'

// TODO: Make this a separate module on NPM?

const USERNAME = process.env.TWITTER_USERNAME
const INCLUDE_RETWEETS = process.env.TWITTER_INCLUDE_RETWEETS === 'true'

export async function initTwitterScraper() {
	const browser = await puppeteer.launch()
	console.log('puppeteer browser launched')
	const page = await browser.newPage()
	console.log('page created')
	await setPageRequestInterceptions(page)
	await page.setViewport({ width: 1600, height: 3000 })
	await page.goto(`https://twitter.com/${USERNAME}`)
	console.log('navigated to twitter')

	try {
		await page.waitForSelector('article')
		console.log(await getTweets(page))
	} catch (e) {
		console.log(`No <article> element found! Does ${USERNAME} have any tweets?`)
	}
}

const getTweets = async (page: puppeteer.Page) =>
	await page.$$eval(
		'article',
		(tweets, includeRetweets) => {
			return tweets
				.map((articleElement) => {
					const timeEl = articleElement.querySelector('time')!
					const [, username, , tweetID] = timeEl!
						.parentElement!.getAttribute('href')!
						.split('/')
					if (!tweetID) return false
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
						id: tweetID,
						isThread,
						isRetweet: socialContext?.textContent?.endsWith('Retweeted'),
					}
				})
				.filter(
					(tweetData) => tweetData && (includeRetweets || !tweetData.isRetweet)
				)
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
