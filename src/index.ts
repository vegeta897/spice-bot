import 'dotenv/config.js'
import { initDB } from './db.js'
import { connectBot } from './discord.js'
import { initTwitter } from './twitter/twitter.js'
import { DEV_MODE } from './util.js'
import { timestampLog } from './logger.js'
import { initTwitch } from './twitch/twitch.js'

if (DEV_MODE) console.log('DEV MODE ENABLED')

async function init() {
	timestampLog('Initializing Spice Bot...')
	await initDB()
	await connectBot()
	await Promise.all([initTwitch(), initTwitter()])
	timestampLog('Spice Bot is ready!')
}

init()
