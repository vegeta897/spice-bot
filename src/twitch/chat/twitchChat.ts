import { type RefreshingAuthProvider } from '@twurple/auth'
import { ChatClient, toUserName, PrivateMessage } from '@twurple/chat'
import { ParsedMessageEmotePart } from '@twurple/common'
import { AuthEvents, getAccountScopes, sendWhisper } from '../twitchApi.js'
import { CHAT_TEST_MODE, DEV_MODE, timestampLog } from '../../util.js'
import Emittery from 'emittery'
import { initGrace } from './grace.js'
import { initRecap } from './recap.js'
import { Emotes } from './emotes.js'
import { initTally } from './tally.js'
import { initWhereBot } from './whereBot.js'
import { initThanks } from './thanks.js'

// Idea: Detect incrementing numbers in ryan's messages for death tracker
//       Then we can provide a command to check the count

export type TwitchMessageEvent = {
	username: string
	userID: string
	text: string
	date: Date
	msg: PrivateMessage
	mod: boolean
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
}>()

let chatClient: ChatClient

export async function initTwitchChat(authProvider: RefreshingAuthProvider) {
	initChatClient(authProvider)
	initGrace()
	initRecap()
	initTally()
	initWhereBot()
	initThanks()
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
		const highlight = msg.isHighlight ? ' (HIGHLIGHT)' : ''
		const cheer = msg.isCheer ? ' (CHEER)' : ''
		const emotes = msg
			.parseEmotes()
			.filter((part) => part.type === 'emote') as ParsedMessageEmotePart[]
		const emoteList =
			emotes.length > 0
				? ` <EMOTES: ${emotes.map((e) => e.name).join(', ')}>`
				: ''
		if (DEV_MODE)
			timestampLog(
				`${broadcaster}${mod}${user}: ${text}${redemption}${highlight}${cheer}${emoteList}`
			)
	})

	chatClient.onSubGift((channel, user, subInfo, msg) => {
		if (toUserName(channel) !== process.env.TWITCH_STREAMER_USERNAME) return
		if (user !== process.env.TWITCH_BOT_USERNAME) return
		const gifter = subInfo.gifterDisplayName || 'anonymous'
		timestampLog(`Bot received a gift sub from ${gifter}`)
		sendChatMessage(
			`Thank you ${gifter} for the gift sub! <3 ${Emotes.POGGERS} ${Emotes.POGGERS}`
		)
	})

	const whispers: Map<string, number> = new Map()
	const whisperCooldown = 30 * 1000
	chatClient.onWhisper((user, text, msg) => {
		// Maybe use this to send debug commands?
		timestampLog(`Whisper from ${msg.userInfo.displayName}: ${text}`)
		const userID = msg.userInfo.userId
		if ((whispers.get(userID) || 0) + whisperCooldown > Date.now()) return
		whispers.set(userID, Date.now())
		sendWhisper(
			userID,
			`Hi, I'm Spice Bot! I do various tasks in ${
				process.env.NICKNAME || process.env.TWITCH_STREAMER_USERNAME
			}'s channel. Please contact ${
				process.env.TWITCH_ADMIN_USERNAME
			} with any problems or questions`
		)
	})
}

export function sendChatMessage(
	text: string,
	replyTo?: string | PrivateMessage
) {
	if (!chatClient) return
	if (CHAT_TEST_MODE) {
		timestampLog(`Sent: ${text}`)
		return
	}
	chatClient.say(process.env.TWITCH_STREAMER_USERNAME, text, { replyTo })
}

function hasRequiredScopes(scopes: string[]) {
	return scopes.includes('chat:read') && scopes.includes('chat:edit')
}

export function botInChat() {
	return chatClient && chatClient.irc.isConnected
}
