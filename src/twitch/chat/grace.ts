import { TwitchEvents } from '../eventSub.js'
import { Emotes, canUseEmote } from './emotes.js'
import { GraceTrainEvents, OverlayData } from './graceEvents.js'
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
	TwitchEvents.on('streamOnline', () => {
		overlayPosition = 'bottom'
		clearStats()
	})
	TwitchEvents.on('streamOffline', () => endGraceTrain('Abby'))
}

let overlayPosition: OverlayData['position'] = 'bottom'
export const getOverlayPosition = () => overlayPosition

function onMessage(event: TwitchMessageEvent) {
	const positionCommand = parsePositionCommand(event)
	if (positionCommand) {
		// change overlay position
		if (positionCommand !== true) {
			if (overlayPosition === positionCommand) {
				sendChatMessage(`Overlay is already at the ${overlayPosition}!`)
				return
			}
			overlayPosition = positionCommand
		} else {
			overlayPosition = overlayPosition === 'top' ? 'bottom' : 'top'
		}
		GraceTrainEvents.emit('overlay', { position: overlayPosition })
		sendChatMessage(`OK, moving overlay to the ${overlayPosition}`)
		return
	}
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

function parsePositionCommand(event: TwitchMessageEvent) {
	if (!event.mod) return false
	const text = event.text.toLowerCase()
	if (!text.startsWith('!')) return false
	if (/^!(move )?overlay (top|upper)/.test(text)) return 'top'
	if (/^!(move )?overlay (bottom|lower)/.test(text)) return 'bottom'
	if (/^!move ?(train|overlay)/.test(text)) return true
	if (/^!train ?move/.test(text)) return true
	if (/^!overlay ?move/.test(text)) return true
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
