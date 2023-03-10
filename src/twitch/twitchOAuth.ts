import { Express } from 'express'
import {
	CHAT_TEST_MODE,
	compareArrays,
	DEV_MODE,
	HOST_URL,
	timestampLog,
} from '../util.js'
import { exchangeCode, getTokenInfo, revokeToken } from '@twurple/auth'
import {
	type AccountType,
	AuthEvents,
	botIsMod,
	UserAccountTypes,
} from './twitchApi.js'
import { createExpressErrorHandler, sessionStore } from '../express.js'
import randomstring from 'randomstring'
import { ChatEvents } from './chat/twitchChat.js'
import { getEventSubs } from './eventSub.js'
import { getTwitchToken } from './streamRecord.js'
import { getCensoredJSON } from '../db.js'
import 'highlight.js'
import hljs from 'highlight.js/lib/core'
import { type PrivateMessage } from '@twurple/chat'

const SCOPES: Record<AccountType, string[]> = {
	bot: [
		'user:read:follows',
		'user:read:subscriptions',
		'channel:moderate',
		'chat:read',
		'chat:edit',
		'whispers:read',
		'user:manage:whispers',
		'moderator:read:chat_settings',
		'moderator:read:chatters',
		'moderator:read:followers',
	],
	streamer: [
		'channel:read:hype_train',
		'channel:read:polls',
		'channel:read:predictions',
		'channel:read:redemptions',
		'channel:read:subscriptions',
		'moderation:read',
	],
	admin: [],
}

export function initTwitchOAuthServer(app: Express) {
	app.get('/', async (req, res) => {
		if (req.session.username === process.env.TWITCH_ADMIN_USERNAME) {
			return res.redirect('admin')
		}
		res.render('index', {
			username: req.session.username,
			botIsMod: req.session.username && (await botIsMod()),
		})
	})
	app.get('/callback', async (req, res) => {
		timestampLog('incoming oauth callback', req.query)
		const { code, scope, state } = req.query
		if (
			typeof code !== 'string' ||
			typeof scope !== 'string' ||
			typeof state !== 'string'
		) {
			throw 'Authorization callback is missing one or more parameters'
		}
		if (state !== req.session.oauthState) {
			throw 'Authoriation callback failed; mismatched state parameter'
		}
		delete req.session.oauthState // Clean up state once validated
		const { username, scopes, wrongUser } = await doOauthFlow(code)
		if (wrongUser) return res.redirect('wrong-account')
		const accountType = UserAccountTypes[username]
		const requiredScopes = SCOPES[accountType]
		const { missing, extra } = compareArrays(scopes || [], requiredScopes)
		if (missing.length > 0) {
			console.log(
				`Request for ${accountType} auth is missing scope(s): ${missing.join(
					' '
				)}`
			)
			throw `${accountType} auth callback is missing scope(s): ${missing.join(
				' '
			)}`
		}
		if (extra.length > 0) {
			console.log(
				`Request for ${accountType} auth contains extra scope(s): ${extra.join(
					' '
				)}`
			)
		}
		req.session.username = username
		console.log(username, 'successfully authorized')
		if (accountType === 'admin') return res.redirect('admin')
		res.redirect('success')
	})
	app.get('/auth', (req, res) => {
		const { bot, admin } = req.query
		const accountType: AccountType =
			bot !== undefined ? 'bot' : admin !== undefined ? 'admin' : 'streamer'
		const oauthState = randomstring.generate()
		req.session.oauthState = oauthState
		return res.redirect(getOAuthLink(accountType, oauthState))
	})
	app.get('/success', (req, res) => {
		if (!req.session.username) return res.redirect('/')
		res.render('success', {
			botUsername: process.env.TWITCH_BOT_USERNAME,
			asBot: req.session.username === process.env.TWITCH_BOT_USERNAME,
		})
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
		timestampLog(`${req.session.username} visited /unlink`)
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
			chatTestMode: DEV_MODE || CHAT_TEST_MODE,
			testCommands: ['recap', 'tally'],
			testEvents: ['grace'],
			testLogs: ['event-subs'],
			db: hljs.highlight(getCensoredJSON(), { language: 'json' }).value,
		})
	})
	app.get('/preview', (req, res) => {
		if (
			!DEV_MODE &&
			req.session.username !== process.env.TWITCH_ADMIN_USERNAME
		) {
			return res.redirect('/')
		}
		const page = Object.keys(req.query)[0]
		if (!page) return res.send('Missing page name in query (e.g. ?success)')
		return res.render(page, req.query, (err, html) => {
			if (!err) return res.send(html)
			console.log(err)
			res.send('Missing page param(s), check console for details')
		})
	})
	let testUserID = 1000
	app.post('/test', async (req, res) => {
		if (req.session.username !== process.env.TWITCH_ADMIN_USERNAME) {
			return res.sendStatus(401)
		}
		const { command, event, log } = req.query
		if (log === 'event-subs') console.log(await getEventSubs())
		if ((command || event) && !DEV_MODE && !CHAT_TEST_MODE)
			return res.sendStatus(400)
		if (command) {
			timestampLog(`Testing !${command} command`)
			ChatEvents.emit('message', {
				username: process.env.TWITCH_ADMIN_USERNAME,
				userID: `${testUserID++}`,
				text: `!${command}`,
				date: new Date(),
				msg: {} as PrivateMessage,
				mod: true,
			})
		}
		if (event) {
			timestampLog(`Testing ${event} event`)
			if (event === 'grace')
				ChatEvents.emit('redemption', {
					username: process.env.TWITCH_ADMIN_USERNAME,
					userID: `${testUserID++}`,
					title: 'GRACE',
					date: new Date(),
					status: '',
					rewardText: '',
				})
			// TODO: Add stream online/offline, tweets, etc
		}
		res.sendStatus(200)
	})
	console.log(
		`Admin panel: ${DEV_MODE ? 'http://' : 'https://'}${
			process.env.EXPRESS_HOSTNAME
		}/admin`
	)
	createExpressErrorHandler(app)
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

function getOAuthLink(accountType: AccountType, state: string) {
	let url = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${process.env.TWITCH_CLIENT_ID}&redirect_uri=${HOST_URL}/callback&state=${state}`
	const scopes = SCOPES[accountType]
	if (scopes) url += `&scope=${scopes.join('+')}`
	return url
}
