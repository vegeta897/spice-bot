import { exchangeCode, RefreshingAuthProvider } from '@twurple/auth'
import { getData, modifyData } from './db.js'

export type TokenData = {
	accessToken: string
	refreshToken: string
	expiresIn: number
	obtainmentTimestamp: number
}

const BOT_SCOPES = [
	'channel:moderate',
	'chat:read',
	'chat:edit',
	'whispers:read',
	'whispers:edit',
]

const STREAMER_SCOPES = [
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
	'chat bot auth URL:',
	`https://id.twitch.tv/oauth2/authorize?client_id=${
		process.env.TWITCH_CLIENT_ID
	}&redirect_uri=${
		process.env.TWITCH_REDIRECT_URI
	}&response_type=code&scope=${BOT_SCOPES.join('+')}`
)

// TODO: Make sure link sent to actual streamer is using Spice Bot 2.0, not Spice Bot Test
console.log(
	'streamer auth URL:',
	`https://id.twitch.tv/oauth2/authorize?client_id=${
		process.env.TWITCH_CLIENT_ID
	}&redirect_uri=${
		process.env.TWITCH_REDIRECT_URI
	}&response_type=code&scope=${STREAMER_SCOPES.join('+')}`
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

// The bot user and streamer require their own auth flows
// The streamer authorizing the bot application allows eventsubs, no token required
// The streamer's token is required for api calls like moderation and polls

// Check for auth tokens in database
export async function checkTwitchAuth() {
	const { twitchBotToken, twitchStreamerToken } = getData()
	if (!twitchBotToken) {
	}
	if (!twitchStreamerToken) {
	}
}

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

// TODO: Update to Twurple 6.0.0
// https://twurple.js.org/docs/migration/

export async function getTwitchBotAuthProvider() {
	const { twitchBotToken } = getData()
	if (!twitchBotToken) throw 'Missing twitch bot token data!'
	return new RefreshingAuthProvider(
		{
			clientId: process.env.TWITCH_CLIENT_ID,
			clientSecret: process.env.TWITCH_CLIENT_SECRET,
			onRefresh: async (newTokenData) =>
				await modifyData({ twitchBotToken: newTokenData as TokenData }),
		},
		twitchBotToken
	)
}

export async function getTwitchStreamerAuthProvider() {
	const { twitchStreamerToken } = getData()
	if (!twitchStreamerToken) throw 'Missing twitch bot token data!'
	return new RefreshingAuthProvider(
		{
			clientId: process.env.TWITCH_CLIENT_ID,
			clientSecret: process.env.TWITCH_CLIENT_SECRET,
			onRefresh: async (newTokenData) =>
				await modifyData({ twitchStreamerToken: newTokenData as TokenData }),
		},
		twitchStreamerToken
	)
}
