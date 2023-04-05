import { getData, modifyData } from '../../db.js'
import { sendTrainEndMessages } from './grace.js'
import {
	sendTrainAddEvent,
	sendTrainEndEvent,
	sendTrainStartEvent,
} from './graceEvents.js'
import { setFinalScore, updateGraceScore } from './graceScore.js'

export type Grace = {
	date: Date
	user: { id: string; color: string }
	type: 'redeem' | 'highlight' | 'normal'
}

export type GraceStats = {
	id: number
	endedCombosScore: number
	runningTotalScore: number
	currentComboBasePoints: number
	currentComboScore: number
	currentComboSize: number
	finalScore: number
	currentComboUsers: Set<string>
	allUsers: Set<string>
	includesNightbot: boolean
	totalCombo: number
	graces: Grace[]
	lastGrace: Grace | null
	endUsername: string | null
}

let graceStats: GraceStats | null = null

export function addGrace({ date, user, type }: Grace) {
	graceStats ||= createGraceStats()
	if (graceStats.graces.length > 0) {
		const lastGraceDate = graceStats.graces.at(-1)!.date
		if (date.getTime() - lastGraceDate.getTime() > TRAIN_TIMEOUT) clearStats()
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
		runningTotalScore: 0,
		currentComboBasePoints: 0,
		currentComboScore: 0,
		currentComboSize: 0,
		finalScore: 0,
		currentComboUsers: new Set(),
		allUsers: new Set(),
		includesNightbot: false,
		totalCombo: 0,
		graces: [],
		lastGrace: null,
		endUsername: null,
	}
}

const MIN_TRAIN_LENGTH = 5
const TRAIN_TIMEOUT = 10 * 60 * 1000 // 10 minutes

let endingTrain = false

export async function endGraceTrain(endUsername: string) {
	if (!graceStats || endingTrain) return
	if (
		graceStats.graces.length < MIN_TRAIN_LENGTH ||
		graceStats.allUsers.size < 2
	) {
		clearStats()
		return
	}
	endingTrain = true
	setFinalScore(graceStats)
	graceStats.endUsername = endUsername
	sendTrainEndEvent(graceStats)
	await sendTrainEndMessages(graceStats)
	saveRecord(graceStats)
	clearStats()
	endingTrain = false
}

export function getBestRecord() {
	return (
		getData().graceTrainRecords[0] || {
			score: 0,
			length: 0,
			users: 0,
		}
	)
}

function saveRecord(stats: GraceStats) {
	const thisRecord = {
		score: stats.finalScore,
		length: stats.totalCombo,
		users: stats.allUsers.size,
		date: Date.now(),
	}
	const records = [...getData().graceTrainRecords, thisRecord]
	records.sort((a, b) => (a.score < b.score ? 1 : -1))
	modifyData({ graceTrainRecords: records.slice(0, 5) })
}

export const getCurrentTrain = () => graceStats

export function clearStats() {
	graceStats = null
}

export type GraceTrainRecord = {
	length: number
	score: number
	users: number
	date: number
}
