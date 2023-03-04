import { Express } from 'express'
import { compareArrays, HOST_URL, timestampLog } from '../util.js'
import { getTwitchToken } from '../db.js'
import { exchangeCode, getTokenInfo, revokeToken } from '@twurple/auth'
import {
	type AccountType,
	AuthEvents,
	botIsMod,
	UserAccountTypes,
} from './twitchApi.js'
import { sessionStore } from '../express.js'

const SCOPES: Record<AccountType, string[]> = {
	bot: [
		'channel:moderate',
		'chat:read',
		'chat:edit',
		'whispers:read',
		'whispers:edit',
	],
	streamer: [
		'channel:read:hype_train',
		'channel:read:polls',
		'channel:read:predictions',
		'channel:read:redemptions',
		'channel:read:subscriptions',
		'moderation:read',
		'moderator:read:chat_settings',
		'moderator:read:chatters',
		'moderator:read:followers',
	],
	admin: [],
}

// Auth flow:
// Streamer visits auth URL containing Spice Bot client ID and requested scopes
// Twitch redirects to REDIRECT_URI with one-time auth code that expires shortly
// That code is sent to twitch via exchangeCode() to get access and refresh tokens
// Refresh token can always be used to get a new access token (and possibly refresh token)
// Unless streamer changes their password or removes the app connection

// When twitch sends us an auth code and we get the tokens,
// use getTokenInfo() to check that the username matches TWITCH_STREAMER_USERNAME
// Ignore all other users, just in case others somehow authorize to our app

// The bot user and streamer require their own auth flows
// The streamer authorizing the bot application allows eventsubs, no token required
// The streamer's token is required for api calls like moderation and polls

export function initTwitchOAuthServer(app: Express) {
	app.get('/', async (req, res) => {
		if (req.session.username === process.env.TWITCH_ADMIN_USERNAME) {
			return res.redirect('admin')
		}
		res.render('index', {
			username: req.session.username,
			botIsMod: await botIsMod(),
		})
	})
	app.get('/callback', async (req, res) => {
		timestampLog('incoming oauth callback', req.query)
		const { code, scope } = req.query
		if (!code || typeof code !== 'string' || typeof scope !== 'string')
			throw 'Invalid parameters'
		const { username, scopes, wrongUser } = await doOauthFlow(code)
		if (wrongUser) return res.redirect('wrong-account')
		const accountType = UserAccountTypes[username]
		const requiredScopes = SCOPES[accountType]
		const scopeComparison = compareArrays(scopes || [], requiredScopes)
		if (scopeComparison.onlySecondHas.length > 0) {
			console.log(
				`Request for ${accountType} auth is missing scope(s):`,
				scopeComparison.onlySecondHas.join(' ')
			)
		}
		if (scopeComparison.onlyFirstHas.length > 0) {
			console.log(
				`Request for ${accountType} auth contains extra scope(s):`,
				scopeComparison.onlyFirstHas.join(' ')
			)
		}
		req.session.username = username
		console.log(username, 'successfully authorized')
		if (accountType === 'admin') return res.redirect('admin')
		res.redirect('success')
	})
	app.get('/auth', (req, res) => res.redirect(getOAuthLink('streamer')))
	app.get('/auth-bot', (req, res) => res.redirect(getOAuthLink('bot')))
	app.get('/auth-admin', (req, res) => res.redirect(getOAuthLink('admin')))
	app.get('/success', (req, res) => {
		if (!req.session.username) return res.redirect('/')
		res.render('success', { botUsername: process.env.TWITCH_BOT_USERNAME })
	})
	app.get('/wrong-account', (req, res) => {
		if (!req.session.username) return res.redirect('/')
		res.render('wrong-account', {
			streamerUsername: process.env.TWITCH_STREAMER_USERNAME,
		})
	})
	app.get('/unlink', (req, res) => {
		if (!req.session.username) return res.redirect('/')
		const accountType = UserAccountTypes[req.session.username]
		if (accountType)
			AuthEvents.emit('authRevoke', { accountType, method: 'sign-out' })
		req.session.destroy(() => {})
		res.render('unlinked')
	})
	app.get('/admin', (req, res) => {
		if (req.session.username !== process.env.TWITCH_ADMIN_USERNAME) {
			return res.redirect('/')
		}
		res.render('admin', {
			streamer: {
				username: process.env.TWITCH_STREAMER_USERNAME,
				authed: !!getTwitchToken('streamer'),
			},
			bot: {
				username: process.env.TWITCH_BOT_USERNAME,
				authed: !!getTwitchToken('bot'),
			},
			admin: {
				username: process.env.TWITCH_ADMIN_USERNAME,
				authed: !!getTwitchToken('admin'),
			},
		})
	})
	AuthEvents.on('authRevoke', ({ accountType }) => {
		if (accountType !== 'streamer') return
		// Delete all of the streamer's sessions
		const sessionRecords = sessionStore.getRecords()
		for (const sessionRecord of sessionRecords) {
			if (
				sessionRecord.session.username === process.env.TWITCH_STREAMER_USERNAME
			) {
				sessionStore.destroy(sessionRecord.sid)
			}
		}
	})
}

async function doOauthFlow(code: string): Promise<{
	username: string
	scopes?: string[]
	wrongUser?: boolean
}> {
	const accessToken = await exchangeCode(
		process.env.TWITCH_CLIENT_ID,
		process.env.TWITCH_CLIENT_SECRET,
		code as string,
		`${HOST_URL}/callback`
	)
	const tokenInfo = await getTokenInfo(accessToken.accessToken)
	if (tokenInfo.userName === null) throw 'Invalid token received'
	const accountType = UserAccountTypes[tokenInfo.userName]
	if (accountType) {
		console.log(`Successfully exchanged code for ${accountType} token`)
		AuthEvents.emit('auth', { accountType, token: accessToken })
		return { username: tokenInfo.userName, scopes: tokenInfo.scopes }
	} else {
		console.log(`Unknown user "${tokenInfo.userName}" tried to auth`)
		// Revoke token, and ignore if it fails
		try {
			await revokeToken(process.env.TWITCH_CLIENT_ID, accessToken.accessToken)
		} catch (_) {}
		return {
			username: tokenInfo.userName,
			wrongUser: true,
		}
	}
}

function getOAuthLink(accountType: AccountType) {
	let url = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=${HOST_URL}/callback`
	const scopes = SCOPES[accountType]
	if (scopes) url += `&scope=${scopes.join('+')}`
	return url
}
