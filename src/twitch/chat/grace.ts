import Emittery from 'emittery'
import { getData, modifyData } from '../../db.js'
import { TwitchEvents } from '../eventSub.js'
import { getEmoteByName, getUsableEmotes, Emotes } from './emotes.js'
import {
	botInChat,
	ChatEvents,
	sendChatMessage,
	type TwitchMessageEvent,
} from './twitchChat.js'

type Grace = { date: Date; userID: string; type: GraceType }
export type GraceTrainRecords = {
	bestLength: number
	bestScore: number
	mostUsers: number
}

export const GRACE = 'GRACE'
type GraceType = 'redeem' | 'highlight' | 'normal'
export const GraceEvents = new Emittery<{ grace: { type: GraceType } }>()

const train: Grace[] = []
const POINTS: Record<GraceType, number> = {
	redeem: 10,
	highlight: 5,
	normal: 1,
}
const TRAIN_TIMEOUT = 5 * 60 * 1000 // 5 minutes
const NightbotUserID = '19264788'

// type TimeStats = { min: number; max: number; avg: number; count: number }
// const redemptionTimeStats: TimeStats = {
// 	min: Infinity,
// 	max: 0,
// 	avg: 0,
// 	count: 0,
// }
// const messageTimeStats: TimeStats = {
// 	min: Infinity,
// 	max: 0,
// 	avg: 0,
// 	count: 0,
// }

// function updateTimeStats(stats: TimeStats, date: Date) {
// 	const offset = Date.now() - date.getTime()
// 	stats.count++
// 	if (offset > stats.max) stats.max = offset
// 	if (offset < stats.min) stats.min = offset
// 	stats.avg += (offset - stats.avg) / stats.count
// }

export function initGrace() {
	ChatEvents.on('message', onMessage)
	ChatEvents.on('redemption', (event) => {
		if (endingTrain) return
		// updateTimeStats(redemptionTimeStats, event.date)
		// console.log('redemption time stats:', redemptionTimeStats)
		if (botInChat()) addGrace(event.date, event.userID, 'redeem')
	})
	TwitchEvents.on('streamOnline', () => clearTrain())
}

function onMessage(event: TwitchMessageEvent) {
	if (endingTrain) return
	// updateTimeStats(messageTimeStats, event.date)
	// if (messageTimeStats.count % 50 === 0)
	// 	console.log('message time stats:', messageTimeStats)
	if (isGraceText(event.text)) {
		addGrace(
			event.date,
			event.userID,
			event.msg.isHighlight ? 'highlight' : 'normal'
		)
		return
	}
	if (train.length === 0) return
	endGraceTrain(event.msg.userInfo.displayName)
}

function addGrace(date: Date, userID: string, type: GraceType) {
	GraceEvents.emit('grace', { type })
	if (train.length > 0) {
		const lastGraceDate = train.at(-1)!.date
		if (date.getTime() - lastGraceDate.getTime() > TRAIN_TIMEOUT) clearTrain()
	}
	train.push({ date, userID, type })
}

function isGraceText(text: string) {
	return (
		text
			.toLowerCase()
			.replace(/ /g, '')
			.replace(/[^\w\s]|(.)(?=\1)/gi, '') // Compress repeated chars
			.includes('grace') || text.includes(Emotes.PRAYBEE)
	)
}

let endingTrain = false

