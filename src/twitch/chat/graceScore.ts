import { getUserByAccountType } from '../twitchApi.js'
import { type Grace, type GraceStats } from './graceStats.js'

const POINTS: Record<Grace['type'], number> = {
	redeem: 10,
	highlight: 5,
	normal: 1,
}
const NightbotUserID = '19264788'

export function updateGraceScore(stats: GraceStats, grace: Grace) {
	stats.totalCombo++
	if (stats.lastGrace && stats.lastGrace.type !== grace.type) {
		stats.endedCombosScore += stats.currentComboScore
		stats.currentComboBasePoints = 0
		stats.currentComboScore = 0
		stats.currentComboSize = 0
		stats.currentComboUsers.clear()
	}
	stats.currentComboUsers.add(grace.user.id)
	let points = POINTS[grace.type]
	if (grace.user.id === NightbotUserID) {
		points = 1000 // Nightbot bonus!
		stats.specialUsers.add('nightbot')
	} else if (grace.user.id === getUserByAccountType('bot').id) {
		points = 100 // Spice bot bonus!
		stats.specialUsers.add('spicebot')
	}
	stats.currentComboBasePoints += points
	stats.currentComboSize++
	stats.currentComboScore = getComboScore(stats)
	stats.totalScore = getTotalScore(stats)
	stats.lastGrace = grace
}

function getComboScore(stats: GraceStats) {
	const userCount = stats.currentComboUsers.size
	return Math.ceil(
		stats.currentComboBasePoints *
			(1 + (stats.currentComboSize - 1) / 2) *
			(1 + (userCount - 1) / 5)
	)
}

function getTotalScore(stats: GraceStats) {
	const totalComboScore = stats.endedCombosScore + stats.currentComboScore
	const userCountBonus = totalComboScore * ((stats.allUsers.size - 1) / 10)
	return Math.ceil(totalComboScore + userCountBonus)
}

export function formatPoints(points: number) {
	return points.toLocaleString('en-US')
}
