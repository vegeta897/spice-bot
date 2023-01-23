import 'dotenv/config.js'
import { initDB } from './db.js'
import { connectBot } from './discord.js'
import { initTwitch } from './twitch.js'
import { initTwitter } from './twitter.js'
import { DEV_MODE, timestampLog } from './util.js'

if (DEV_MODE) console.log('DEV MODE ENABLED')

async function init() {
	timestampLog('Initializing Spice Bot...')
	await initDB()
	await connectBot()
	await Promise.all([initTwitch(), initTwitter()])
	timestampLog('Spice Bot is ready!')
}

init()
