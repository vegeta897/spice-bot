import { type HelixVideo } from '@twurple/api'
import { EmbedBuilder, type APIEmbedField } from 'discord.js'
import { type StreamRecord } from './db.js'
import { formatDuration } from './util.js'

const TWITCH_USERNAME = process.env.TWITCH_USERNAME
const TWITCH_URL = `https://www.twitch.tv/${TWITCH_USERNAME}`

export function getStreamStartEmbed(streamRecord: StreamRecord) {
	const embed = new EmbedBuilder()
		.setTitle(`${process.env.NICKNAME || TWITCH_USERNAME} is live!`)
		.setURL(TWITCH_URL)
		.setColor(0xe735c1)
		.setTimestamp(streamRecord.startTime)
	const fields: APIEmbedField[] = [
		{
			name: 'Watch',
			value: `[twitch.tv/${TWITCH_USERNAME}](${TWITCH_URL})`,
			inline: true,
		},
		{
			name: 'Started',
			value: `<t:${Math.round(streamRecord.startTime / 1000)}:R>`,
			inline: true,
		},
	]
	if (streamRecord.title) embed.setDescription(streamRecord.title)
	if (streamRecord.thumbnailURL) embed.setThumbnail(streamRecord.thumbnailURL)
	if (streamRecord.games.length > 0) {
		fields.unshift({ name: 'Playing', value: streamRecord.games.join('\n') })
	}
	if (process.env.TWITCH_BANNER_URL) {
		embed.setImage(process.env.TWITCH_BANNER_URL)
	}
	embed.addFields(fields)
	return embed
}

export function getStreamEndEmbed(
	video: HelixVideo,
	streamRecord: StreamRecord
) {
	const embed = new EmbedBuilder()
	embed
		.setTitle('Stream ended')
		.setURL(video.url)
		.setColor(0x944783)
		.setThumbnail(video.getThumbnailUrl(320, 180))
		.setDescription(video.title)
		.setTimestamp(
			video.creationDate.getTime() + video!.durationInSeconds * 1000
		)
		.addFields([
			{
				name: 'Playing',
				value: streamRecord.games.join('\n'),
			},
			{
				name: 'Watch',
				value: `[Archive](${video.url})`,
				inline: true,
			},
			{
				name: 'Duration',
				value: formatDuration(video.durationInSeconds),
				inline: true,
			},
		])
	return embed
}
