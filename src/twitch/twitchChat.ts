import { type RefreshingAuthProvider } from '@twurple/auth'
import { ChatClient, toUserName, PrivateMessage } from '@twurple/chat'
import { ParsedMessageEmotePart } from '@twurple/common'
import { AuthEvents, getAccountScopes } from './twitchApi.js'
import { CHAT_TEST_MODE, timestampLog } from '../util.js'
import Emittery from 'emittery'
import { initGrace } from './grace.js'
import { initRecap } from './recap.js'
import { POGGERS } from './emotes.js'
import { initTally } from './tally.js'

export const ChatEvents = new Emittery<{
	message: {
		username: string
		userID: string
		text: string
		date: Date
		msg: PrivateMessage
		mod: boolean
	}
	redemption: {
		username: string
		userID: string
		title: string
		date: Date
		status: string
		rewardText: string
	}
}>()

let chatClient: ChatClient

export async function initTwitchChat(authProvider: RefreshingAuthProvider) {
	initChatClient(authProvider)
	initGrace()
	initRecap()
	initTally()
	AuthEvents.on('auth', async ({ accountType }) => {
		if (accountType === 'bot') initChatClient(authProvider)
	})
	AuthEvents.on('authRevoke', ({ accountType }) => {
		if (accountType === 'bot') chatClient.quit()
	})
}

async function initChatClient(authProvider: RefreshingAuthProvider) {
	if (chatClient) chatClient.quit()
	const botScopes = await getAccountScopes('bot')
	if (!hasRequiredScopes(botScopes)) {
		console.log('WARNING: Chat bot is missing read/edit scopes!')
		return
	}
	chatClient = new ChatClient({
		authProvider,
		channels: [process.env.TWITCH_STREAMER_USERNAME],
	})
	chatClient.connect()

	chatClient.onAuthenticationFailure((text, retryCount) => {
		timestampLog(`Chat auth failed: ${text}. Retry #${retryCount}`)
	})

	chatClient.onAuthenticationSuccess(() => {
		// Wait for this before performing any actions outside of onMessage
		console.log('Twitch chat connected')
	})

	chatClient.onMessage((channel, user, text, msg) => {
		if (toUserName(channel) !== process.env.TWITCH_STREAMER_USERNAME) return
		if (user === process.env.TWITCH_BOT_USERNAME) return
		const broadcaster = msg.userInfo.isBroadcaster ? '[STREAMER] ' : ''
		const mod = msg.userInfo.isMod ? '[MOD] ' : ''
		ChatEvents.emit('message', {
			username: user,
			userID: msg.userInfo.userId,
			text,
			date: msg.date,
			msg,
			mod: msg.userInfo.isMod || msg.userInfo.isBroadcaster,
		})
		const redemption = msg.isRedemption ? ' (REDEEM)' : ''
		const emotes = msg
			.parseEmotes()
			.filter((part) => part.type === 'emote') as ParsedMessageEmotePart[]
		const emoteList =
			emotes.length > 0
				? ` <EMOTES: ${emotes.map((e) => e.name).join(', ')}>`
				: ''
		timestampLog(
			`${broadcaster}${mod}${user}: ${text}${redemption}${emoteList}`
		)
	})

	chatClient.onSubGift((channel, user, subInfo, msg) => {
		if (toUserName(channel) !== process.env.TWITCH_STREAMER_USERNAME) return
		if (user !== process.env.TWITCH_BOT_USERNAME) return
		const gifter = subInfo.gifterDisplayName || 'anonymous'
		timestampLog(`Bot received a gift sub from ${gifter}`)
		sendChatMessage(
			`Thank you ${gifter} for the gift sub! <3 ${POGGERS} ${POGGERS}`
		)
	})

	chatClient.onWhisper((user, text, msg) => {
		// Need to use apiClient.whispers.sendWhisper() to reply
	})
}

export function sendChatMessage(text: string) {
	if (!chatClient) return
	if (CHAT_TEST_MODE) {
		timestampLog(`Sent: ${text}`)
		return
	}
	chatClient.say(process.env.TWITCH_STREAMER_USERNAME, text)
}

function hasRequiredScopes(scopes: string[]) {
	return scopes.includes('chat:read') && scopes.includes('chat:edit')
}

export function botInChat() {
	return chatClient && chatClient.irc.isConnected
}
