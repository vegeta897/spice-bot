import { ApiClient, type HelixUser } from '@twurple/api'
import {
	type AccessToken,
	RefreshingAuthProvider,
	revokeToken,
	getTokenInfo,
} from '@twurple/auth'
import Emittery from 'emittery'
import { getTwitchToken, setTwitchToken } from './db.js'
import { HOST_URL, timestampLog } from './util.js'

let authProvider: RefreshingAuthProvider
let apiClient: ApiClient
let helixUsers: Record<AccountType, HelixUser>
let streamerAuthRevoked = false

export const AuthEvents = new Emittery<{
	auth: { accountType: AccountType; token: AccessToken }
	authRevoke: { accountType: AccountType; method: 'sign-out' | 'disconnect' }
}>()

export type AccountType = 'streamer' | 'bot' | 'admin'
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
			timestampLog(`Refreshed token for ${accountType}`)
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
	Object.entries(helixUsers).forEach(([accountType, user]) =>
		addUserToAuth(accountType as AccountType)
	)
	AuthEvents.on('auth', ({ accountType, token }) => {
		setTwitchToken(accountType, token)
		addUserToAuth(accountType)
		if (accountType === 'streamer') streamerAuthRevoked = false
	})
	AuthEvents.on('authRevoke', async ({ accountType, method }) => {
		if (method === 'sign-out') {
			const token = getTwitchToken(accountType)
			if (token) {
				try {
					await revokeToken(process.env.TWITCH_CLIENT_ID, token.accessToken)
				} catch (err) {
					console.log(err)
				}
			}
		}
		setTwitchToken(accountType, null)
		if (accountType === 'streamer') streamerAuthRevoked = true // To true to prevent token refreshes
	})
	setInterval(() => {
		Object.keys(helixUsers).forEach((accountType) => {
			const token = getTwitchToken(accountType as AccountType)
			if (token) getTokenInfo(token.accessToken)
		})
	}, 60 * 60 * 1000) // Validate tokens hourly
	return { authProvider, apiClient, helixUsers }
}

async function getUser(username: string) {
	const user = await apiClient.users.getUserByName(username)
	if (!user)
		throw `Could not find ${UserAccountTypes[username]} by username "${username}"`
	return user
}

function addUserToAuth(accountType: AccountType) {
	const token = getTwitchToken(accountType) as AccessToken
	if (!token) {
		const authStrings = {
			bot: [
				'REQUIRED: Use your bot account to auth with this link:',
				'/auth-bot',
			],
			streamer: [
				'REQUIRED: Send this link to the streamer to authorize your app:',
				'/auth',
			],
			admin: ['Use your own account to auth with this link:', '/auth-admin'],
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

export async function getUserScopes(user: HelixUser): Promise<string[]> {
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

function getAccountTypeForId(id: string) {
	const [accountType] =
		Object.entries(helixUsers).find(([accountType, user]) => user.id === id) ||
		[]
	return accountType as AccountType | undefined
}
