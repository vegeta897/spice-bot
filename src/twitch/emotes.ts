import { HelixChannelEmote, type ApiClient, type HelixUser } from '@twurple/api'
import { DEV_MODE } from '../util.js'
import { AccountType, botIsFollowingStreamer, getBotSub } from './twitchApi.js'

let apiClient: ApiClient
let helixUsers: Record<AccountType, HelixUser>
const channelEmotes: HelixChannelEmote[] = []

export const POGGERS = 'ybbaaaPoggers'
export const SOGGERS = 'ybbaaaSoggers'
export const PRAYBEE = 'ybbaaaPrayBee'

export async function initEmotes(options: {
	apiClient: ApiClient
	helixUsers: Record<AccountType, HelixUser>
}) {
	apiClient = options.apiClient
	helixUsers = options.helixUsers
	fetchChannelEmotes()
	setInterval(() => fetchChannelEmotes(), 24 * 60 * 60 * 1000) // Refresh daily
}

async function fetchChannelEmotes() {
	channelEmotes.length = 0
	const streamer = DEV_MODE
		? (await apiClient.users.getUserByName('ybbaaabby'))!
		: helixUsers.streamer
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
