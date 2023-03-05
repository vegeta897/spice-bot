import { type HelixUser } from '@twurple/api'
import { type RefreshingAuthProvider } from '@twurple/auth'
import { ChatClient, toUserName, PrivateMessage } from '@twurple/chat'
import { ParsedMessageEmotePart } from '@twurple/common'
import { AuthEvents, getUserScopes } from './twitchApi.js'
import { timestampLog } from '../util.js'
import Emittery from 'emittery'
import { initGrace } from './grace.js'

// Idea: stream recap when !recap command used, or raid initialized
//       maybe include emote usage, pogger/sogger ratio
// Idea: !tally counts results of impromptu chat polls (e.g. say 1 or 2 in chat)
//       maybe send amended messages if people vote after command is used
// Use emotes if given a gift subscription (and thank the gifter!)

export const ChatEvents = new Emittery<{
	message: {
		username: string
		text: string
		date: Date
		msg: PrivateMessage
	}
	redemption: {
		username: string
		title: string
		date: Date
		status: string
		rewardText: string
	}
}>()

// Emotes
export const POGGERS = 'ybbaaaPoggers'
export const SOGGERS = 'ybbaaaSoggers'
export const PRAYBEE = 'ybbaaaPrayBee'

let chatClient: ChatClient

export async function initTwitchChat(
	authProvider: RefreshingAuthProvider,
	botUser: HelixUser
) {
	initChatClient(authProvider, botUser)
	initGrace()
	AuthEvents.on('auth', async ({ accountType }) => {
		if (accountType === 'bot') initChatClient(authProvider, botUser)
	})
	AuthEvents.on('authRevoke', ({ accountType }) => {
		if (accountType === 'bot') chatClient.quit()
	})
}

async function initChatClient(
	authProvider: RefreshingAuthProvider,
	botUser: HelixUser
) {
	if (chatClient) chatClient.quit()
	const botScopes = await getUserScopes(botUser)
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
		// console.log(channel, user, text)
		if (toUserName(channel) !== process.env.TWITCH_STREAMER_USERNAME) return
		if (user === process.env.TWITCH_BOT_USERNAME) return
		const broadcaster = msg.userInfo.isBroadcaster ? '[STREAMER] ' : ''
		const mod = msg.userInfo.isMod ? '[MOD] ' : ''
		ChatEvents.emit('message', { username: user, text, date: msg.date, msg })
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
		// if (text === '!ping') chatClient.say(channel, 'pong!')
	})

	chatClient.onSubGift((channel, user, subInfo, msg) => {
		if (toUserName(channel) !== process.env.TWITCH_STREAMER_USERNAME) return
		if (user !== process.env.TWITCH_BOT_USERNAME) return
		const gifter = subInfo.gifterDisplayName || 'anonymous'
		timestampLog(`Bot received a gift sub from ${gifter}`)
		chatClient.say(
			channel,
			`Thank you ${gifter} for the gift sub! ${POGGERS} ${POGGERS}`
		)
	})

	chatClient.onWhisper((user, text, msg) => {
		// Need to use apiClient.whispers.sendWhisper() to reply
	})
}

export function sendChatMessage(text: string) {
	if (!chatClient) return
	chatClient.say(process.env.TWITCH_STREAMER_USERNAME, text)
}

function hasRequiredScopes(scopes: string[]) {
	return scopes.includes('chat:read') && scopes.includes('chat:edit')
}

export function botInChat() {
	return chatClient && chatClient.irc.isConnected
}
