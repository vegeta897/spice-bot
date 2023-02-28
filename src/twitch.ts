import { createAuthAndApiClient } from './twitchApi.js'
import { initTwitchChat } from './twitchChat.js'
import { initTwitchEventSub } from './twitchEventSub.js'

export async function initTwitch() {
	const { authProvider, apiClient, streamerUser } =
		await createAuthAndApiClient()
	await Promise.all([
		initTwitchChat(authProvider),
		initTwitchEventSub({ apiClient, streamerUser }),
	])
}
