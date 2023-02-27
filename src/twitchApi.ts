import { ApiClient, type HelixUser } from '@twurple/api'
import { type AccessToken, RefreshingAuthProvider } from '@twurple/auth'
import { getData, modifyData } from './db.js'
import { timestampLog } from './util.js'

export async function createAuthAndApiClient() {
	const authProvider = new RefreshingAuthProvider({
		clientId: process.env.TWITCH_CLIENT_ID,
		clientSecret: process.env.TWITCH_CLIENT_SECRET,
		onRefresh: async (userId, newTokenData) => {
			timestampLog(
				'refreshed token for',
				userId === botUser.id ? 'bot' : 'streamer'
			)
			if (userId === botUser.id)
				await modifyData({ twitchBotToken: newTokenData })
			if (userId === streamerUser.id)
				await modifyData({ twitchStreamerToken: newTokenData })
		},
	})
	const apiClient = new ApiClient({ authProvider })
	const botUser = await getBotUser(apiClient)
	const streamerUser = await getStreamerUser(apiClient)
	addBotUserToAuth(botUser, authProvider)
	addStreamerToAuth(streamerUser, authProvider)
	return { authProvider, apiClient, streamerUser }
}

export async function getBotUser(apiClient: ApiClient) {
	const botUser = await apiClient.users.getUserByName(
		process.env.TWITCH_BOT_USERNAME
	)
	if (!botUser)
		throw `Could not find bot by username "${process.env.TWITCH_BOT_USERNAME}"`
	return botUser
}

export async function getStreamerUser(apiClient: ApiClient) {
	const botUser = await apiClient.users.getUserByName(
		process.env.TWITCH_STREAMER_USERNAME
	)
	if (!botUser)
		throw `Could not find streamer by username "${process.env.TWITCH_STREAMER_USERNAME}"`
	return botUser
}

function addStreamerToAuth(
	user: HelixUser,
	authProvider: RefreshingAuthProvider
) {
	let twitchStreamerToken = getData().twitchStreamerToken as AccessToken
	if (!twitchStreamerToken) {
		// TODO: Make sure link sent to actual streamer is using Spice Bot 2.0, not Spice Bot Test
		console.log(
			'Missing Twitch streamer token! Send this link to the streamer to authorize your app:',
			process.env.TWITCH_REDIRECT_URI + '/auth'
		)
		return
	}
	authProvider.addUser(user, twitchStreamerToken)
}

function addBotUserToAuth(
	user: HelixUser,
	authProvider: RefreshingAuthProvider
) {
	let twitchBotToken = getData().twitchBotToken as AccessToken
	if (!twitchBotToken) {
		console.log(
			'Missing Twitch bot token! Use your bot account to auth with this link:',
			process.env.TWITCH_REDIRECT_URI + '/auth-bot'
		)
		return
	}
	authProvider.addUser(user, twitchBotToken, ['chat'])
}
