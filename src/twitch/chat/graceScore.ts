import { getUserByAccountType } from '../twitchApi.js'
import { type Grace, type GraceStats } from './graceStats.js'

export type GraceCombo = {
	currentComboBasePoints: number
	currentComboScore: number
	currentComboSize: number
	currentComboUsers: Set<string>
	endedCombosScore: number
}

const POINTS: Record<Grace['type'], number> = {
	redeem: 10,
	highlight: 5,
	normal: 1,
}
const NightbotUserID = '19264788'

export function updateGraceScore(stats: GraceStats, grace: Grace) {
	stats.totalCombo++
	if (stats.lastGrace && stats.lastGrace.type !== grace.type) {
		const endedCombosScore = stats.combo.currentComboScore
		stats.combo = initGraceCombo()
		stats.combo.endedCombosScore = endedCombosScore
	}
	stats.combo.currentComboUsers.add(grace.user.id)
	let points = POINTS[grace.type]
	if (grace.user.id === NightbotUserID) {
		points = 1000 // Nightbot bonus!
		stats.specialUsers.add('nightbot')
	} else if (grace.user.id === getUserByAccountType('bot').id) {
		points = 100 // Spice bot bonus!
		stats.specialUsers.add('spicebot')
	}
	stats.combo.currentComboBasePoints += points
	stats.combo.currentComboSize++
	stats.combo.currentComboScore = getComboScore(stats)
	stats.totalScore = getTotalScore(stats)
	stats.lastGrace = grace
}

function getComboScore(stats: GraceStats) {
	const userCount = stats.combo.currentComboUsers.size
	return Math.ceil(
		stats.combo.currentComboBasePoints *
			(1 + (stats.combo.currentComboSize - 1) / 2) *
			(1 + (userCount - 1) / 5)
	)
}

function getTotalScore(stats: GraceStats) {
	const totalComboScore =
		stats.combo.endedCombosScore + stats.combo.currentComboScore
	const userCountBonus = totalComboScore * ((stats.allUsers.size - 1) / 10)
	return Math.ceil(totalComboScore + userCountBonus)
}

export function formatPoints(points: number) {
	return points.toLocaleString('en-US')
}

export function initGraceCombo(): GraceCombo {
	return {
		currentComboBasePoints: 0,
		currentComboScore: 0,
		currentComboSize: 0,
		currentComboUsers: new Set(),
		endedCombosScore: 0,
	}
}
