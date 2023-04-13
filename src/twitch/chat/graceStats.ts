import { getData, modifyData } from '../../db.js'
import { sendTrainEndMessages } from './grace.js'
import {
	sendTrainAddEvent,
	sendTrainEndEvent,
	sendTrainStartEvent,
} from './graceEvents.js'
import { updateGraceScore } from './graceScore.js'

export type Grace = {
	date: Date
	user: { id: string; color: string }
	type: 'redeem' | 'highlight' | 'normal'
}

export type GraceStats = {
	id: number
	endedCombosScore: number
	totalScore: number
	currentComboBasePoints: number
	currentComboScore: number
	currentComboSize: number
	currentComboUsers: Set<string>
	allUsers: Set<string>
	includesNightbot: boolean
	totalCombo: number
	graces: Grace[]
	lastGrace: Grace | null
}

let graceStats: GraceStats | null = null

export function addGrace({ date, user, type }: Grace) {
	graceStats ||= createGraceStats()
	if (graceStats.graces.length > 0) {
		// Don't add repeated user
		if (graceStats.graces.at(-1)?.user.id === user.id) return
	}
	graceStats.graces.push({ date, user, type })
	updateGraceScore(graceStats, { date, user, type })
	if (graceStats.graces.length === MIN_TRAIN_LENGTH) {
		sendTrainStartEvent(graceStats)
	} else if (graceStats.graces.length > MIN_TRAIN_LENGTH) {
		sendTrainAddEvent(graceStats)
	}
}

function createGraceStats(): GraceStats {
	return {
		id: Date.now(),
		endedCombosScore: 0,
		totalScore: 0,
		currentComboBasePoints: 0,
		currentComboScore: 0,
		currentComboSize: 0,
		currentComboUsers: new Set(),
		allUsers: new Set(),
		includesNightbot: false,
		totalCombo: 0,
		graces: [],
		lastGrace: null,
	}
}

const MIN_TRAIN_LENGTH = 5

export function endGraceTrain(endUsername: string) {
	if (!graceStats) return
	if (
		graceStats.graces.length < MIN_TRAIN_LENGTH ||
		graceStats.allUsers.size < 2
	) {
		clearStats()
		return
	}
	sendTrainEndEvent(graceStats, endUsername)
	sendTrainEndMessages({
		...graceStats,
		trainLength: graceStats.graces.length,
		userCount: graceStats.allUsers.size,
		endUsername,
		bestRecord: getBestRecord(),
	})
	saveRecord(graceStats)
	clearStats()
}

const getBestRecord = () =>
	getData().graceTrainRecords[0] || { score: 0, length: 0, users: 0 }

function saveRecord(stats: GraceStats) {
	const thisRecord = {
		score: stats.totalScore,
		length: stats.totalCombo,
		users: stats.allUsers.size,
		date: Date.now(),
	}
	const records = [...getData().graceTrainRecords, thisRecord]
	records.sort((a, b) => (a.score < b.score ? 1 : -1))
	modifyData({ graceTrainRecords: records.slice(0, 5) })
}

export const getCurrentTrain = () => {
	if (graceStats && graceStats.totalCombo >= MIN_TRAIN_LENGTH) return graceStats
}

export function clearStats() {
	graceStats = null
}

export type GraceTrainRecord = {
	length: number
	score: number
	users: number
	date: number
}
