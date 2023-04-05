import Emittery from 'emittery'
import { TwitchEvents } from '../eventSub.js'
import {
	getEmoteByName,
	getUsableEmotes,
	Emotes,
	canUseEmote,
} from './emotes.js'
import {
	createGraceStats,
	formatPoints,
	getBestRecord,
	type GraceStats,
	type GraceTrainRecord,
	saveRecord,
	updateGraceScore,
} from './graceStats.js'
import {
	botInChat,
	ChatEvents,
	sendChatMessage,
	type TwitchMessageEvent,
} from './twitchChat.js'
import { getUserColor } from './userColors.js'

export type Grace = {
	date: Date
	user: { id: string; color: string }
	type: GraceType
}

export const GRACE = 'GRACE'
export type GraceType = 'redeem' | 'highlight' | 'normal'
type TrainBaseEvent = { id: number; combo: number; score: number }
export const GraceTrainEvents = new Emittery<{
	start: TrainBaseEvent & { colors: string[] }
	grace: TrainBaseEvent & { color: string }
	end: TrainBaseEvent & { username: string }
}>()

let trainID = 0
let trainStats: ReturnType<typeof createGraceStats> | null = null

// TODO: Move stats object to graceStats.ts
// Handle all stats-related stuff there

// TODO: Catch all possible errors (such as bot sub check)

const train: Grace[] = []
const MIN_TRAIN_LENGTH = 5
const TRAIN_TIMEOUT = 10 * 60 * 1000 // 10 minutes
const NightbotUserID = '19264788'

export function initGrace() {
	ChatEvents.on('message', onMessage)
	ChatEvents.on('redemption', (event) => {
		if (endingTrain) return
		if (botInChat())
			addGrace({
				date: event.date,
				user: { id: event.userID, color: getUserColor(event.userID) },
				type: 'redeem',
			})
	})
	TwitchEvents.on('streamOnline', () => clearTrain())
}

function onMessage(event: TwitchMessageEvent) {
	if (endingTrain) return
	if (isGraceText(event.text)) {
		addGrace({
			date: event.date,
			user: { id: event.userID, color: event.userColor },
			type: event.msg.isHighlight ? 'highlight' : 'normal',
		})
		return
	}
	if (train.length === 0 || !trainStats) return
	trainStats.endUsername = event.msg.userInfo.displayName
	endGraceTrain(trainStats)
}

function addGrace({ date, user, type }: Grace) {
	trainStats ||= createGraceStats()
	if (train.length === 0) {
		trainID = Date.now()
	} else {
		const lastGraceDate = train.at(-1)!.date
		if (date.getTime() - lastGraceDate.getTime() > TRAIN_TIMEOUT) clearTrain()
	}

	train.push({ date, user, type })
	updateGraceScore(trainStats, { date, user, type })
	if (train.length === MIN_TRAIN_LENGTH) {
		GraceTrainEvents.emit('start', {
			id: trainID,
			combo: trainStats.totalCombo,
			score: trainStats.runningTotalScore,
			colors: train.map((g) => g.user.color),
		})
	} else if (train.length > MIN_TRAIN_LENGTH) {
		GraceTrainEvents.emit('grace', {
			id: trainID,
			color: user.color,
			combo: trainStats.totalCombo,
			score: trainStats.runningTotalScore,
		})
	}
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

async function endGraceTrain(trainStats: GraceStats) {
	if (train.length < MIN_TRAIN_LENGTH || trainStats.allUsers.size < 2) {
		clearTrain()
		return
	}
	endingTrain = true
	const bestRecord = getBestRecord()
	const newRecords: Partial<GraceTrainRecord> = {}
	const canPrayBee = await canUseEmote(Emotes.PRAYBEE)
	let message = `Grace train ended by ${trainStats.endUsername}! That was ${train.length} graces`
	if (train.length > bestRecord.length) {
		message += `, a NEW RECORD for total length!`
		if (canPrayBee) {
			message += ` ${Emotes.PRAYBEE}`.repeat(Math.ceil(train.length / 10))
		}
		newRecords.length = train.length
	} else if (train.length === bestRecord.length) {
		message += `, tying the record for total length!`
	} else {
		message += '!'
	}
	sendChatMessage(message)
	message = `${trainStats.allUsers.size} people contributed`
	if (trainStats.allUsers.has(NightbotUserID)) {
		message += `, including NIGHTBOT!? 🤖`
	} else if (trainStats.allUsers.size > bestRecord.users) {
		message += `, the most yet!`
		newRecords.users = trainStats.allUsers.size
	} else {
		message += '!'
	}
	sendChatMessage(message)
	message = `GRACE SCORE: ${formatPoints(trainStats.finalScore)} points`
	if (trainStats.finalScore > bestRecord.score) {
		message += `, a NEW RECORD for best score!`
		if (newRecords.length && canPrayBee) message += ` ${Emotes.PRAYBEE}`
		newRecords.score = trainStats.finalScore
	} else if (trainStats.finalScore === bestRecord.score) {
		message += `, tying the record for best score!`
	} else {
		message += '!'
	}
	sendChatMessage(message)
	saveRecord(trainStats)
	GraceTrainEvents.emit('end', {
		id: trainID,
		username: trainStats.endUsername!,
		combo: trainStats.totalCombo,
		score: trainStats.finalScore,
	})
	clearTrain()
}

function clearTrain() {
	train.length = 0
	trainStats = null
	endingTrain = false
}
