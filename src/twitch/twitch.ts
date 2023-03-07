import { initExpressApp } from '../express.js'
import { initEmotes } from './emotes.js'
import { createAuthAndApiClient } from './twitchApi.js'
import { initTwitchChat } from './twitchChat.js'
import { initTwitchEventSub } from './eventSub.js'
import { initTwitchOAuthServer } from './twitchOAuth.js'

export async function initTwitch() {
	const { authProvider, apiClient } = await createAuthAndApiClient()
	await initEmotes({ apiClient })
	const expressApp = await initExpressApp()
	initTwitchOAuthServer(expressApp)
	await Promise.all([
		initTwitchChat(authProvider),
		initTwitchEventSub({ apiClient, expressApp }),
	])
}
