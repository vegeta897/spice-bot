import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { type DeepReadonly, DEV_MODE, type MaybeReadonly } from './util.js'
import { type AccessToken } from '@twurple/auth'
import { type SessionRecord } from './dbSessionStore.js'
import { type AccountType } from './twitch/twitchApi.js'
import { type TweetRecord } from './twitter/tweetRecord.js'
import { type StreamRecord } from './twitch/streamRecord.js'

type DBData = {
	tweets: TweetRecord[]
	streams: StreamRecord[]
	expressSessions: SessionRecord[]
	expressSessionSecret: string | null
	twitchEventSubSecret: string | null
	twitchTokens: Record<AccountType, AccessToken | null>
	twichGraceTrainRecord: number
	emoteCounts: [string, number][]
	redeemCounts: [string, number][]
}

const filename = DEV_MODE ? 'db-dev.json' : 'db.json'
const file = join(dirname(fileURLToPath(import.meta.url)), '..', filename)
const adapter = new JSONFile<DBData>(file)
const db = new Low<DBData>(adapter)

export async function initDB() {
	await db.read()
	db.data ||= {
		tweets: [],
		streams: [],
		expressSessions: [],
		expressSessionSecret: null,
		twitchEventSubSecret: null,
		twitchTokens: { bot: null, streamer: null, admin: null },
		twichGraceTrainRecord: 0,
		emoteCounts: [],
		redeemCounts: [],
	}
	await writeData()
	console.log('Database connected')
}

async function writeData() {
	let fileLocked = true
	do {
		try {
			await db.write() // Creates the initial db file if it doesn't exist
			fileLocked = false
		} catch (_) {}
	} while (fileLocked) // Retry if write fails (can happen on dev-mode restarts)
}

export const getData = (): DeepReadonly<DBData> => db.data!

export async function modifyData(data: MaybeReadonly<Partial<DBData>>) {
	db.data = <DBData>{ ...db.data, ...data }
	await writeData()
}

const REDACTED = '<REDACTED>'

function censorToken(token: AccessToken | null) {
	if (!token) return
	token.accessToken = REDACTED
	token.refreshToken = REDACTED
}

export function getCensoredJSON() {
	const cloned = JSON.parse(JSON.stringify(getData())) as DBData
	cloned.expressSessionSecret &&= REDACTED // Leave nulls intact
	cloned.twitchEventSubSecret &&= REDACTED
	censorToken(cloned.twitchTokens.bot)
	censorToken(cloned.twitchTokens.streamer)
	censorToken(cloned.twitchTokens.admin)
	cloned.expressSessions.forEach((s) => (s.sid = REDACTED))
	return JSON.stringify(cloned, null, 2)
}
