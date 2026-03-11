import { getAccountScopes, getUserByAccountType } from '../twitchApi.js'
import { CHAT_TEST_MODE, DEV_MODE } from '../../util.js'
import { timestampLog } from '../../logger.js'
import Emittery from 'emittery'
import { initGrace } from './grace.js'
import { initRecap } from './recap.js'
import { initTally } from './tally.js'
import { initWhereBot } from './whereBot.js'
import { initThanks } from './thanks.js'
import { updateUserColor } from './userColors.js'
import type { ApiClient } from '@twurple/api'
import type { EventSubHttpListener } from '@twurple/eventsub-http'

// Idea: Detect incrementing numbers in ryan's messages for death tracker
//       Then we can provide a command to check the count

export type TwitchMessageEvent = {
	username: string
	userID: string
	userColor: string | null
	text: string
	date: Date
	msgEvent: Parameters<
		Parameters<EventSubHttpListener['onChannelChatMessage']>[2]
	>[0]
	mod: boolean
	self: boolean
}

export const ChatEvents = new Emittery<{
	message: TwitchMessageEvent
	redemption: {
		username: string
		userID: string
		title: string
		date: Date
		status: string
		rewardText: string
	}
	raid: undefined
}>()

let apiClient: ApiClient

export async function initTwitchChat(options: { apiClient: ApiClient }) {
	const botScopes = await getAccountScopes('bot')
	if (!hasRequiredScopes(botScopes)) {
		console.log('WARNING: Chat bot is missing required scopes!')
		return
	}
	apiClient = options.apiClient
	initGrace()
	initRecap()
	initTally()
	initWhereBot()
	initThanks()
}

ChatEvents.on('message', (event) => {
	updateUserColor(event.userID, event.userColor)
	// TODO: Send cheer bits to hype train
	if (DEV_MODE) {
		const messageType = event.msgEvent.messageType
		const cheer = event.msgEvent.bits ? ` (${event.msgEvent.bits} BITS)` : ''
		timestampLog(`(${messageType}) ${event.username}: ${event.text}${cheer}`)
	}
})

export async function sendChatMessage(
	text: string,
	replyParentMessageId?: string
) {
	if (!apiClient) return
	if (CHAT_TEST_MODE) {
		timestampLog(`Sent: ${text}`)
		return
	}
	try {
		return await apiClient.asUser(getUserByAccountType('bot'), async (ctx) =>
			ctx.chat.sendChatMessage(getUserByAccountType('streamer'), text, {
				replyParentMessageId,
			})
		)
	} catch (e) {
		timestampLog('Error sending chat message', e)
	}
}

export async function sendWhisper(toUserID: string, text: string) {
	try {
		await apiClient.whispers.sendWhisper(
			getUserByAccountType('bot'),
			toUserID,
			text
		)
	} catch (e) {
		timestampLog('Error sending whisper', e)
	}
}

function hasRequiredScopes(scopes: string[]) {
	return (
		scopes.includes('user:bot') &&
		scopes.includes('user:read:chat') &&
		scopes.includes('user:write:chat')
	)
}
