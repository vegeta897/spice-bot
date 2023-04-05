import { TwitchEvents } from '../eventSub.js'
import { Emotes, canUseEmote } from './emotes.js'
import { formatPoints } from './graceScore.js'
import {
	getBestRecord,
	type GraceStats,
	type GraceTrainRecord,
	addGrace,
	clearStats,
	endGraceTrain,
} from './graceStats.js'
import {
	botInChat,
	ChatEvents,
	sendChatMessage,
	type TwitchMessageEvent,
} from './twitchChat.js'
import { getUserColor } from './userColors.js'

export const GRACE = 'GRACE'

export function initGrace() {
	ChatEvents.on('message', onMessage)
	ChatEvents.on('redemption', (event) => {
		if (!botInChat()) return
		addGrace({
			date: event.date,
			user: { id: event.userID, color: getUserColor(event.userID) },
			type: 'redeem',
		})
	})
	TwitchEvents.on('streamOnline', () => clearStats())
}

function onMessage(event: TwitchMessageEvent) {
	if (isGraceText(event.text)) {
		addGrace({
			date: event.date,
			user: { id: event.userID, color: event.userColor },
			type: event.msg.isHighlight ? 'highlight' : 'normal',
		})
		return
	}
	// A non-grace message ends the train
	endGraceTrain(event.msg.userInfo.displayName)
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

export async function sendTrainEndMessages(graceStats: GraceStats) {
	const bestRecord = getBestRecord()
	const newRecords: Partial<GraceTrainRecord> = {}
	const canPrayBee = await canUseEmote(Emotes.PRAYBEE)
	const trainLength = graceStats.graces.length
	let message = `Grace train ended by ${graceStats.endUsername}! That was ${trainLength} graces`
	if (trainLength > bestRecord.length) {
		message += `, a NEW RECORD for total length!`
		if (canPrayBee) {
			message += ` ${Emotes.PRAYBEE}`.repeat(Math.ceil(trainLength / 10))
		}
		newRecords.length = trainLength
	} else if (trainLength === bestRecord.length) {
		message += `, tying the record for total length!`
	} else {
		message += '!'
	}
	sendChatMessage(message)
	message = `${graceStats.allUsers.size} people contributed`
	if (graceStats.includesNightbot) {
		message += `, including NIGHTBOT!? 🤖`
	} else if (graceStats.allUsers.size > bestRecord.users) {
		message += `, the most yet!`
		newRecords.users = graceStats.allUsers.size
	} else {
		message += '!'
	}
	sendChatMessage(message)
	message = `GRACE SCORE: ${formatPoints(graceStats.finalScore)} points`
	if (graceStats.finalScore > bestRecord.score) {
		message += `, a NEW RECORD for best score!`
		if (newRecords.length && canPrayBee) message += ` ${Emotes.PRAYBEE}`
		newRecords.score = graceStats.finalScore
	} else if (graceStats.finalScore === bestRecord.score) {
		message += `, tying the record for best score!`
	} else {
		message += '!'
	}
	sendChatMessage(message)
}
