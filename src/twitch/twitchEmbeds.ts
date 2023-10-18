import { type HelixVideo } from '@twurple/api'
import { EmbedBuilder, type APIEmbedField } from 'discord.js'
import { formatDuration } from '../util.js'
import {
	ParentStreamRecord,
	StreamRecord,
	getChildStreams,
	getStreamRecord,
} from './streamRecord.js'

const STREAMER_USERNAME = process.env.TWITCH_STREAMER_USERNAME
const TWITCH_URL = `https://www.twitch.tv/${STREAMER_USERNAME}`
const ARCHIVE_URL = `${TWITCH_URL}/videos?filter=archives&sort=time`

export function getStreamStartEmbed(streamRecord: StreamRecord) {
	const parentStream =
		'parentStreamID' in streamRecord &&
		getStreamRecord(streamRecord.parentStreamID)
	const startTime = parentStream
		? parentStream.startTime
		: streamRecord.startTime
	const embed = new EmbedBuilder()
		.setTitle(`${process.env.NICKNAME || STREAMER_USERNAME} is live!`)
		.setURL(TWITCH_URL)
		.setColor(0xe735c1)
	// .setTimestamp(startTime)
	const fields: APIEmbedField[] = [
		{
			name: 'Watch',
			value: `[twitch.tv/${STREAMER_USERNAME}](${TWITCH_URL})`,
			inline: true,
		},
		{
			name: 'Started',
			value: `<t:${Math.round(startTime / 1000)}:R>`,
			inline: true,
		},
	]
	if (streamRecord.title) embed.setDescription(streamRecord.title)
	if (streamRecord.thumbnailURL) {
		const thumbnailURL =
			streamRecord.thumbnailURL +
			(streamRecord.thumbnailIndex ? `?${streamRecord.thumbnailIndex}` : '')
		embed.setThumbnail(thumbnailURL)
	}
	const games = getAllGames(parentStream || streamRecord)
	if (games.length > 0) {
		fields.unshift({ name: 'Playing', value: games.join('\n') })
	}
	if (process.env.TWITCH_BANNER_URL) {
		embed.setImage(process.env.TWITCH_BANNER_URL)
	}
	embed.addFields(fields)
	return embed
}

export function getStreamEndEmbed(
	streamRecord: StreamRecord,
	video: HelixVideo
) {
	const parentStream =
		'parentStreamID' in streamRecord &&
		getStreamRecord(streamRecord.parentStreamID)
	const embed = new EmbedBuilder()
	embed
		.setTitle('Stream ended')
		.setURL((parentStream || streamRecord).videoURL || ARCHIVE_URL)
		.setColor(0x944783)
	// .setTimestamp(video.creationDate.getTime())
	const games = getAllGames(parentStream || streamRecord)
	const archiveURLs = getAllArchiveURLs(parentStream || streamRecord)
	const fields: APIEmbedField[] = [
		{ name: 'Playing', value: games.join('\n') },
		{
			name: 'Watch',
			value:
				archiveURLs.length === 1
					? `[Archive](${archiveURLs[0]})`
					: archiveURLs.map((u, i) => `[Part ${i + 1}](${u})`).join('\n'),
			inline: true,
		},
	]
	fields.push({
		name: archiveURLs.length > 1 ? 'Total Duration' : 'Duration',
		value: formatDuration(getTotalDuration(parentStream || streamRecord)),
		inline: true,
	})
	embed.addFields(fields)
	embed.setDescription((parentStream || streamRecord).title || video.title)
	const thumbnailURL = (parentStream || streamRecord).thumbnailURL
	if (thumbnailURL) embed.setThumbnail(thumbnailURL)
	return embed
}

function getAllGames(streamRecord: ParentStreamRecord) {
	const games = [...streamRecord.games]
	for (const childStream of getChildStreams(streamRecord.streamID)) {
		for (const game of childStream.games) {
			if (!games.includes(game)) games.push(game)
		}
	}
	return games
}

function getAllArchiveURLs(streamRecord: ParentStreamRecord) {
	if (!streamRecord.videoURL) return [ARCHIVE_URL]
	const childArchiveURLs = getChildStreams(streamRecord.streamID)
		.map((cs) => cs.videoURL)
		.filter((v) => v) as string[]
	return [streamRecord.videoURL, ...childArchiveURLs]
}

function getTotalDuration(streamRecord: ParentStreamRecord) {
	let duration = streamRecord.endTime! - streamRecord.startTime
	for (const childStream of getChildStreams(streamRecord.streamID)) {
		if (!childStream.endTime) continue
		duration += childStream.endTime - childStream.startTime
	}
	return duration
}
