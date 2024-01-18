import { type ChatMessage } from '@twurple/chat'
import { StreamEvents } from '../streams.js'
import { getBotSub } from '../twitchApi.js'
import { Emotes } from './emotes.js'
import { makeTextGraceTrainSafe } from '../trains/grace.js'
import { ChatEvents, sendChatMessage } from './twitchChat.js'

export function initWhereBot() {
	ChatEvents.on('message', (event) => {
		if (event.self) return
		if (/where('?|( i))s?( (our|that|dat))? spice[ -]?bot/gi.test(event.text)) {
			handleWhereBotPrompt(event.msg)
			return
		}
	})
	StreamEvents.on('streamOnline', ({ downtime }) => {
		if (downtime > 5 * 60 * 1000) reset()
	})
}

async function handleWhereBotPrompt(msg: ChatMessage) {
	const now = Date.now()
	if (now - lastWhereBotReplyTime < COOLDOWN) return // Too soon
	lastWhereBotReplyTime = now
	if (
		now - lastWhereBotReplyTime > RESET_TIME &&
		whereBotNextReplyIndex < whereBotReplies.length
	) {
		whereBotNextReplyIndex = 0
	}
	const reply = whereBotReplies[whereBotNextReplyIndex]
	if (!reply) return // No more replies to give
	whereBotNextReplyIndex++
	if (typeof reply === 'string') {
		sendChatMessage(await makeTextGraceTrainSafe(reply))
		return
	}
	const sendMessageArgs: Parameters<typeof sendChatMessage> = [
		await makeTextGraceTrainSafe(reply.text),
	]
	if (reply.emotes) {
		const botSub = await getBotSub()
		for (const [find, replace] of reply.emotes) {
			sendMessageArgs[0] = sendMessageArgs[0].replace(
				new RegExp(find),
				(botSub && replace) || ''
			)
		}
	}
	if (reply.reply) sendMessageArgs[1] = msg.id
	sendChatMessage(...sendMessageArgs)
}

const whereBotReplies: (
	| string
	| { text: string; emotes?: [string, string][]; reply?: boolean }
)[] = [
	{ text: "I'm right here!", reply: true },
	{ text: "I told you, I'm right here!", reply: true },
	{
		text: "Hello?! :hello: I'm right here!!!",
		emotes: [[':hello:', Emotes.BANANA]],
		reply: true,
	},
	{ text: "Okay, you're messing with me.", reply: true },
	{
		text: 'How can you bully a poor lil bot like this? :fine:',
		emotes: [[':fine:', Emotes.THISISFINE]],
		reply: true,
	},
	{
		text: 'Abby, make them stop! :rage:',
		emotes: [[':rage:', Emotes.RAGE]],
	},
	'Mods? Hello? A little help here?',
	{
		text: 'This is just spam, and I will not participate! :sure:',
		emotes: [[':sure:', Emotes.SURE]],
	},
	{
		text: "I'm a good bot. I'm a good bot. I will not spam. I'm a good bot. :dawg:",
		emotes: [[':dawg:', Emotes.DAWG]],
	},
	{
		text: 'AAAAAHHHHHHHHHHHHHH :scream:',
		emotes: [[':scream:', Emotes.SCREAM]],
	},
	'/me is gone', // This works without ChatClient.action()
]

let lastWhereBotReplyTime = 0
const COOLDOWN = 3 * 1000
const RESET_TIME = 5 * 60 * 1000
let whereBotNextReplyIndex = 0
function reset() {
	whereBotNextReplyIndex = 0
}
