import { ChatClient } from '@twurple/chat'
import { getTwitchUserAuth } from './twitchAuth.js'

// Idea: stream recap when !recap command used, or raid initialized
//       maybe include points redeemed, emote usage, pogger/sogger ratio
// Idea: grace train tracker
// Idea: !tally counts results of impromptu chat polls (e.g. say 1 or 2 in chat)
//       maybe send amended messages if people vote after command is used
// Use emotes if given a gift subscription

export async function initTwitchChat() {
	const authProvider = await getTwitchUserAuth()
	const chatClient = new ChatClient({
		authProvider,
		channels: [process.env.TWITCH_USERNAME],
	})
	await chatClient.connect()

	chatClient.onMessage((channel, user, text, msg) => {
		console.log(channel, user, text)
		console.log(
			'mod:',
			msg.userInfo.isMod,
			'broadcaster:',
			msg.userInfo.isBroadcaster
		)
		console.log(msg.parseEmotes())
		if (text === '!ping') chatClient.say(channel, 'pong!')
	})
}