async function endGraceTrain(endUser: string) {
	const trainUsers: Set<string> = new Set(train.map((g) => g.userID))
	if (train.length < 6 || trainUsers.size < 2) {
		train.length = 0
		return
	}
	endingTrain = true
	let qualifiedLength = 0
	let redemptionStreak = 0
	let bestRedemptionStreak = 0
	let totalScore = 0
	let comboPoints = 0
	let comboSize = 0
	let comboUsers: Set<string> = new Set()
	let lastGraceType = ''
	let lastGraceUser = ''
	const pointBreakdown = { redeem: 0, highlight: 0, normal: 0 }
	for (const grace of train) {
		qualifiedLength++
		if (grace.type === 'redeem') {
			if (grace.userID !== lastGraceUser) redemptionStreak++
		} else {
			if (redemptionStreak > bestRedemptionStreak) {
				bestRedemptionStreak = redemptionStreak
			}
			redemptionStreak = 0
		}
		if (lastGraceType && grace.type !== lastGraceType) {
			const endedCombo = endCombo(comboPoints, comboSize, comboUsers)
			totalScore += endedCombo
			pointBreakdown[lastGraceType as GraceType] += endedCombo
			comboPoints = 0
			comboSize = 0
			comboUsers.clear()
		} else if (grace.userID === lastGraceUser) {
			qualifiedLength--
			comboSize--
		}
		let points = POINTS[grace.type]
		if (grace.userID === NightbotUserID) points = 10000 // Nightbot bonus!
		comboPoints += points
		comboSize++
		comboUsers.add(grace.userID)
		lastGraceType = grace.type
		lastGraceUser = grace.userID
	}
	if (redemptionStreak > bestRedemptionStreak) {
		bestRedemptionStreak = redemptionStreak
	}
	// TODO: Do something with bestRedemptionStreak?
	const endedCombo = endCombo(comboPoints, comboSize, comboUsers)
	totalScore += endedCombo
	pointBreakdown[lastGraceType as GraceType] += endedCombo
	const userCountBonus = Math.ceil(totalScore * ((trainUsers.size - 1) / 10))
	totalScore += userCountBonus
	totalScore = Math.ceil(totalScore)
	const { bestLength, bestScore, mostUsers } = getData().graceTrainRecords
	const newRecords: Partial<GraceTrainRecords> = {}
	const canPrayBee = getEmoteByName(Emotes.PRAYBEE, await getUsableEmotes())
	let message = `Grace train ended by ${endUser}! That was ${qualifiedLength} graces`
	if (qualifiedLength > bestLength) {
		message += `, a NEW RECORD for total length!`
		if (canPrayBee) {
			message += ` ${Emotes.PRAYBEE}`.repeat(Math.ceil(qualifiedLength / 10))
		}
		newRecords.bestLength = qualifiedLength
	} else if (qualifiedLength === bestLength) {
		message += `, tying the record for total length!`
	} else {
		message += '!'
	}
	sendChatMessage(message)
	message = `${trainUsers.size} people contributed`
	if (trainUsers.has(NightbotUserID)) {
		message += `, including NIGHTBOT!? 🤖`
	} else if (trainUsers.size > mostUsers) {
		message += `, the most yet!`
		newRecords.mostUsers = trainUsers.size
	} else {
		message += '!'
	}
	sendChatMessage(message)
	message = `GRACE SCORE: ${formatPoints(totalScore)} points`
	if (totalScore > bestScore) {
		message += `, a NEW RECORD for best score!`
		if (newRecords.bestLength && canPrayBee) message += ` ${Emotes.PRAYBEE}`
		newRecords.bestScore = totalScore
	} else if (totalScore === bestScore) {
		message += `, tying the record for best score!`
	} else {
		message += '!'
	}
	sendChatMessage(message)
	modifyData({
		graceTrainRecords: {
			...getData().graceTrainRecords,
			...newRecords,
		},
	})
	// message = `Points breakdown: `
	// const breakdownParts: string[] = []
	// if (pointBreakdown.redeem)
	// 	breakdownParts.push(`redeemed: ${formatPoints(pointBreakdown.redeem)}`)
	// if (pointBreakdown.highlight)
	// 	breakdownParts.push(
	// 		`highlighted: ${formatPoints(pointBreakdown.highlight)}`
	// 	)
	// if (pointBreakdown.normal)
	// 	breakdownParts.push(`normal: ${formatPoints(pointBreakdown.normal)}`)
	// breakdownParts.push(`Contributor bonus: ${formatPoints(userCountBonus)}`)
	// message += breakdownParts.join(' — ')
	// sendChatMessage(message)
	// TODO: Call out users who tried to spam it?
	clearTrain()
}

function endCombo(
	comboPoints: number,
	comboSize: number,
	comboUsers: Set<any>
) {
	comboSize = Math.max(comboSize, 1)
	const userCount = Math.max(comboUsers.size, 1)
	return Math.ceil(
		comboPoints * (1 + (comboSize - 1) / 2) * (1 + (userCount - 1) / 5)
	)
}

function formatPoints(points: number) {
	return points.toLocaleString('en-US')
}

function clearTrain() {
	train.length = 0
	endingTrain = false
}
