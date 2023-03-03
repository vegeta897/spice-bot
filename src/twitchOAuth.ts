import 'express-async-errors'
import express, { NextFunction, Request, Response } from 'express'
import session from 'express-session'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import randomstring from 'randomstring'
import { compareArrays, DEV_MODE, timestampLog } from './util.js'
import { getData, modifyData } from './db.js'
import { exchangeCode, getTokenInfo, revokeToken } from '@twurple/auth'
import DBSessionStore from './dbSessionStore.js'
import { AuthEvents, botIsMod } from './twitchApi.js'

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
	'moderation:read',
	'moderator:read:chat_settings',
	'moderator:read:chatters',
	'moderator:read:followers',
]

const SESSION_TTL = 2 * 7 * 24 * 60 * 60 * 1000 // 2 weeks

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

// TODO: Allow authing as admin, to view a bot status page

export async function initTwitchOAuthServer() {
	const app = express()
	if (!DEV_MODE) app.set('trust proxy', 1) // Trust nginx reverse proxy
	let sessionSecret = getData().expressSessionSecret
	if (!sessionSecret) {
		sessionSecret = randomstring.generate()
		modifyData({ expressSessionSecret: sessionSecret })
	}
	const sessionStore = new DBSessionStore({ ttl: SESSION_TTL })
	app.use(
		session({
			store: sessionStore,
			secret: sessionSecret,
			resave: false,
			saveUninitialized: false,
			cookie: { secure: !DEV_MODE, maxAge: SESSION_TTL },
		})
	)
	app.set('views', join(dirname(fileURLToPath(import.meta.url)), 'views'))
	app.set('view engine', 'ejs')
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
		const requestScopes = (scope && scope.split(' ')) || []
		// Guess intended account type based on scope
		// TODO: Make separate bot and streamer auth routes! (add both as redirect URIs)
		const intendedAccountType =
			requestScopes.length === 0
				? 'admin'
				: requestScopes.includes('chat:read')
				? 'bot'
				: 'streamer'
		const requiredScopes =
			intendedAccountType === 'admin'
				? []
				: intendedAccountType === 'bot'
				? BOT_SCOPES
				: STREAMER_SCOPES
		const scopeComparison = compareArrays(requestScopes, requiredScopes)
		if (scopeComparison.onlySecondHas.length > 0) {
			console.log(
				`Request for ${intendedAccountType} auth is missing scope(s):`,
				scopeComparison.onlySecondHas.join(' ')
			)
		}
		if (scopeComparison.onlyFirstHas.length > 0) {
			console.log(
				`Request for ${intendedAccountType} auth contains extra scope(s):`,
				scopeComparison.onlyFirstHas.join(' ')
			)
		}
		const { username, wrongUser } = await doOauthFlow(code)
		req.session.username = username
		if (wrongUser) {
			req.session.accountType = intendedAccountType
			res.redirect('wrong-account')
		} else {
			console.log(username, 'successfully authorized')
			res.redirect('success')
		}
	})
	app.get('/auth', (req, res) => res.redirect(oauthLink(STREAMER_SCOPES)))
	app.get('/auth-bot', (req, res) => res.redirect(oauthLink(BOT_SCOPES)))
	app.get('/auth-admin', (req, res) => res.redirect(oauthLink([])))
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
		if (req.session.username === process.env.TWITCH_STREAMER_USERNAME) {
			AuthEvents.emit('streamerAuthRevoked', { method: 'sign-out' })
		}
		if (req.session.username === process.env.TWITCH_BOT_USERNAME) {
			AuthEvents.emit('botAuthRevoked', { method: 'sign-out' })
		}
		if (req.session.username === process.env.TWITCH_ADMIN_USERNAME) {
			AuthEvents.emit('adminAuthRevoked', { method: 'sign-out' })
		}
		req.session.destroy(() => {})
		res.render('unlinked')
	})
	app.get('/admin', (req, res) => {
		if (req.session.username !== process.env.TWITCH_ADMIN_USERNAME) {
			return res.redirect('/')
		}
		res.render('admin')
	})
	app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
		timestampLog('Express caught error:', err)
		res.render('error', { error: err })
	})
	app.listen(process.env.TWITCH_OAUTH_PORT, () => {
		console.log('Express server ready')
	})
	AuthEvents.on('streamerAuthRevoked', () => {
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
	wrongUser?: boolean
}> {
	const accessToken = await exchangeCode(
		process.env.TWITCH_CLIENT_ID,
		process.env.TWITCH_CLIENT_SECRET,
		code as string,
		process.env.TWITCH_REDIRECT_URI
	)
	const tokenInfo = await getTokenInfo(accessToken.accessToken)
	if (tokenInfo.userName === process.env.TWITCH_STREAMER_USERNAME) {
		console.log('Successfully exchanged code for streamer token')
		AuthEvents.emit('streamerAuthed', {
			token: accessToken,
		})
		return { username: tokenInfo.userName }
	} else if (tokenInfo.userName === process.env.TWITCH_BOT_USERNAME) {
		console.log('Successfully exchanged code for bot token')
		AuthEvents.emit('botAuthed', {
			token: accessToken,
		})
		return { username: tokenInfo.userName }
	} else if (tokenInfo.userName === process.env.TWITCH_ADMIN_USERNAME) {
		console.log('Successfully exchanged code for admin token')
		AuthEvents.emit('adminAuthed', { token: accessToken })
		return { username: tokenInfo.userName }
	} else if (tokenInfo.userName === null) {
		throw 'Invalid token received'
	} else {
		console.log(`Unknown user "${tokenInfo.userName}" tried to auth`)
		// Revoke token, and ignore if it fails
		try {
			revokeToken(process.env.TWITCH_CLIENT_ID, accessToken.accessToken)
		} catch (_) {}
		return { username: tokenInfo.userName, wrongUser: true }
	}
}

const oauthLink = (scopes: string[]) =>
	`https://id.twitch.tv/oauth2/authorize?client_id=${
		process.env.TWITCH_CLIENT_ID
	}&redirect_uri=${
		process.env.TWITCH_REDIRECT_URI
	}&response_type=code&scope=${scopes.join('+')}`

declare module 'express-session' {
	interface SessionData {
		username?: string
		accountType?: 'streamer' | 'bot' | 'admin'
	}
}
