import 'express-async-errors'
import express, {
	Express,
	Request,
	Response,
	NextFunction,
	Application,
} from 'express'
import session from 'express-session'
import { join, dirname } from 'path'
import randomstring from 'randomstring'
import { fileURLToPath } from 'url'
import { getData, modifyData } from './db.js'
import DBSessionStore from './dbSessionStore.js'
import { DEV_MODE } from './util.js'
import { timestampLog } from './logger.js'
import http from 'http'
import { TrainEvents } from './twitch/chat/trains.js'

const SESSION_TTL = 2 * 7 * 24 * 60 * 60 * 1000 // 2 weeks

export let sessionStore: DBSessionStore

export async function initExpressServer() {
	const app = express()
	const server = http.createServer(app)
	if (!DEV_MODE) app.set('trust proxy', 1) // Trust nginx reverse proxy
	let sessionSecret = getData().expressSessionSecret
	if (!sessionSecret) {
		sessionSecret = randomstring.generate()
		modifyData({ expressSessionSecret: sessionSecret })
	}
	sessionStore = new DBSessionStore({ ttl: SESSION_TTL })
	app.use(
		session({
			store: sessionStore,
			secret: sessionSecret,
			resave: false,
			saveUninitialized: false,
			proxy: true,
			cookie: {
				secure: !DEV_MODE,
				httpOnly: true,
				maxAge: 30 * 60 * 1000, // 30 minutes, extends when authed
			},
		})
	)
	app.set(
		'views',
		join(dirname(fileURLToPath(import.meta.url)), '../src/views')
	)
	app.set('view engine', 'ejs')
	app.use(
		express.static(
			join(dirname(fileURLToPath(import.meta.url)), '../src/public')
		)
	)
	app.use(express.json())
	app.post('/depot-user-hide', async (req, res) => {
		const { authorization } = req.headers
		if (authorization !== process.env.DEPOT_SECRET) return res.sendStatus(401)
		const { userId } = req.body
		if (!userId) return res.sendStatus(400)
		TrainEvents.emit('hideUser', { userId })
		res.sendStatus(200)
	})
	return new Promise<{ expressApp: Express; server: http.Server }>(
		(resolve) => {
			server.listen(process.env.EXPRESS_PORT, () => {
				console.log('Express server ready')
				resolve({ expressApp: app, server })
			})
		}
	)
}

export function createExpressErrorHandler(app: Application) {
	app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
		timestampLog('Express caught error:', err)
		res.render('error', { error: err })
	})
}

declare module 'express-session' {
	interface SessionData {
		username?: string
		oauthState?: string
	}
}
