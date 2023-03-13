import Emittery from 'emittery'
import { getData, modifyData } from '../../db.js'
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

type TimeStats = { min: number; max: number; avg: number; count: number }
const redemptionTimeStats: TimeStats = {
	min: Infinity,
	max: 0,
	avg: 0,
	count: 0,
}
const messageTimeStats: TimeStats = {
	min: Infinity,
	max: 0,
	avg: 0,
	count: 0,
}

function updateTimeStats(stats: TimeStats, date: Date) {
	const offset = Date.now() - date.getTime()
	stats.count++
	if (offset > stats.max) stats.max = offset
	if (offset < stats.min) stats.min = offset
	stats.avg += (offset - stats.avg) / stats.count
}

export function initGrace() {
	ChatEvents.on('message', onMessage)
	ChatEvents.on('redemption', (event) => {
		updateTimeStats(redemptionTimeStats, event.date)
		console.log('redemption time stats:', redemptionTimeStats)
		if (botInChat()) addGrace(event.date, event.userID, 'redeem')
	})
}

function onMessage(event: TwitchMessageEvent) {
	updateTimeStats(messageTimeStats, event.date)
	if (messageTimeStats.count % 50 === 0)
		console.log('message time stats:', messageTimeStats)
	if (isGraceText(event.text)) {
		addGrace(
			event.date,
			event.userID,
			event.msg.isHighlight ? 'highlight' : 'normal'
		)
		return
	}
	if (train.length === 0) return
	for (let i = train.length - 1; i >= 0; i--) {
		if (train[i].date < event.date) {
			if (i < train.length - 2) train.splice(i, train.length - i)
			endGraceTrain(event.msg.userInfo.displayName)
			break
		}
	}
}

function addGrace(date: Date, userID: string, type: GraceType) {
	GraceEvents.emit('grace', { type })
	if (train.length === 0) {
		train.push({ date, userID, type })
		return
	}
	for (let i = train.length - 1; i >= 0; i--) {
		if (train[i].date < date) {
			train.splice(i + 1, 0, { date, userID, type })
			break
		}
	}
}

function isGraceText(text: string) {
	return text
		.toLowerCase()
		.replace(/ /g, '')
		.replace(/[^\w\s]|(.)(?=\1)/gi, '') // Compress repeated chars
		.includes('grace')
}

async function endGraceTrain(endUser: string) {
	const trainUsers: Set<string> = new Set(train.map((g) => g.userID))
	if (train.length < 6 || trainUsers.size < 2) {
		train.length = 0
		return
	}
	let redemptionStreak = 0
	let bestRedemptionStreak = 0
	let totalScore = 0
	let comboPoints = 0
	let comboSize = 0
	let comboUsers: Set<string> = new Set()
	let lastGraceType = ''
	let lastGraceUser = ''
	for (const grace of train) {
		if (grace.type === 'redeem') {
			if (grace.userID !== lastGraceUser) redemptionStreak++
		} else {
			if (redemptionStreak > bestRedemptionStreak) {
				bestRedemptionStreak = redemptionStreak
			}
			redemptionStreak = 0
		}
		if (lastGraceType && grace.type !== lastGraceType) {
			totalScore += endCombo(comboPoints, comboSize, comboUsers)
			comboPoints = 0
			comboSize = 0
			comboUsers.clear()
		} else if (grace.userID === lastGraceUser) {
			comboSize--
		}
		comboPoints += POINTS[grace.type]
		comboSize++
		comboUsers.add(grace.userID)
		lastGraceType = grace.type
		lastGraceUser = grace.userID
	}
	if (redemptionStreak > bestRedemptionStreak) {
		bestRedemptionStreak = redemptionStreak
	}
	totalScore += endCombo(comboPoints, comboSize, comboUsers)
	totalScore *= 1 + (trainUsers.size - 1) / 10
	totalScore = Math.ceil(totalScore)
	const { bestLength, bestScore, mostUsers } = getData().graceTrainRecords
	const newRecords: Partial<GraceTrainRecords> = {}
	const canPrayBee = getEmoteByName(Emotes.PRAYBEE, await getUsableEmotes())
	let message = `Grace train ended by ${endUser}! That was ${train.length} graces`
	if (train.length > bestLength) {
		message += `, a NEW RECORD for total length!`
		if (canPrayBee) {
			message += ` ${Emotes.PRAYBEE}`.repeat(Math.ceil(train.length / 10))
		}
		newRecords.bestLength = train.length
	} else if (train.length === bestLength) {
		message += `, tying the record for total length!`
	} else {
		message += '!'
	}
	sendChatMessage(message)
	message = `${trainUsers.size} people contributed`
	if (trainUsers.size > mostUsers) {
		message += `, the most yet!`
		newRecords.mostUsers = trainUsers.size
	} else {
		message += '!'
	}
	sendChatMessage(message)
	message = `GRACE SCORE: ${totalScore} points`
	if (totalScore > bestScore) {
		message += `, a NEW RECORD for best score!`
		if (train.length < bestLength && canPrayBee) message += ` ${Emotes.PRAYBEE}`
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
	train.length = 0
}

function endCombo(
	comboPoints: number,
	comboSize: number,
	comboUsers: Set<any>
) {
	comboSize = Math.max(comboSize, 1)
	const userCount = Math.max(comboUsers.size, 1)
	return comboPoints * (1 + (comboSize - 1) / 2) * (1 + (userCount - 1) / 5)
}
