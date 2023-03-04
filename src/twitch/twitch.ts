import { initExpressApp } from '../express.js'
import { createAuthAndApiClient } from './twitchApi.js'
import { initTwitchChat } from './twitchChat.js'
import { initTwitchEventSub } from './twitchEventSub.js'
import { initTwitchOAuthServer } from './twitchOAuth.js'

export async function initTwitch() {
	const { authProvider, apiClient, helixUsers } = await createAuthAndApiClient()
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
