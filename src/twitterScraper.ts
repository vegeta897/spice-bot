import puppeteer from 'puppeteer'

export async function initTwitterScraper() {
	const browser = await puppeteer.launch()
	console.log('puppeteer browser launched')
	const page = await browser.newPage()
	console.log('page created')

	await page.setViewport({ width: 1600, height: 3000 })
	await page.goto(`https://twitter.com/${process.env.TWITTER_USERNAME}`)
	console.log('navigated to twitter')

	await page.waitForSelector('article')
	console.log(await getTweets(page))
}

const getTweets = async (page: puppeteer.Page) =>
	await page.evaluate(() => {
		return [...document.querySelectorAll('article')]
			.filter((el) => {
				const pinned =
					el.querySelector('[data-testid="socialContext"]')?.textContent ===
					'Pinned Tweet'
				if (pinned) return false
				return true
			})
			.map((el) => {
				const timeEl = el.querySelector('time')!
				const [, username, , id] = timeEl
					.parentElement!.getAttribute('href')!
					.split('/')
				return {
					timestamp: timeEl.dateTime,
					content: el.querySelector('[data-testid="tweetText"]')?.textContent,
					username,
					id,
				}
			})
	})
