import { getData, modifyData } from '../../db.js'
import { type GraceType, type Grace } from './grace.js'

export type GraceStats = {
	endedCombosScore: number
	runningTotalScore: number
	currentComboBasePoints: number
	currentComboScore: number
	currentComboSize: number
	finalScore: number
	currentComboUsers: Set<string>
	allUsers: Set<string>
	totalCombo: number
	lastGrace: Grace | null
	endUsername: string | null
}

export function createGraceStats(): GraceStats {
	return {
		endedCombosScore: 0,
		runningTotalScore: 0,
		currentComboBasePoints: 0,
		currentComboScore: 0,
		currentComboSize: 0,
		finalScore: 0,
		currentComboUsers: new Set(),
		allUsers: new Set(),
		totalCombo: 0,
		lastGrace: null,
		endUsername: null,
	}
}

const POINTS: Record<GraceType, number> = {
	redeem: 10,
	highlight: 5,
	normal: 1,
}
const NightbotUserID = '19264788'

export function updateGraceScore(stats: GraceStats, grace: Grace) {
	stats.totalCombo++
	stats.allUsers.add(grace.user.id)
	if (stats.lastGrace && stats.lastGrace.type !== grace.type) {
		stats.endedCombosScore += stats.currentComboScore
		stats.currentComboBasePoints = 0
		stats.currentComboScore = 0
		stats.currentComboSize = 0
		stats.currentComboUsers.clear()
	}
	stats.currentComboUsers.add(grace.user.id)
	let points = POINTS[grace.type]
	if (grace.user.id === NightbotUserID) points = 10000 // Nightbot bonus!
	stats.currentComboBasePoints += points
	stats.currentComboSize++
	stats.currentComboScore = getComboScore(stats)
	stats.runningTotalScore = stats.endedCombosScore + stats.currentComboScore
	updateFinalScore(stats)
	stats.lastGrace = grace
}

export function formatPoints(points: number) {
	return points.toLocaleString('en-US')
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

export function saveRecord(stats: GraceStats) {
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

function getComboScore(stats: GraceStats) {
	const userCount = stats.currentComboUsers.size
	return Math.ceil(
		stats.currentComboBasePoints *
			(1 + (stats.currentComboSize - 1) / 2) *
			(1 + (userCount - 1) / 5)
	)
}

function updateFinalScore(stats: GraceStats) {
	const userCountBonus =
		stats.runningTotalScore * ((stats.allUsers.size - 1) / 10)
	stats.finalScore = Math.ceil(stats.runningTotalScore + userCountBonus)
}

export type GraceTrainRecord = {
	length: number
	score: number
	users: number
	date: number
}
