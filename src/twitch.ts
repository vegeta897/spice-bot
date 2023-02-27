import { createAuthAndApiClient } from './twitchApi.js'
import { initTwitchChat } from './twitchChat.js'
import { initTwitchEventSub } from './twitchEventSub.js'

export async function initTwitch() {
	const { authProvider, apiClient, streamerUser } =
		await createAuthAndApiClient()
	await initTwitchChat(authProvider)
	await initTwitchEventSub({ apiClient, streamerUser })
}
