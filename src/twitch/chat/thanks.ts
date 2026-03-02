import { getUserByAccountType } from '../twitchApi.js'
import { makeTextGraceTrainSafe } from './grace.js'
import { ChatEvents, sendChatMessage } from './twitchChat.js'

export function initThanks() {
	const botUser = getUserByAccountType('bot')
	ChatEvents.on('message', (event) => {
		if (event.self) return
		const now = Date.now()
		if (now - lastThanksTime < COOLDOWN) return
		lastThanksTime = now
		const isReplyToBot = event.msgEvent.parentMessageUserId === botUser.id
		if (isThanks(event.text)) {
			if (isReplyToBot || /spice[ -]?bot/gi.test(event.text)) {
				sendChatMessage(
					makeTextGraceTrainSafe("You're welcome!"),
					event.msgEvent.messageId
				)
			}
		} else if (isReplyToBot && /good (spice)?[ -]?bot/.test(event.text)) {
			sendChatMessage(
				makeTextGraceTrainSafe('Happy to help!'),
				event.msgEvent.messageId
			)
		}
	})
}

function isThanks(text: string) {
	return thankYouTests.some((rx) => rx.test(text))
}

const thankYouTests = [
	/thanks? ?((yo)?u)?/gi,
	/(^| )ty/gi,
	/gracias/gi,
	/merci/gi,
	/d[aá]nke/gi,
]

let lastThanksTime = 0
const COOLDOWN = 5 * 1000
