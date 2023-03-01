import { type SessionData, Store } from 'express-session'
import { getData, modifyData } from './db.js'

// Based on https://github.com/tj/connect-redis/blob/master/index.ts

const noop = (_err?: unknown, _data?: SessionData) => {}

export type SessionRecord = {
	sid: string
	session: SessionData
}

export default class DBSessionStore extends Store {
	constructor(options = {}) {
		super()
	}

	private get sessions() {
		return getData().expressSessions
	}

	private getRecord(sid: string) {
		return this.sessions.find((sr) => sr.sid === sid)
	}

	destroy(sid: string, cb = noop) {
		try {
			modifyData({
				expressSessions: this.sessions.filter((sr) => sr.sid !== sid),
			})
			cb()
		} catch (err) {
			cb(err)
		}
	}

	get(sid: string, cb = noop) {
		try {
			const record = this.getRecord(sid)
			if (!record) return cb()
			return cb(null, record.session)
		} catch (err) {
			return cb(err)
		}
	}

	set(sid: string, session: SessionData, cb = noop) {
		try {
			const record = this.getRecord(sid)
			if (record) {
				// Modify existing
				const existingRecordIndex = this.sessions.indexOf(record)
				const updatedRecords = [...this.sessions]
				updatedRecords.splice(existingRecordIndex, 1, { sid, session })
				modifyData({ expressSessions: updatedRecords })
				return cb()
			} else {
				// Add new
				modifyData({ expressSessions: [...this.sessions, { sid, session }] })
				return cb()
			}
		} catch (err) {
			return cb(err)
		}
	}
}
