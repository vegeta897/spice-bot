import { getData, modifyData } from '../../db.js'
import { timestampLog } from '../../util.js'
import { sendTrainEndMessages } from './grace.js'
import { startGraceTrain, addToGraceTrain, endGraceTrain } from './trains.js'
import { updateGraceScore } from './graceScore.js'
import { getCurrentHypeTrain } from './hype.js'
import { sendChatMessage } from './twitchChat.js'

export type Grace = {
	date: Date
	user: { id: string; name: string; color: string }
	type: 'redeem' | 'highlight' | 'normal'
}

export type GraceStats = {
	totalCombo: number
	totalScore: number
	currentComboBasePoints: number
	currentComboScore: number
	currentComboSize: number
	currentComboUsers: Set<string>
	endedCombosScore: number
	allUsers: Map<string, { name: string; count: number }>
	specialUsers: Set<SpecialUser>
	graces: Grace[]
	lastGrace: Grace | null
	hyped: boolean
	frog: boolean
}

export type SpecialUser = 'nightbot' | 'spicebot'

let graceStats: GraceStats | null = null

export function onGrace({ date, user, type }: Grace) {
	graceStats ||= createGraceStats()
	if (getCurrentHypeTrain()) graceStats.hyped = true
	if (graceStats.graces.length > 0) {
		// Don't add repeated user
		if (graceStats.graces.at(-1)?.user.id === user.id) return
	}
	graceStats.graces.push({ date, user, type })
	const allUsersEntry = graceStats.allUsers.get(user.id)
	if (!allUsersEntry) {
		graceStats.allUsers.set(user.id, { name: user.name, count: 1 })
	} else {
		allUsersEntry.count++
		allUsersEntry.name = user.name // They might change their name mid-train!
	}
	updateGraceScore(graceStats, { date, user, type })
	const minTrainLength = graceStats.hyped ? 1 : MIN_TRAIN_LENGTH
	if (graceStats.graces.length === minTrainLength) {
		if (shouldFrogAppear()) {
			graceStats.frog = true
			frogAppearedThisStream = true
		}
		startGraceTrain(getGraceTrainStartData(graceStats))
	} else if (graceStats.graces.length > minTrainLength) {
		addToGraceTrain({
			combo: graceStats.totalCombo,
			score: graceStats.totalScore,
			color: user.color,
		})
		if (graceStats.hyped && graceStats.graces.length === 8) {
			sendChatMessage('Hyped grace trains are unbreakable, so keep gracing!')
		}
	}
}

function createGraceStats(): GraceStats {
	return {
		totalCombo: 0,
		totalScore: 0,
		currentComboBasePoints: 0,
		currentComboScore: 0,
		currentComboSize: 0,
		currentComboUsers: new Set(),
		endedCombosScore: 0,
		allUsers: new Map(),
		specialUsers: new Set(),
		graces: [],
		lastGrace: null,
		hyped: false,
		frog: false,
	}
}

const MIN_TRAIN_LENGTH = 5

export function breakGraceTrain(endUsername: string) {
	if (!graceStats) return
	if (
		!graceStats.hyped &&
		(graceStats.graces.length < MIN_TRAIN_LENGTH ||
			graceStats.allUsers.size < 2)
	) {
		clearGraceStats()
		return
	}
	if (!graceStats.hyped)
		endGraceTrain({
			combo: graceStats.totalCombo,
			score: graceStats.totalScore,
			username: endUsername,
		})
	let topGracer: null | [string, number] = null
	if (graceStats.graces.length >= 20 && graceStats.allUsers.size > 4) {
		const [first, second] = [...graceStats.allUsers.values()].sort(
			(a, b) => b.count - a.count
		)
		if (first.count > second.count) topGracer = [first.name, first.count]
	}
	sendTrainEndMessages({
		...graceStats,
		trainLength: graceStats.graces.length,
		topGracer,
		endUsername,
		bestRecord: getBestRecord(graceStats.hyped),
	})
	saveRecord(graceStats)
	timestampLog(`Ended grace train (${graceStats.graces.length}x)`)
	clearGraceStats()
}

const getBestRecord = (hyped: boolean) =>
	getData()[hyped ? 'hypedGraceTrainRecords' : 'graceTrainRecords'][0] || {
		score: 0,
		length: 0,
		users: 0,
	}

function saveRecord(stats: GraceStats) {
	const thisRecord = {
		score: stats.totalScore,
		length: stats.totalCombo,
		users: stats.allUsers.size,
		date: Date.now(),
	}
	const dataProp = stats.hyped ? 'hypedGraceTrainRecords' : 'graceTrainRecords'
	const records = [...getData()[dataProp], thisRecord]
	records.sort((a, b) => (a.score < b.score ? 1 : -1))
	modifyData({ [dataProp]: records.slice(0, 5) })
}

const getGraceTrainStartData = (stats: GraceStats) => ({
	combo: stats.totalCombo,
	score: stats.totalScore,
	colors: stats.graces.map((g) => g.user.color),
	frog: stats.frog,
})

export const getCurrentGraceTrain = () => {
	if (graceStats && graceStats.totalCombo >= MIN_TRAIN_LENGTH)
		return getGraceTrainStartData(graceStats)
}

export function clearGraceStats() {
	graceStats = null
}

export type GraceTrainRecord = {
	length: number
	score: number
	users: number
	date: number
}

let frogAppearedThisStream = false
let frogDetectiveMessages: number[] = []

function shouldFrogAppear() {
	if (frogAppearedThisStream || graceStats?.hyped) return false
	const now = Date.now()
	frogDetectiveMessages = frogDetectiveMessages.filter(
		(t) => now - t < 10 * 60 * 1000
	)
	const frogFactor = frogDetectiveMessages.length
	return Math.random() < 0.05 + frogFactor / 10
}

export function checkForFrogDetective(text: string) {
	if (text.toLowerCase().includes('frog detective')) {
		frogDetectiveMessages.push(Date.now())
	}
}

export function resetFrogAppearance() {
	frogAppearedThisStream = false
	frogDetectiveMessages.length = 0
}
