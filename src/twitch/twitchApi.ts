import { ApiClient, type HelixUser } from '@twurple/api'
import {
	type AccessToken,
	RefreshingAuthProvider,
	revokeToken,
	getTokenInfo,
	accessTokenIsExpired,
	refreshUserToken,
} from '@twurple/auth'
import Emittery from 'emittery'
import { DEV_MODE, HOST_URL, sleep } from '../util.js'
import { timestampLog } from '../logger.js'
import { setTwitchToken, getTwitchToken } from './streamRecord.js'
import { getData } from '../db.js'
import { initChatClient } from './chat/twitchChat.js'

let authProvider: RefreshingAuthProvider
let apiClient: ApiClient
let helixUsers: Record<AccountType, HelixUser>
let streamerAuthRevoked = false

export const AuthEvents = new Emittery<{
	auth: { accountType: AccountType; token: AccessToken }
	authRevoke: { accountType: AccountType; method: 'sign-out' | 'disconnect' }
}>()

const accountTypes = ['streamer', 'bot', 'admin'] as const
export type AccountType = (typeof accountTypes)[number]
export const UserAccountTypes: Record<string, AccountType> = {
	[process.env.TWITCH_STREAMER_USERNAME]: 'streamer',
	[process.env.TWITCH_BOT_USERNAME]: 'bot',
	[process.env.TWITCH_ADMIN_USERNAME]: 'admin',
}

export async function createAuthAndApiClient() {
	authProvider = new RefreshingAuthProvider({
		clientId: process.env.TWITCH_CLIENT_ID,
		clientSecret: process.env.TWITCH_CLIENT_SECRET,
	})
	apiClient = new ApiClient({ authProvider })
	helixUsers = {
		bot: await getUser(process.env.TWITCH_BOT_USERNAME),
		streamer: await getUser(process.env.TWITCH_STREAMER_USERNAME),
		admin: await getUser(process.env.TWITCH_ADMIN_USERNAME),
	}
	for (const accountType of accountTypes) {
		await addUserToAuth(accountType)
	}
	if (!(await botIsFollowingStreamer())) {
		console.log(
			'RECOMMENDED: Your bot is not following the streamer. Following can unlock free emotes!'
		)
	}
	authProvider.onRefresh((userId, newToken) => {
		const accountType = getAccountTypeForId(userId)
		if (!accountType) {
			timestampLog(`Refreshed token for unknown user ID ${userId}, ${newToken}`)
			return
		}
		if (DEV_MODE) timestampLog(`Refreshed token for ${accountType}`)
		// Don't refresh token for streamer if revoked
		if (accountType !== 'streamer' || !streamerAuthRevoked)
			setTwitchToken(accountType, newToken)
	})
	authProvider.onRefreshFailure(async (userId /* TODO: error */) => {
		const accountType = getAccountTypeForId(userId)
		timestampLog(`WARNING: Failed to refresh token for ${accountType}`)
		if (accountType === 'bot') {
			// TODO: Error object is passed in here as of new twurple version
			// We don't know the specific reason the refresh failed,
			// but can guess for the bot account that it was a simple request timeout,
			// so we will automatically retry the refresh to revive the token
			timestampLog('Attempting to revive bot token...')
			let retryBackoff = 1
			while (true) {
				await sleep(15 * retryBackoff++ * 1000)
				try {
					const token = await verifyToken('bot', true) // Force refresh
					if (!token) continue
					authProvider.addUser(userId, token, ['chat'])
					timestampLog('Bot token revived, reconnecting chat')
					initChatClient(authProvider)
					break
				} catch (e) {}
			}
		}
	})
	AuthEvents.on('auth', ({ accountType, token }) => {
		setTwitchToken(accountType, token)
		addUserToAuth(accountType, token)
		if (accountType === 'streamer') streamerAuthRevoked = false
	})
	AuthEvents.on('authRevoke', async ({ accountType, method }) => {
		if (method === 'sign-out') {
			const token = getTwitchToken(accountType)
			if (token) {
				try {
					await revokeToken(process.env.TWITCH_CLIENT_ID, token.accessToken)
				} catch (_) {}
			}
		}
		setTwitchToken(accountType, null)
		if (accountType === 'streamer') streamerAuthRevoked = true // To true to prevent token refreshes
	})
	setInterval(
		() => {
			accountTypes.forEach((accountType) => verifyToken(accountType))
		},
		60 * 60 * 1000
	) // Verify tokens hourly
	if (DEV_MODE)
		apiClient.onRequest(({ httpStatus, options, resolvedUserId }) => {
			const userType = resolvedUserId && getAccountTypeForId(resolvedUserId)
			let log = ''
			if (userType) log += `${userType} account `
			const { method, query = [], scopes = [], url } = options
			if (method) log += `sent ${method} request `
			log += `to URL ${url} `
			const queryParams = Object.entries(query)
			if (queryParams.length > 0)
				log += `with param(s) ${queryParams.map(
					([name, value]) => `${name}=${value}`
				)} `
			if (scopes.length > 0) log += ` using scope(s) ${scopes.join(',')} `
			log += `(${httpStatus})`
			timestampLog(log)
		})
	return { authProvider, apiClient }
}

