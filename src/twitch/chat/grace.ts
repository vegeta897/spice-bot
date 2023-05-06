import { randomElement } from '../../util.js'
import { TwitchEvents } from '../eventSub.js'
import { Emotes, canUseEmote } from './emotes.js'
import { TrainEvents, OverlayData } from './trains.js'
import { formatPoints } from './graceScore.js'
import {
	type GraceStats,
	type GraceTrainRecord,
	onGrace,
	clearGraceStats,
	breakGraceTrain,
	getCurrentGraceTrain,
} from './graceStats.js'
import {
	botInChat,
	ChatEvents,
	sendChatMessage,
	type TwitchMessageEvent,
} from './twitchChat.js'
import { getUserColor } from './userColors.js'
import { getCurrentHypeTrain } from './hype.js'

export const GRACE = 'GRACE'

export function initGrace() {
	ChatEvents.on('message', onMessage)
	ChatEvents.on('redemption', (event) => {
		if (!botInChat()) return
		onGrace({
			date: event.date,
			user: {
				id: event.userID,
				name: event.username,
				color: getUserColor(event.userID),
			},
			type: 'redeem',
		})
	})
	TwitchEvents.on('streamOnline', ({ downtime }) => {
		if (downtime > 5 * 60 * 1000) {
			overlayPosition = 'bottom'
			clearGraceStats()
		}
	})
	// TwitchEvents.on('streamOffline', () => endGraceTrain('Abby'))
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
		TrainEvents.emit('overlay', { position: overlayPosition })
		sendChatMessage(`OK, moving overlay to the ${overlayPosition}`)
		return
	}
	if (isGraceText(event.text)) {
		onGrace({
			date: event.date,
			user: {
				id: event.userID,
				name: event.msg.userInfo.displayName,
				color: event.userColor,
			},
			type: event.msg.isHighlight ? 'highlight' : 'normal',
		})
		return
	}
	breakGraceTrain(event.msg.userInfo.displayName)
}

function parsePositionCommand(event: TwitchMessageEvent) {
	if (!event.mod) return false
	const text = event.text.toLowerCase()
	if (!text.startsWith('!')) return false
	if (/^!(move )?(train|overlay) (top|upper)/.test(text)) return 'top'
	if (/^!(move )?(train|overlay) (bottom|lower)/.test(text)) return 'bottom'
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

export async function sendTrainEndMessages({
	trainLength,
	endUsername,
	allUsers,
	specialUsers,
	topGracer,
	totalScore,
	bestRecord,
	hyped,
}: GraceStats & {
	trainLength: number
	topGracer: [string, number] | null
	endUsername: string
	bestRecord: GraceTrainRecord
}) {
	const newRecords: Partial<GraceTrainRecord> = {}
	const canPrayBee = await canUseEmote(Emotes.PRAYBEE)
	let message = ''
	if (hyped) message += 'HYPED grace train has ended!'
	else
		message +=
			endUsername.toLowerCase() === process.env.TWITCH_BOT_USERNAME
				? `${randomElement(['OOPS', 'OH NO', 'WOW'])}! I ended the grace train!`
				: `Grace train ended by ${endUsername}!`
	message += ` That was ${trainLength} graces`
	if (bestRecord.length > 0 && trainLength > bestRecord.length) {
		message +=
			', a NEW RECORD for ' + (hyped ? 'hyped grace trains!' : 'total length!')
		if (canPrayBee) {
			message += ` ${Emotes.PRAYBEE}`.repeat(
				Math.ceil(trainLength / (hyped ? 50 : 20))
			)
		}
		newRecords.length = trainLength
	} else if (trainLength === bestRecord.length) {
		message +=
			', tying the record for ' +
			(hyped ? 'hyped grace trains!' : 'total length!')
	} else {
		message += '!'
	}
	sendChatMessage(message)
	message = `${allUsers.size} people contributed`
	if (bestRecord.users > 0 && allUsers.size > bestRecord.users) {
		message += ', the most yet!'
		newRecords.users = allUsers.size
		sendChatMessage(message)
	} else if (specialUsers.has('spicebot')) {
		message += `, including me, Spice Bot! 🌶️`
		sendChatMessage(message)
	} else if (specialUsers.has('nightbot')) {
		message += `, including NIGHTBOT! 🤖`
		sendChatMessage(message)
	} else {
		// Don't send message if nothing notable about the contributors
	}
	if (topGracer) {
		message = `${topGracer[0]} added ${topGracer[1]} graces!`
		sendChatMessage(message)
	}
	message = `GRACE SCORE: ${formatPoints(totalScore)} points`
	if (bestRecord.score > 0 && totalScore > bestRecord.score) {
		message += `, a NEW RECORD for best score!`
		if (newRecords.length && canPrayBee) message += ` ${Emotes.PRAYBEE}`
		newRecords.score = totalScore
	} else if (totalScore === bestRecord.score) {
		message += `, tying the record for best ${hyped ? 'hyped ' : ''}score!`
	} else {
		message += '!'
	}
	sendChatMessage(message)
}

export const makeTextGraceTrainSafe = (text: string) => {
	if (!getCurrentGraceTrain() || getCurrentHypeTrain() || isGraceText(text))
		return text
	return `${text} (${randomElement(['', 'also ', 'and, '])}${randomElement([
		'grace',
		'GRACE',
	])})`
}
