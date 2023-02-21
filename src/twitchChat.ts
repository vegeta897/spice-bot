import { ChatClient } from '@twurple/chat'
import { ParsedMessageEmotePart } from '@twurple/common'
import { getTwitchBotAuthProvider } from './twitchAuth.js'

// Idea: stream recap when !recap command used, or raid initialized
//       maybe include emote usage, pogger/sogger ratio
// Idea: grace train tracker
//       redemptions without messages do not show up in chat, need to use eventsub
//       use event timestamp and message timestamp to ensure chain timing?
// Idea: !tally counts results of impromptu chat polls (e.g. say 1 or 2 in chat)
//       maybe send amended messages if people vote after command is used
// Use emotes if given a gift subscription (and thank the gifter!)

export async function initTwitchChat() {
	const authProvider = await getTwitchBotAuthProvider()
	const chatClient = new ChatClient({
		authProvider,
		channels: [process.env.TWITCH_USERNAME],
	})
	await chatClient.connect()

	chatClient.onMessage((channel, user, text, msg) => {
		// console.log(channel, user, text)
		// console.log(
		// 	'mod:',
		// 	msg.userInfo.isMod,
		// 	'broadcaster:',
		// 	msg.userInfo.isBroadcaster,
		// 	'redemption:',
		// 	msg.isRedemption
		// )
		// console.log(msg.parseEmotes())
		const mod = msg.userInfo.isMod ? '[MOD] ' : ''
		const redemption = msg.isRedemption ? ' (REDEEM)' : ''
		const emotes = msg
			.parseEmotes()
			.filter((part) => part.type === 'emote') as ParsedMessageEmotePart[]
		const emoteList =
			emotes.length > 0
				? ` <EMOTES: ${emotes.map((e) => e.name).join(', ')}>`
				: ''
		console.log(`${mod}${user}: ${text}${redemption}${emoteList}`)
		// if (text === '!ping') chatClient.say(channel, 'pong!')
	})

	chatClient.onWhisper((user, text, msg) => {
		// Need to use apiClient.whispers.sendWhisper() to reply
	})
}
