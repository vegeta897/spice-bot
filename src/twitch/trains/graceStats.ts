import { getData, modifyData } from '../../db.js'
import { timestampLog } from '../../logger.js'
import { sendTrainEndMessages } from './grace.js'
import { TrainEvents } from './trains.js'
import { GraceCombo, initGraceCombo, updateGraceScore } from './graceScore.js'
import { addGraceToHypeTrain, getCurrentHypeTrain } from './hype.js'
import { sendChatMessage } from '../chat/twitchChat.js'
import { depotTrainStart, depotTrainAdd, depotTrainEnd } from './graceDepot.js'
import type { GraceTrainCar, GraceTrainData } from 'grace-train-lib/data'
import { AsyncQueue } from '../../util.js'

export type GraceUser = { id: string; name: string; color: string }
export type GraceRedeem = {
	date: Date
	user: GraceUser
	type: 'redeem' | 'highlight' | 'normal'
}
export type SpecialUser = 'nightbot' | 'spicebot'

export type GraceStats = {
	trainId: number
	started: boolean
	totalCombo: number
	totalScore: number
	combo: GraceCombo
	allUsers: Map<string, { name: string; count: number }>
	specialUsers: Set<SpecialUser>
	initialGraces: GraceRedeem[]
	graces: (GraceRedeem & { car: GraceTrainCar })[]
	lastGrace: GraceRedeem | null
	hyped: boolean
	frog: boolean
}

// Store in db? Just need to handle storing the maps and sets
let graceStats: GraceStats | null = null

const graceQueue = new AsyncQueue()

export async function onGrace({ date, user, type }: GraceRedeem) {
	graceQueue.enqueue(async () => {
		if (!graceStats) graceStats = createGraceStats()
		const hyped = getCurrentHypeTrain()
		// Allowing repeat users for now, as a trial
		// if (!hyped && graceStats.lastGrace?.user.id === user.id && !DEV_MODE) return
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
			graceStats.initialGraces.push(grace)
			if (graceStats.initialGraces.length === MIN_TRAIN_LENGTH) {
				graceStats.started = true
				let graces: GraceStats['graces']
				try {
					const depotCars = await depotTrainStart({
						trainId: graceStats.trainId,
						score: graceStats.totalScore,
						graces: graceStats.initialGraces.map((grace) => ({
							userId: grace.user.id,
							color: grace.user.color,
						})),
					})
					graces = graceStats.initialGraces.map((pg, i) => ({
						...pg,
						car: depotCars[i],
					}))
				} catch (e) {
					console.log('Error calling depotTrainStart', e)
					graces = graceStats.initialGraces.map((pg) => ({
						...pg,
						car: { color: pg.user.color },
					}))
				}
				graceStats.graces.push(...graces)
				if (shouldFrogAppear()) {
					graceStats.frog = true
					frogAppearancesThisStream++
					frogDetectiveMessages.length = 0
				}
				TrainEvents.emit('start', getGraceTrainStartData(graceStats))
			}
		} else {
			let car: GraceTrainCar
			try {
				car = await depotTrainAdd({
					trainId: graceStats.trainId,
					score: graceStats.totalScore,
					grace: { userId: grace.user.id, color: grace.user.color },
					index: graceStats.graces.length,
				})
			} catch (e) {
				console.log('Error calling depotTrainAdd', e)
				car = { color: grace.user.color }
			}
			graceStats.graces.push({ ...grace, car })
			TrainEvents.emit('add', {
				id: graceStats.trainId,
				grace: {
					combo: graceStats.totalCombo,
					score: graceStats.totalScore,
					grace: { userId: grace.user.id, ...car },
				},
			})
		}
	})
}

function createGraceStats(init: Partial<GraceStats> = {}): GraceStats {
	return {
		trainId: init.trainId ?? Date.now(),
		started: init.started ?? false,
		totalCombo: init.totalCombo ?? 0,
		totalScore: init.totalScore ?? 0,
		combo: init.combo ?? initGraceCombo(),
		allUsers: init.allUsers ?? new Map(),
		specialUsers: init.specialUsers ?? new Set(),
		initialGraces: init.initialGraces ?? [],
		graces: init.graces ?? [],
		lastGrace: init.lastGrace ?? null,
		hyped: init.hyped ?? false,
		frog: init.frog ?? false,
	}
}

const MIN_TRAIN_LENGTH = 5

export function breakGraceTrain(endUsername: string) {
	graceQueue.enqueue(async () => {
		if (!graceStats) return
		if (!graceStats.hyped && graceStats.graces.length < MIN_TRAIN_LENGTH) {
			clearGraceStats()
			return
		}
		let carDebutCount = 0
		if (!graceStats.hyped) {
			TrainEvents.emit('end', {
				id: graceStats.trainId,
				grace: {
					combo: graceStats.totalCombo,
					score: graceStats.totalScore,
					username: endUsername,
				},
			})
			try {
				const endedDepotTrain = await depotTrainEnd({
					trainId: graceStats.trainId,
					score: graceStats.totalScore,
				})
				carDebutCount = endedDepotTrain.carDebutCount
			} catch (e) {
				console.log('Error calling depotTrainEnd', e)
			}
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
			carDebutCount,
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

const getGraceTrainStartData = (
	stats: GraceStats
): { id: number } & GraceTrainData => ({
	id: stats.trainId,
	grace: {
		combo: stats.totalCombo,
		score: stats.totalScore,
		graces: stats.graces.map((grace) => ({
			...grace.car,
			userId: grace.user.id,
		})),
		frog: stats.frog,
	},
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

export function listenToGraceHideUser() {
	TrainEvents.on('hideUser', ({ userId }) => {
		if (!graceStats) return
		graceStats.graces.forEach((grace) => {
			if (grace.user.id === userId) grace.car = { color: grace.user.color }
		})
	})
}
