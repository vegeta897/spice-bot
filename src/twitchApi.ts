import { ApiClient, type HelixUser } from '@twurple/api'
import {
	type AccessToken,
	RefreshingAuthProvider,
	revokeToken,
	getTokenInfo,
} from '@twurple/auth'
import Emittery from 'emittery'
import { getData, modifyData } from './db.js'
import { timestampLog } from './util.js'

let authProvider: RefreshingAuthProvider
let apiClient: ApiClient
let streamerUser: HelixUser
let streamerAuthRevoked = false

export const AuthEvents = new Emittery<{
	botAuthed: { token: AccessToken; scopes: string[] }
	streamerAuthed: { token: AccessToken; scopes: string[] }
	botAuthRevoked: { method: 'sign-out' | 'disconnect' }
	streamerAuthRevoked: { method: 'sign-out' | 'disconnect' }
}>()

export async function createAuthAndApiClient() {
	authProvider = new RefreshingAuthProvider({
		clientId: process.env.TWITCH_CLIENT_ID,
		clientSecret: process.env.TWITCH_CLIENT_SECRET,
		onRefresh: (userId, newTokenData) => {
			timestampLog(
				'refreshed token for',
				userId === botUser.id ? 'bot' : 'streamer'
			)
			if (userId === botUser.id) modifyData({ twitchBotToken: newTokenData })
			if (userId === streamerUser.id && !streamerAuthRevoked)
				modifyData({ twitchStreamerToken: newTokenData })
		},
	})
	apiClient = new ApiClient({ authProvider })
	const botUser = await getBotUser()
	streamerUser = await getStreamerUser()
	addBotUserToAuth(botUser)
	addStreamerToAuth(streamerUser)
	AuthEvents.on('botAuthed', ({ token }) => {
		modifyData({ twitchBotToken: token })
		authProvider.addUser(botUser, token, ['chat'])
	})
	AuthEvents.on('streamerAuthed', ({ token }) => {
		modifyData({ twitchStreamerToken: token })
		authProvider.addUser(streamerUser, token)
		streamerAuthRevoked = false
	})
	AuthEvents.on('botAuthRevoked', ({ method }) => {
		if (method === 'sign-out') {
			const token = getData().twitchBotToken as AccessToken
			try {
				if (token) revokeToken(process.env.TWITCH_CLIENT_ID, token.accessToken)
			} catch (e) {}
		}
		modifyData({ twitchBotToken: null })
	})
	AuthEvents.on('streamerAuthRevoked', ({ method }) => {
		if (method === 'sign-out') {
			const token = getData().twitchStreamerToken as AccessToken
			try {
				if (token) revokeToken(process.env.TWITCH_CLIENT_ID, token.accessToken)
			} catch (e) {}
		}
		modifyData({ twitchStreamerToken: null })
		streamerAuthRevoked = true // To true to prevent token refreshes
	})
	setInterval(() => {
		const { twitchBotToken, twitchStreamerToken } = getData()
		if (twitchBotToken) getTokenInfo(twitchBotToken.accessToken)
		if (twitchStreamerToken) getTokenInfo(twitchStreamerToken.accessToken)
	}, 60 * 60 * 1000) // Validate tokens hourly
	return { authProvider, apiClient, botUser, streamerUser }
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

export async function getUserScopes(user: HelixUser): Promise<string[]> {
	if (user.id === streamerUser.id && streamerAuthRevoked) return []
	const token = await authProvider.getAccessTokenForUser(user)
	return token?.scope || []
}

export async function botIsMod() {
	if (streamerAuthRevoked) return false
	const streamerToken = await authProvider.getAccessTokenForUser(streamerUser)
	if (!streamerToken || !streamerToken.scope.includes('moderation:read'))
		return false
	const mods = await apiClient.moderation.getModerators(streamerUser)
	return mods.data.some(
		(mod) => mod.userName === process.env.TWITCH_BOT_USERNAME
	)
}