async function getUser(username: string) {
	const user = await apiClient.users.getUserByName(username)
	if (!user)
		throw `Could not find ${UserAccountTypes[username]} by username "${username}"`
	return user
}

async function addUserToAuth(
	accountType: AccountType,
	token?: AccessToken | false
) {
	token ||= await verifyToken(accountType)
	if (!token) {
		// Print auth link to console
		const authStrings = {
			bot: [
				'REQUIRED: Use your bot account to auth with this link:',
				'/auth?bot',
			],
			streamer: [
				'REQUIRED: Send this link to the streamer to authorize your app:',
				'/auth',
			],
			admin: ['Use your own account to auth with this link:', '/auth?admin'],
		}[accountType]
		console.log(authStrings[0], HOST_URL + authStrings[1])
		return
	}
	if (accountType === 'bot') {
		authProvider.addUser(helixUsers[accountType], token, ['chat'])
	} else {
		authProvider.addUser(helixUsers[accountType], token)
	}
}

async function verifyToken(accountType: AccountType, forceRefresh?: boolean) {
	if (accountType === 'streamer' && streamerAuthRevoked) return false
	let token = getTwitchToken(accountType)
	if (!token) return false
	if (forceRefresh || accessTokenIsExpired(token)) {
		token = await refreshUserToken(
			process.env.TWITCH_CLIENT_ID,
			process.env.TWITCH_CLIENT_SECRET,
			token.refreshToken!
		)
		setTwitchToken(accountType, token)
	}
	await getTokenInfo(token.accessToken)
	return token
}

export const getUserByAccountType = (accountType: AccountType) =>
	helixUsers[accountType]

export async function getAccountScopes(
	accountType: AccountType
): Promise<string[]> {
	const user = getUserByAccountType(accountType)
	if (user.id === helixUsers.streamer.id && streamerAuthRevoked) return []
	const token = await authProvider.getAccessTokenForUser(user)
	return token?.scope || []
}

export async function botIsMod() {
	if (streamerAuthRevoked) return false
	const streamerToken = await authProvider.getAccessTokenForUser(
		helixUsers.streamer
	)
	if (!streamerToken || !streamerToken.scope.includes('moderation:read'))
		return false
	const mods = await apiClient.moderation.getModerators(helixUsers.streamer)
	return mods.data.some(
		(mod) => mod.userName === process.env.TWITCH_BOT_USERNAME
	)
}

export async function getBotSub() {
	if (DEV_MODE) return { tier: 1000 }
	const { twitchBotLastSubbed } = getData()
	// Check if bot subbed in the last 30 days
	if (Date.now() - twitchBotLastSubbed < 30 * 24 * 60 * 60 * 1000) {
		return { tier: 1000 }
	}
	// Maybe replace this with a db value, updated with eventsub?
	// Then it can be cached and not require an API call every time
	try {
		return await helixUsers.bot.getSubscriptionTo(helixUsers.streamer)
	} catch (e) {
		timestampLog('Error fetching bot sub', e)
		return null
	}
}

function getAccountTypeForId(id: string) {
	const [accountType] =
		Object.entries(helixUsers).find(([, user]) => user.id === id) || []
	return accountType as AccountType | undefined
}

export async function botIsFollowingStreamer() {
	if (DEV_MODE) return true
	try {
		const botFollow = await helixUsers.bot.getFollowedChannel(
			helixUsers.streamer
		)
		return !!botFollow
	} catch (e) {
		timestampLog('Error checking if bot follows streamer:', e)
		return false
	}
}

export async function sendWhisper(toUserID: string, text: string) {
	try {
		await apiClient.whispers.sendWhisper(helixUsers.bot, toUserID, text)
	} catch (e) {
		timestampLog('Error sending whisper', e)
	}
}
