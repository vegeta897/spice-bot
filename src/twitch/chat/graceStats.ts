import { getData, modifyData } from '../../db.js'
import { timestampLog } from '../../logger.js'
import { sendTrainEndMessages } from './grace.js'
import { startGraceTrain, addToGraceTrain, endGraceTrain } from './trains.js'
import { GraceCombo, initGraceCombo, updateGraceScore } from './graceScore.js'
import { addGraceToHypeTrain, getCurrentHypeTrain } from './hype.js'
import { sendChatMessage } from './twitchChat.js'
import { getCarFromGraceUser, pingDepot } from './graceDepot.js'
import type { GraceTrainCar } from 'grace-train-lib/trains'
import { AsyncQueue, DEV_MODE } from '../../util.js'

export type GraceUser = { id: string; name: string; color: string }
export type Grace = {
	date: Date
	user: GraceUser
	type: 'redeem' | 'highlight' | 'normal'
}
export type GraceWithCar = Grace & { car: GraceTrainCar }
export type SpecialUser = 'nightbot' | 'spicebot'

export type GraceStats = {
	started: boolean
	totalCombo: number
	totalScore: number
	combo: GraceCombo
	allUsers: Map<string, { name: string; count: number }>
	specialUsers: Set<SpecialUser>
	preGraces: Grace[]
	graces: GraceWithCar[]
	lastGrace: Grace | null
	hyped: boolean
	frog: boolean
	depotOnline: boolean
}

// Store in db? Just need to handle storing the maps and sets
let graceStats: GraceStats | null = null

const graceQueue = new AsyncQueue()

export async function onGrace({ date, user, type }: Grace) {
	graceQueue.enqueue(async () => {
		if (!graceStats) {
			// Before a train begins, see if the depot is available for use
			const pingResult = await pingDepot()
			graceStats = createGraceStats(pingResult === 'pong')
		}
		const hyped = getCurrentHypeTrain()
		// Don't add repeated user unless hyped or in dev mode
		if (!hyped && graceStats.lastGrace?.user.id === user.id && !DEV_MODE) return
		const grace = { date, user, type }
		// else graceStats.graces.push({ date, user, type })
		const allUsersEntry = graceStats.allUsers.get(user.id)
		if (!allUsersEntry) {
			graceStats.allUsers.set(user.id, { name: user.name, count: 1 })
		} else {
			allUsersEntry.count++
			allUsersEntry.name = user.name // They might change their name mid-train!
		}
		updateGraceScore(graceStats, grace)
		if (hyped) {
			graceStats.hyped = true
			graceStats.started = true
			addGraceToHypeTrain(graceStats.graces.length)
			if (graceStats.graces.length === 8) {
				sendChatMessage('Hyped grace trains are unbreakable, so keep gracing!')
			}
			return
		}
		if (!graceStats.started) {
			graceStats.preGraces.push(grace)
			if (graceStats.preGraces.length === MIN_TRAIN_LENGTH) {
				graceStats.started = true
				// TODO: Replace with batch method
				const graces = await Promise.all(
					graceStats.preGraces.map(async (pg) => ({
						...pg,
						car: await getCarFromGraceUser(pg.user),
					}))
				)
				graceStats.graces.push(...graces)
				if (shouldFrogAppear()) {
					graceStats.frog = true
					frogAppearancesThisStream++
					frogDetectiveMessages.length = 0
				}
				startGraceTrain(getGraceTrainStartData(graceStats))
			}
		} else {
			graceStats.graces.push({
				...grace,
				car: await getCarFromGraceUser(grace.user),
			})
			addToGraceTrain({
				combo: graceStats.totalCombo,
				score: graceStats.totalScore,
				car: await getCarFromGraceUser(user),
			})
		}
	})
}

function createGraceStats(depotOnline: boolean): GraceStats {
	return {
		started: false,
		totalCombo: 0,
		totalScore: 0,
		combo: initGraceCombo(),
		allUsers: new Map(),
		specialUsers: new Set(),
		preGraces: [],
		graces: [],
		lastGrace: null,
		hyped: false,
		frog: false,
		depotOnline,
	}
}

const MIN_TRAIN_LENGTH = 5

export function breakGraceTrain(endUsername: string) {
	graceQueue.enqueue(() => {
		if (!graceStats) return
		if (
			!graceStats.hyped &&
			(graceStats.graces.length < MIN_TRAIN_LENGTH ||
				graceStats.allUsers.size <= 1)
		) {
			clearGraceStats()
			return
		}
		if (!graceStats.hyped) {
			endGraceTrain({
				combo: graceStats.totalCombo,
				score: graceStats.totalScore,
				username: endUsername,
			})
		}
		let topGracer: null | [string, number] = null
		if (graceStats.graces.length >= 15 && graceStats.allUsers.size > 3) {
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
	})
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

const getGraceTrainStartData = (stats: GraceStats) => ({
	combo: stats.totalCombo,
	score: stats.totalScore,
	cars: stats.graces.map((g) => g.car),
	frog: stats.frog,
})

export const getCurrentGraceTrain = async () => {
	return await graceQueue.enqueue(() => {
		if (
			graceStats &&
			(graceStats.hyped || graceStats.totalCombo >= MIN_TRAIN_LENGTH)
		)
			return getGraceTrainStartData(graceStats)
	})
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
