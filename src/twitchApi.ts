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
	botAuthed: { token: AccessToken }
	streamerAuthed: { token: AccessToken }
	adminAuthed: { token: AccessToken }
	botAuthRevoked: { method: 'sign-out' | 'disconnect' }
	streamerAuthRevoked: { method: 'sign-out' | 'disconnect' }
	adminAuthRevoked: { method: 'sign-out' | 'disconnect' }
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
	const adminUser = await getAdminUser()
	addBotUserToAuth(botUser)
	addStreamerToAuth(streamerUser)
	addAdminUserToAuth(adminUser)
	AuthEvents.on('botAuthed', ({ token }) => {
		modifyData({ twitchBotToken: token })
		authProvider.addUser(botUser, token, ['chat'])
	})
	AuthEvents.on('streamerAuthed', ({ token }) => {
		modifyData({ twitchStreamerToken: token })
		authProvider.addUser(streamerUser, token)
		streamerAuthRevoked = false
	})
	AuthEvents.on('adminAuthed', ({ token }) => {
		modifyData({ twitchAdminToken: token })
		authProvider.addUser(adminUser, token)
	})
	AuthEvents.on('botAuthRevoked', ({ method }) => {
		if (method === 'sign-out') {
			const token = getData().twitchBotToken as AccessToken
			if (token) revokeToken(process.env.TWITCH_CLIENT_ID, token.accessToken)
		}
		modifyData({ twitchBotToken: null })
	})
	AuthEvents.on('streamerAuthRevoked', ({ method }) => {
		if (method === 'sign-out') {
			const token = getData().twitchStreamerToken as AccessToken
			if (token) revokeToken(process.env.TWITCH_CLIENT_ID, token.accessToken)
		}
		modifyData({ twitchStreamerToken: null })
		streamerAuthRevoked = true // To true to prevent token refreshes
	})
	AuthEvents.on('adminAuthRevoked', ({ method }) => {
		if (method === 'sign-out') {
			const token = getData().twitchAdminToken as AccessToken
			if (token) revokeToken(process.env.TWITCH_CLIENT_ID, token.accessToken)
		}
		modifyData({ twitchAdminToken: null })
	})
	setInterval(() => {
		const { twitchBotToken, twitchStreamerToken, twitchAdminToken } = getData()
		if (twitchBotToken) getTokenInfo(twitchBotToken.accessToken)
		if (twitchStreamerToken) getTokenInfo(twitchStreamerToken.accessToken)
		if (twitchAdminToken) getTokenInfo(twitchAdminToken.accessToken)
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

async function getAdminUser() {
	const adminUser = await apiClient.users.getUserByName(
		process.env.TWITCH_ADMIN_USERNAME
	)
	if (!adminUser)
		throw `Could not find admin by username "${process.env.TWITCH_ADMIN_USERNAME}"`
	return adminUser
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

function addAdminUserToAuth(user: HelixUser) {
	const adminToken = getData().twitchAdminToken as AccessToken
	if (!adminToken) {
		console.log(
			'Use your account to auth with this link:',
			process.env.TWITCH_REDIRECT_URI + '/auth-admin'
		)
		return
	}
	authProvider.addUser(user, adminToken)
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
