import {
	Client,
	Events,
	GatewayIntentBits,
	type TextChannel,
	type Guild,
	type MessageCreateOptions,
	type MessageEditOptions,
} from 'discord.js'
import { initPings } from './pings.js'
import { timestampLog } from './logger.js'

let server: Guild
let twitchChannel: TextChannel
let twitterChannel: TextChannel

const bot = new Client({ intents: [GatewayIntentBits.Guilds] })

export function connectBot() {
	return new Promise<void>((resolve) => {
		bot.once(Events.ClientReady, async () => {
			console.log('Discord connected')
			server = await bot.guilds.fetch(process.env.DISCORD_SERVER_ID)
			console.log(`Found server "${server.name}"`)
			twitchChannel = (await getChannel(
				process.env.DISCORD_TWITCH_CHANNEL_ID
			)) as TextChannel
			console.log(`Found twitch channel #${twitchChannel.name}`)
			if (process.env.DISCORD_TWITTER_CHANNEL_ID !== '') {
				twitterChannel = (await getChannel(
					process.env.DISCORD_TWITTER_CHANNEL_ID
				)) as TextChannel
				console.log(`Found twitter channel #${twitterChannel.name}`)
			}
			await initPings(bot, server)
			resolve()
		})
		bot.on('error', timestampLog)
		bot.login(process.env.DISCORD_BOT_TOKEN)
	})
}

export function createStreamMessage(messageOptions: MessageCreateOptions) {
	return twitchChannel.send(messageOptions)
}

export function createTweetMessage(messageOptions: MessageCreateOptions) {
	return twitterChannel.send(messageOptions)
}

async function editMessage(
	channel: TextChannel,
	messageID: string,
	messageOptions: MessageEditOptions
) {
	try {
		const message = await channel.messages.fetch(messageID)
		return message.edit(messageOptions)
	} catch (e) {
		console.log('Failed to edit message', e)
	}
}

export const editStreamMessage = async (
	messageID: string,
	messageOptions: MessageEditOptions
) => editMessage(twitchChannel, messageID, messageOptions)
export const editTweetMessage = async (
	messageID: string,
	messageOptions: MessageEditOptions
) => editMessage(twitterChannel, messageID, messageOptions)

async function deleteMessage(channel: TextChannel, messageID: string) {
	try {
		await channel.messages.delete(messageID)
	} catch (e) {
		console.log('Failed to delete message', e)
	}
}

export const deleteStreamMessage = (messageID: string) =>
	deleteMessage(twitchChannel, messageID)
export const deleteTweetMessage = (messageID: string) =>
	deleteMessage(twitterChannel, messageID)

async function getChannel(id: string) {
	const channel = await server.channels.fetch(id)
	if (!channel) throw `Unknown Discord channel ID ${id}`
	return channel as TextChannel
}
