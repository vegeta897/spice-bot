import { HelixChannelEmote, type ApiClient } from '@twurple/api'
import { DEV_MODE, sleep } from '../../util.js'
import { getTwitchToken } from '../streamRecord.js'
import {
	AuthEvents,
	botIsFollowingStreamer,
	getBotSub,
	getUserByAccountType,
} from '../twitchApi.js'
// import { createWriteStream } from 'node:fs'
// import { ReadableStream } from 'node:stream/web'
// import { finished } from 'node:stream/promises'
// import { Readable } from 'node:stream'

let apiClient: ApiClient
const channelEmotes: HelixChannelEmote[] = []

export const Emotes = {
	POGGERS: 'ybbaaaPoggers',
	SOGGERS: 'ybbaaaSoggers',
	PRAYBEE: 'ybbaaaPrayBee',
	RAGE: 'ybbaaaRage',
	SURE: 'ybbaaaSure',
	SCREAM: 'ybbaaaSCREAM',
	THISISFINE: 'ybbaaaThisisfine',
	BANANA: 'ybbaaaBanana',
	DAWG: 'ybbaaaDawg',
}

export async function initEmotes(options: { apiClient: ApiClient }) {
	apiClient = options.apiClient
	fetchChannelEmotes()
	setInterval(() => fetchChannelEmotes(), 12 * 60 * 60 * 1000) // Refresh twice daily
	AuthEvents.on('auth', async (event) => {
		if (event.accountType !== 'streamer') return
		await sleep(1000) // Make sure streamer was added to auth provider
		fetchChannelEmotes()
	})
}

export async function fetchChannelEmotes() {
	if (!getTwitchToken('streamer')) return
	const streamer = DEV_MODE
		? (await apiClient.users.getUserByName('ybbaaabby'))!
		: getUserByAccountType('streamer')
	const freshEmotes = await apiClient.chat.getChannelEmotes(streamer)
	channelEmotes.length = 0
	channelEmotes.push(...freshEmotes)
	// for (const emote of channelEmotes) {
	// 	for (const format of emote.formats) {
	// 		const url = emote.getFormattedImageUrl('3.0', format, 'dark')
	// 		const body = (await fetch(url)).body as ReadableStream<any>
	// 		if (!body) throw `no body in response for ${emote.name} ${format}`
	// 		const fileStream = createWriteStream(
	// 			`./${emote.name}.${format === 'animated' ? 'gif' : 'png'}`
	// 		)
	// 		await finished(Readable.fromWeb(body).pipe(fileStream))
	// 	}
	// }
	// console.log(
	// 	channelEmotes
	// 		.map(
	// 			(emote) =>
	// 				`'${emote.name}.${
	// 					emote.formats.includes('animated') ? 'gif' : 'png'
	// 				}'`
	// 		)
	// 		.join('\n')
	// )
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

export async function canUseEmote(emoteName: string) {
	return getEmoteByName(emoteName, await getUsableEmotes())
}
