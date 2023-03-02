import { createAuthAndApiClient } from './twitchApi.js'
import { initTwitchChat } from './twitchChat.js'
import { initTwitchEventSub } from './twitchEventSub.js'
import { initTwitchOAuthServer } from './twitchOAuth.js'

export async function initTwitch() {
	const { authProvider, apiClient, botUser, streamerUser } =
		await createAuthAndApiClient()
	await Promise.all([
		initTwitchChat(authProvider, botUser),
		initTwitchEventSub({ apiClient, streamerUser }),
		initTwitchOAuthServer(),
	])
}
