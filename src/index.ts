import 'dotenv/config.js'
import { initDB } from './db.js'
import { connectBot } from './discord.js'
import { initTwitch } from './twitch.js'
import { initTwitter } from './twitter.js'
import { initTwitterScraper } from './twitterScraper.js'
import { DEV_MODE, timestampLog } from './util.js'

if (DEV_MODE) console.log('DEV MODE ENABLED')

async function init() {
	timestampLog('Initializing Spice Bot...')
	await initDB()
	await connectBot()
	const twitterModule =
		process.env.TWITTER_USERNAME === ''
			? () => {}
			: process.env.TWITTER_SCRAPE_MODE === 'true'
			? initTwitterScraper
			: initTwitter
	await Promise.all([initTwitch(), twitterModule()])
	timestampLog('Spice Bot is ready!')
}

init()
