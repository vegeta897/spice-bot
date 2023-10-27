import { type RefreshingAuthProvider } from '@twurple/auth'
import {
	ChatClient,
	toUserName,
	ChatMessage,
	parseChatMessage,
	ParsedMessageEmotePart,
} from '@twurple/chat'
import {
	AuthEvents,
	botIsMod,
	getAccountScopes,
	getUserByAccountType,
	sendWhisper,
} from '../twitchApi.js'
import { CHAT_TEST_MODE, DEV_MODE, sleep } from '../../util.js'
import { timestampLog } from '../../logger.js'
import Emittery from 'emittery'
import { initGrace, makeTextGraceTrainSafe } from './grace.js'
import { initRecap } from './recap.js'
import { Emotes } from './emotes.js'
import { initTally } from './tally.js'
import { initWhereBot } from './whereBot.js'
import { initThanks } from './thanks.js'
import { updateUserColor } from './userColors.js'
import { PubSubClient } from '@twurple/pubsub'
import { modifyData } from '../../db.js'

// Idea: Detect incrementing numbers in ryan's messages for death tracker
//       Then we can provide a command to check the count

export type TwitchMessageEvent = {
	username: string
	userID: string
	userColor: string
	text: string
	date: Date
	msg: ChatMessage
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
	const botScopes = await getAccountScopes('bot')
	if (!hasRequiredScopes(botScopes)) {
		console.log('WARNING: Chat bot is missing read/edit scopes!')
		return
	}
	if (chatClient) {
		if (!chatClient.isConnected) chatClient.reconnect()
		return
	}
	chatClient = new ChatClient({
		authProvider,
		channels: [process.env.TWITCH_STREAMER_USERNAME],
		rejoinChannelsOnReconnect: true,
		isAlwaysMod: await botIsMod(),
		logger: { minLevel: 'info' },
	})
	chatClient.connect()

	chatClient.onDisconnect(async (manually, reason) => {
		timestampLog(
			`Chat disconnected${manually ? ' (manually)' : ''}: ${
				reason || 'unknown reason'
			}`
		)
		await sleep(5 * 1000)
		if (chatClient.isConnected || chatClient.isConnecting) return
		timestampLog('Client is not auto-reconnecting, now calling reconnect()')
		chatClient.reconnect()
	})

	chatClient.onAuthenticationFailure((text, retryCount) => {
		timestampLog(`Chat auth failed: ${text}. Retry #${retryCount}`)
	})

	chatClient.onAuthenticationSuccess(() => {
		// Wait for this before performing any actions outside of onMessage
		timestampLog('Twitch chat authenticated')
	})

	chatClient.onMessage((channel, user, text, msg) => {
		if (toUserName(channel) !== process.env.TWITCH_STREAMER_USERNAME) return
		// if (user === process.env.TWITCH_BOT_USERNAME) return
		const broadcaster = msg.userInfo.isBroadcaster ? '[STREAMER] ' : ''
		const mod = msg.userInfo.isMod ? '[MOD] ' : ''
		const userColor = updateUserColor(
			msg.userInfo.userId,
			msg.userInfo.color || null
		)
		ChatEvents.emit('message', {
			username: user,
			userID: msg.userInfo.userId,
			userColor,
			text,
			date: msg.date,
			msg,
			mod: msg.userInfo.isMod || msg.userInfo.isBroadcaster,
			self: user === process.env.TWITCH_BOT_USERNAME,
		})
		const redemption = msg.isRedemption ? ' (REDEEM)' : ''
		const highlight = msg.isHighlight ? ' (HIGHLIGHT)' : ''
		const cheer = msg.isCheer ? ' (CHEER)' : ''
		if (DEV_MODE) {
			const emotes = parseChatMessage(text, msg.emoteOffsets).filter(
				(part) => part.type === 'emote'
			) as ParsedMessageEmotePart[]
			const emoteList =
				emotes.length > 0
					? ` <EMOTES: ${emotes.map((e) => e.name).join(', ')}>`
					: ''
			timestampLog(
				`${broadcaster}${mod}${user}: ${text}${redemption}${highlight}${cheer}${emoteList}`
			)
		}
	})

	chatClient.onSubGift((channel, user, subInfo, msg) => {
		if (user !== process.env.TWITCH_BOT_USERNAME) return
		const gifter = subInfo.gifterDisplayName || 'anonymous'
		timestampLog(
			`Bot received a gift sub to ${channel} from ${gifter} for ${subInfo.giftDuration} month(s)`
		)
		if (toUserName(channel) !== process.env.TWITCH_STREAMER_USERNAME) return
		// TODO: Change this to twitchBotSubbedUntil, use subInfo.giftDuration
		modifyData({ twitchBotLastSubbed: Date.now() })
		sendChatMessage(
			makeTextGraceTrainSafe(
				`Thank you ${gifter} for the gift sub! <3 ${Emotes.POGGERS} ${Emotes.POGGERS}`
			)
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

	if (botScopes.includes('channel:moderate')) {
		const pubSubClient = new PubSubClient({ authProvider })
		pubSubClient.onModAction(
			getUserByAccountType('bot'),
			getUserByAccountType('streamer'),
			(event) => {
				if (!('action' in event)) return
				if (event.action === 'raid') ChatEvents.emit('raid')
			}
		)
	}
}

export async function sendChatMessage(
	text: string,
	replyTo?: string | ChatMessage
) {
	if (!chatClient) return
	if (CHAT_TEST_MODE) {
		timestampLog(`Sent: ${text}`)
		return
	}
	if (!chatClient.irc.isConnected) {
		timestampLog('Warning: trying to send chat message while IRC not connected')
	}
	try {
		return await chatClient.say(process.env.TWITCH_STREAMER_USERNAME, text, {
			replyTo,
		})
	} catch (e) {
		timestampLog('Error sending chat message', e)
	}
}

function hasRequiredScopes(scopes: string[]) {
	return scopes.includes('chat:read') && scopes.includes('chat:edit')
}

export function botInChat() {
	return chatClient && chatClient.irc.isConnected
}

export function quitChat() {
	if (!botInChat()) {
		timestampLog('Tried to quit chat while not connected')
		return
	}
	timestampLog('Quitting chat')
	chatClient.quit()
}
