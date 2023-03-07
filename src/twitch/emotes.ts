import { HelixChannelEmote, type ApiClient } from '@twurple/api'
import { getTwitchToken } from '../db.js'
import { DEV_MODE, sleep } from '../util.js'
import {
	AuthEvents,
	botIsFollowingStreamer,
	getBotSub,
	getUserByAccountType,
} from './twitchApi.js'

let apiClient: ApiClient
const channelEmotes: HelixChannelEmote[] = []

export const POGGERS = 'ybbaaaPoggers'
export const SOGGERS = 'ybbaaaSoggers'
export const PRAYBEE = 'ybbaaaPrayBee'

export async function initEmotes(options: { apiClient: ApiClient }) {
	apiClient = options.apiClient
	fetchChannelEmotes()
	setInterval(() => fetchChannelEmotes(), 24 * 60 * 60 * 1000) // Refresh daily
	AuthEvents.on('auth', async (event) => {
		if (event.accountType !== 'streamer') return
		await sleep(1000) // Make sure streamer was added to auth provider
		fetchChannelEmotes()
	})
}

export async function fetchChannelEmotes() {
	if (!getTwitchToken('streamer')) return
	channelEmotes.length = 0
	const streamer = DEV_MODE
		? (await apiClient.users.getUserByName('ybbaaabby'))!
		: getUserByAccountType('streamer')
	channelEmotes.push(...(await apiClient.chat.getChannelEmotes(streamer)))
}

export function getEmoteByName(name: string, emotes?: HelixChannelEmote[]) {
	return (emotes || channelEmotes).find((emote) => emote.name === name)
}

export async function getUsableEmotes() {
	const botIsFollowing = await botIsFollowingStreamer()
	const botSub = await getBotSub()
	return channelEmotes.filter(
		(emote) =>
			(botIsFollowing && emote.tier === null) ||
			(botSub && botSub.tier >= (emote.tier || 0))
	)
}
