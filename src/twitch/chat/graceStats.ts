import { getData, modifyData } from '../../db.js'
import { timestampLog } from '../../logger.js'
import { sendTrainEndMessages } from './grace.js'
import { startGraceTrain, addToGraceTrain, endGraceTrain } from './trains.js'
import { updateGraceScore } from './graceScore.js'
import { addGraceToHypeTrain, getCurrentHypeTrain } from './hype.js'
import { sendChatMessage } from './twitchChat.js'
import { getCarFromGraceUser } from './graceDepot.js'

export type GraceUser = { id: string; name: string; color: string }

export type Grace = {
	date: Date
	user: GraceUser
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

export async function onGrace({ date, user, type }: Grace) {
	graceStats ||= createGraceStats()
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
	if (getCurrentHypeTrain()) {
		graceStats.hyped = true
		addGraceToHypeTrain(graceStats.graces.length)
		if (graceStats.graces.length === 8) {
			sendChatMessage('Hyped grace trains are unbreakable, so keep gracing!')
		}
		return
	}
	if (graceStats.graces.length === MIN_TRAIN_LENGTH) {
		if (shouldFrogAppear()) {
			graceStats.frog = true
			frogAppearancesThisStream++
			frogDetectiveMessages.length = 0
		}
		startGraceTrain(await getGraceTrainStartData(graceStats))
	} else if (graceStats.graces.length > MIN_TRAIN_LENGTH) {
		addToGraceTrain({
			combo: graceStats.totalCombo,
			score: graceStats.totalScore,
			car: await getCarFromGraceUser(user),
		})
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
	timestampLog(
		`Ended ${graceStats.hyped ? 'HYPED ' : ''}grace train (${
			graceStats.graces.length
		}x)${graceStats.frog ? ' 🐸' : ''}`
	)
	clearGraceStats()
}

export function hypeGraceTrain() {
	if (!graceStats) return
	graceStats.hyped = true
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

const getGraceTrainStartData = async (stats: GraceStats) => ({
	combo: stats.totalCombo,
	score: stats.totalScore,
	cars: await Promise.all(stats.graces.map((g) => getCarFromGraceUser(g.user))),
	frog: stats.frog,
})

export const getCurrentGraceTrain = async () => {
	if (
		graceStats &&
		(graceStats.hyped || graceStats.totalCombo >= MIN_TRAIN_LENGTH)
	)
		return await getGraceTrainStartData(graceStats)
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

let frogAppearancesThisStream = 0
let frogDetectiveMessages: number[] = []

function shouldFrogAppear() {
	if (graceStats?.hyped) return false
	const now = Date.now()
	frogDetectiveMessages = frogDetectiveMessages.filter(
		(t) => now - t < 10 * 60 * 1000
	)
	const baseChance = frogAppearancesThisStream === 0 ? 0.05 : 0
	const frogFactor =
		frogDetectiveMessages.length / (10 * (frogAppearancesThisStream + 1))
	const graceFactor = graceInChat && frogAppearancesThisStream === 0 ? 1 : 0
	return Math.random() < baseChance + frogFactor + graceFactor
}

export function checkForFrogDetective(text: string) {
	if (text.toLowerCase().includes('frog detective')) {
		frogDetectiveMessages.push(Date.now())
	}
}

export function resetFrogAppearance() {
	frogAppearancesThisStream = 0
	frogDetectiveMessages.length = 0
}

let graceInChat = false
export const setGraceInChat = () => (graceInChat = true)
export const resetGraceInChat = () => (graceInChat = false)
