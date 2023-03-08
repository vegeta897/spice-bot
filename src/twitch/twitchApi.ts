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
import { DEV_MODE, HOST_URL, timestampLog } from '../util.js'
import { setTwitchToken, getTwitchToken } from './streamRecord.js'

let authProvider: RefreshingAuthProvider
let apiClient: ApiClient
let helixUsers: Record<AccountType, HelixUser>
let streamerAuthRevoked = false

export const AuthEvents = new Emittery<{
	auth: { accountType: AccountType; token: AccessToken }
	authRevoke: { accountType: AccountType; method: 'sign-out' | 'disconnect' }
}>()

const accountTypes = ['streamer', 'bot', 'admin'] as const
export type AccountType = typeof accountTypes[number]
export const UserAccountTypes: Record<string, AccountType> = {
	[process.env.TWITCH_STREAMER_USERNAME]: 'streamer',
	[process.env.TWITCH_BOT_USERNAME]: 'bot',
	[process.env.TWITCH_ADMIN_USERNAME]: 'admin',
}

export async function createAuthAndApiClient() {
	authProvider = new RefreshingAuthProvider({
		clientId: process.env.TWITCH_CLIENT_ID,
		clientSecret: process.env.TWITCH_CLIENT_SECRET,
		onRefresh: (userId, newToken) => {
			const accountType = getAccountTypeForId(userId)
			if (!accountType) {
				timestampLog(
					`Refreshed token for unknown user ID ${userId}, ${newToken}`
				)
				return
			}
			if (DEV_MODE) timestampLog(`Refreshed token for ${accountType}`)
			// Don't refresh token for streamer if revoked
			if (accountType !== 'streamer' || !streamerAuthRevoked)
				setTwitchToken(accountType, newToken)
		},
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
	setInterval(() => {
		accountTypes.forEach((accountType) => verifyToken(accountType))
	}, 60 * 60 * 1000) // Verify tokens hourly
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

async function verifyToken(accountType: AccountType, token?: AccessToken) {
	if (accountType === 'streamer' && streamerAuthRevoked) return false
	token ||= getTwitchToken(accountType)
	if (!token) return false
	if (accessTokenIsExpired(token)) {
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
	return await apiClient.subscriptions.checkUserSubscription(
		helixUsers.bot,
		helixUsers.streamer
	)
}

function getAccountTypeForId(id: string) {
	const [accountType] =
		Object.entries(helixUsers).find(([accountType, user]) => user.id === id) ||
		[]
	return accountType as AccountType | undefined
}

export async function botIsFollowingStreamer() {
	return await helixUsers.bot.follows(helixUsers.streamer)
}

export async function sendWhisper(toUserID: string, text: string) {
	await apiClient.whispers.sendWhisper(helixUsers.bot, toUserID, text)
}
