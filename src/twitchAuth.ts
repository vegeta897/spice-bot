import { exchangeCode, RefreshingAuthProvider } from '@twurple/auth'
import { getData, modifyData } from './db.js'

export type TokenData = {
	accessToken: string
	refreshToken: string
	expiresIn: number
	obtainmentTimestamp: number
}

const SCOPES = [
	'chat:read',
	'chat:edit',
	'bits:read',
	'channel:read:hype_train',
	'channel:read:polls',
	'channel:read:predictions',
	'channel:read:redemptions',
	'channel:read:subscriptions',
	'channel:read:vips',
	'moderation:read',
	'moderator:read:chat_settings',
	'moderator:read:chatters',
	'moderator:read:followers',
]

console.log(
	'auth bot URL:',
	`https://id.twitch.tv/oauth2/authorize?client_id=${
		process.env.TWITCH_CLIENT_ID
	}&redirect_uri=${
		process.env.TWITCH_REDIRECT_URI
	}&response_type=code&scope=${SCOPES.join('+')}`
)

// Auth flow:
// Streamer visits auth URL containing Spice Bot client ID and requested scopes
// Twitch redirects to REDIRECT_URI with one-time auth code that expires shortly
// That code is sent to twitch via exchangeCode() to get access and refresh tokens
// Refresh token can always be used to get a new access token (and possibly refresh token)
// Unless streamer changes their password or removes the app connection

// When twitch sends us an auth code and we get the tokens,
// use getTokenInfo() to check that the username matches TWITCH_USERNAME
// Ignore all other users, just in case others somehow authorize to our app

export async function getTokensFromAuthCode() {
	const authCode = ''
	const accessToken = await exchangeCode(
		process.env.TWITCH_CLIENT_ID,
		process.env.TWITCH_CLIENT_SECRET,
		authCode,
		process.env.TWITCH_REDIRECT_URI
	)
	console.log(accessToken)
}

export async function getTwitchUserAuth() {
	const tokenData = getData().twitchBotUserAuth
	if (!tokenData) {
		console.log('No Twitch user auth token data found!')
		return
	}

	const authProvider = new RefreshingAuthProvider(
		{
			clientId: process.env.TWITCH_CLIENT_ID,
			clientSecret: process.env.TWITCH_CLIENT_SECRET,
			onRefresh: async (newTokenData) =>
				await modifyData({ twitchBotUserAuth: newTokenData as TokenData }),
		},
		tokenData
	)
	return authProvider
}
