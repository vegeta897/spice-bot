import 'dotenv/config.js'
import { initDB } from './db.js'
import { connectBot } from './discord.js'
import { initTwitch } from './twitch.js'
import { checkTwitchAuth, getTokensFromAuthCode } from './twitchAuth.js'
import { initTwitchChat } from './twitchChat.js'
import { initTwitter } from './twitter.js'
import { DEV_MODE, timestampLog } from './util.js'

if (DEV_MODE) console.log('DEV MODE ENABLED')

async function init() {
	timestampLog('Initializing Spice Bot...')
	await initDB()
	// await connectBot()
	// await getTokensFromAuthCode()
	await checkTwitchAuth()
	await Promise.all([initTwitch(), initTwitchChat() /*, initTwitter()*/])
	timestampLog('Spice Bot is ready!')
}

init()
