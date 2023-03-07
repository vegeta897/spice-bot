import { initExpressApp } from '../express.js'
import { initEmotes } from './emotes.js'
import { createAuthAndApiClient } from './twitchApi.js'
import { initTwitchChat } from './twitchChat.js'
import { initTwitchEventSub } from './eventSub.js'
import { initTwitchOAuthServer } from './twitchOAuth.js'

export async function initTwitch() {
	const { authProvider, apiClient, helixUsers } = await createAuthAndApiClient()
	await initEmotes({ apiClient, helixUsers })
	const expressApp = await initExpressApp()
	initTwitchOAuthServer(expressApp)
	await Promise.all([
		initTwitchChat(authProvider, helixUsers.bot),
		initTwitchEventSub({
			apiClient,
			expressApp,
			streamerUser: helixUsers.streamer,
		}),
	])
}
