import puppeteer from 'puppeteer'

const USERNAME = process.env.TWITTER_USERNAME

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
	} catch (e) {
		console.log(`No <article> element found! Does ${USERNAME} have any tweets?`)
	}
	console.log(await getTweets(page))
}

const getTweets = async (page: puppeteer.Page) =>
	await page.$$eval(
		'article',
		(tweets, username) => {
			return (
				tweets
					// Not filtering pinned tweets because if a new one is pinned we may miss it
					// We're going to filter out old tweets anyway with minimal effort
					// .filter((articleElement) => {
					// 	const socialContext = articleElement.querySelector(
					// 		'[data-testid="socialContext"]'
					// 	)
					// 	return socialContext?.textContent !== 'Pinned Tweet'
					// })
					.map((articleElement) => {
						const timeEl = articleElement.querySelector('time')!
						const [, username, , tweetID] = timeEl!
							.parentElement!.getAttribute('href')!
							.split('/')
						const threadLinks = [
							...articleElement.querySelectorAll(
								`a[href$="${username}/status/${tweetID}"`
							),
						]
						const isThread = threadLinks.some(
							(a) => a.textContent === 'Show this thread'
						)
						return {
							timestamp: timeEl.dateTime,
							content: articleElement.querySelector('[data-testid="tweetText"]')
								?.textContent,
							username,
							id: tweetID,
							isThread,
						}
					})
					.filter((tweetData) => tweetData.username === username)
			)
		},
		USERNAME
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
