import { ApiClient, type HelixUser } from '@twurple/api'
import { type AccessToken, RefreshingAuthProvider } from '@twurple/auth'
import { getData, modifyData } from './db.js'
import { timestampLog } from './util.js'

let authProvider: RefreshingAuthProvider
let apiClient: ApiClient

export async function createAuthAndApiClient() {
	authProvider = new RefreshingAuthProvider({
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
	apiClient = new ApiClient({ authProvider })
	const botUser = await getBotUser()
	const streamerUser = await getStreamerUser()
	addBotUserToAuth(botUser)
	addStreamerToAuth(streamerUser)
	return { authProvider, apiClient, streamerUser }
}

async function getBotUser() {
	const botUser = await apiClient.users.getUserByName(
		process.env.TWITCH_BOT_USERNAME
	)
	if (!botUser)
		throw `Could not find bot by username "${process.env.TWITCH_BOT_USERNAME}"`
	return botUser
}

async function getStreamerUser() {
	const streamerUser = await apiClient.users.getUserByName(
		process.env.TWITCH_STREAMER_USERNAME
	)
	if (!streamerUser)
		throw `Could not find streamer by username "${process.env.TWITCH_STREAMER_USERNAME}"`
	return streamerUser
}

function addStreamerToAuth(user: HelixUser) {
	const streamerToken = getData().twitchStreamerToken as AccessToken
	if (!streamerToken) {
		// TODO: Make sure link sent to actual streamer is using Spice Bot 2.0, not Spice Bot Test
		console.log(
			'REQUIRED: Send this link to the streamer to authorize your app:',
			process.env.TWITCH_REDIRECT_URI + '/auth'
		)
		return
	}
	authProvider.addUser(user, streamerToken)
}

function addBotUserToAuth(user: HelixUser) {
	const botToken = getData().twitchBotToken as AccessToken
	if (!botToken) {
		console.log(
			'REQUIRED: Use your bot account to auth with this link:',
			process.env.TWITCH_REDIRECT_URI + '/auth-bot'
		)
		return
	}
	authProvider.addUser(user, botToken, ['chat'])
}

export async function getUserScopes(user: HelixUser): Promise<string[]> {
	const streamerToken = await authProvider.getAccessTokenForUser(user)
	return streamerToken?.scope || []
}
