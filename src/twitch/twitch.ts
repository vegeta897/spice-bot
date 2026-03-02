import { initExpressServer } from '../express.js'
import { initEmotes } from './chat/emotes.js'
import { createApiClient } from './twitchApi.js'
import { initTwitchChat } from './chat/twitchChat.js'
import { initTwitchEventSub } from './eventSub.js'
import { initTwitchOAuthServer } from './twitchOAuth.js'
import { initWebsocket } from './overlay/websocket.js'

export async function initTwitch() {
	if (!process.env.TWITCH_STREAMER_USERNAME) {
		console.log('Missing TWITCH_STREAMER_USERNAME, skipping Twitch module')
		return
	}
	const apiClient = await createApiClient()
	await initEmotes({ apiClient })
	const { expressApp, server } = await initExpressServer()
	await Promise.all([
		initTwitchOAuthServer(expressApp),
		initWebsocket(server),
		initTwitchChat({ apiClient }),
		initTwitchEventSub({ apiClient, expressApp }),
	])
}
