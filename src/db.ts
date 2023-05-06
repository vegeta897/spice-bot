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
import { type GraceTrainRecord } from './twitch/chat/graceStats.js'

type DBData = {
	tweets: TweetRecord[]
	streams: StreamRecord[]
	expressSessions: SessionRecord[]
	expressSessionSecret: string | null
	twitchEventSubSecret: string | null
	twitchTokens: Record<AccountType, AccessToken | null>
	streamOverlayAuthKeys: string[]
	graceTrainRecords: GraceTrainRecord[]
	hypedGraceTrainRecords: GraceTrainRecord[]
	streamRecap: {
		emoteCounts: [string, number][]
		redeemCounts: [string, number][]
		graceTrainCount: number
	}
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
		streamOverlayAuthKeys: [],
		graceTrainRecords: [],
		hypedGraceTrainRecords: [],
		streamRecap: { emoteCounts: [], redeemCounts: [], graceTrainCount: 0 },
	}
	await writeData() // Creates the initial db file if it doesn't exist
	console.log('Database connected')
}

async function writeData() {
	let fileLocked = true
	let attempts = 0
	do {
		try {
			attempts++
			await db.write()
			fileLocked = false
		} catch (_) {}
	} while (fileLocked) // Retry if write fails (can happen on dev-mode restarts)
	if (DEV_MODE && attempts > 1)
		console.log('db write took', attempts, 'attempts')
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
