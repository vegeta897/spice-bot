import { getUserByAccountType } from '../twitchApi.js'
import { makeTextGraceTrainSafe } from '../trains/grace.js'
import { ChatEvents, sendChatMessage } from './twitchChat.js'

export function initThanks() {
	const botUser = getUserByAccountType('bot')
	ChatEvents.on('message', async (event) => {
		if (event.self) return
		const now = Date.now()
		if (now - lastThanksTime < COOLDOWN) return
		lastThanksTime = now
		const isReplyToBot = event.msg.parentMessageUserId === botUser.id
		if (isThanks(event.text)) {
			if (isReplyToBot || /spice[ -]?bot/gi.test(event.text)) {
				sendChatMessage(
					await makeTextGraceTrainSafe("You're welcome!"),
					event.msg.id
				)
			}
		} else if (isReplyToBot && /good (spice)?[ -]?bot/.test(event.text)) {
			sendChatMessage(
				await makeTextGraceTrainSafe('Happy to help!'),
				event.msg.id
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
