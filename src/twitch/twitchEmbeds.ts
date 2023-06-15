import { type HelixVideo } from '@twurple/api'
import { EmbedBuilder, type APIEmbedField } from 'discord.js'
import { formatDuration } from '../util.js'
import { StreamRecord } from './streamRecord.js'

const STREAMER_USERNAME = process.env.TWITCH_STREAMER_USERNAME
const TWITCH_URL = `https://www.twitch.tv/${STREAMER_USERNAME}`
const ARCHIVE_URL = `${TWITCH_URL}/videos?filter=archives&sort=time`

export function getStreamStartEmbed(streamRecord: StreamRecord) {
	const embed = new EmbedBuilder()
		.setTitle(`${process.env.NICKNAME || STREAMER_USERNAME} is live!`)
		.setURL(TWITCH_URL)
		.setColor(0xe735c1)
		.setTimestamp(streamRecord.startTime)
	const fields: APIEmbedField[] = [
		{
			name: 'Watch',
			value: `[twitch.tv/${STREAMER_USERNAME}](${TWITCH_URL})`,
			inline: true,
		},
		{
			name: 'Started',
			value: `<t:${Math.round(streamRecord.startTime / 1000)}:R>`,
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
	streamRecord: StreamRecord,
	video?: HelixVideo
) {
	const embed = new EmbedBuilder()
	embed
		.setTitle('Stream ended')
		.setURL(video?.url || ARCHIVE_URL)
		.setColor(0x944783)
		.setTimestamp(Date.now())
	const fields: APIEmbedField[] = [
		{
			name: 'Playing',
			value: streamRecord.games.join('\n'),
		},
		{
			name: 'Watch',
			value: `[Archive](${video?.url || ARCHIVE_URL})`,
			inline: true,
		},
	]
	if (video?.durationInSeconds)
		fields.push({
			name: 'Duration',
			value: formatDuration(video.durationInSeconds),
			inline: true,
		})
	embed.addFields(fields)
	const title = video?.title || streamRecord.title
	if (title) embed.setDescription(title)
	if (streamRecord.thumbnailURL) embed.setThumbnail(streamRecord.thumbnailURL)
	if (video?.creationDate) embed.setTimestamp(video.creationDate.getTime())
	return embed
}
