import {
	type ApiClient,
	type HelixUser,
	type HelixStream,
	type HelixVideo,
} from '@twurple/api'
import { type BaseMessageOptions } from 'discord.js'
import { getMockStream, getMockVideos } from './mockStreams.js'
import {
	createStreamMessage,
	deleteStreamMessage,
	editStreamMessage,
} from '../discord.js'
import { getTwitchPingButtons, getTwitchPingRole } from '../pings.js'
import { DEV_MODE, sleep } from '../util.js'
import { spiceLog, timestampLog } from '../logger.js'
import { getStreamEndEmbed, getStreamStartEmbed } from './twitchEmbeds.js'
import { getUserByAccountType } from './twitchApi.js'
import {
	getStreamRecords,
	createStreamRecord,
	StreamRecord,
	updateStreamRecord,
	getStreamRecord,
	ParentStreamRecord,
	ChildStreamRecord,
	getChildStreams,
} from './streamRecord.js'
import Emittery from 'emittery'

export const StreamEvents = new Emittery<{
	streamOnline: { id: String; downtime: number }
	streamOffline: undefined
}>()

const processingStreamOnlineEvents: Set<string> = new Set()

let apiClient: ApiClient
let streamerUser: HelixUser

export function initStreams(params: { apiClient: ApiClient }) {
	apiClient = params.apiClient
	streamerUser = getUserByAccountType('streamer')
	if (!DEV_MODE) {
		checkStreamAndVideos()
	}
	cleanPingButtons()
	const streamCheckInterval = DEV_MODE ? 15 * 1000 : 5 * 60 * 1000
	setInterval(() => checkStreamAndVideos(), streamCheckInterval)
}

// Minimum time between streams to be considered a new stream
const minDowntime = DEV_MODE ? 10 * 1000 : 20 * 60 * 1000

export async function onNewStream(
	streamID: string,
	streamInfo: HelixStream | null = null
) {
	timestampLog(
		`${
			process.env.NICKNAME || process.env.TWITCH_STREAMER_USERNAME
		} just went live! (${streamID})`
	)
	if (getStreamRecord(streamID)) {
		spiceLog(`Stream ID ${streamID} already recorded`)
		return
	}
	let linkedStreamRecord: StreamRecord | null = null
	let downtime = Infinity
	const previousStreamRecord = getStreamRecords().at(-1)
	// Iterate previous streams newest to oldest
	if (previousStreamRecord) {
		if (previousStreamRecord.streamStatus === 'live') {
			linkedStreamRecord = previousStreamRecord
			downtime = 0
		} else {
			downtime = Date.now() - previousStreamRecord.endTime!
			if (downtime < minDowntime) linkedStreamRecord = previousStreamRecord
		}
	}
	let parentStreamID: string | undefined = undefined
	if (linkedStreamRecord) {
		parentStreamID =
			'parentStreamID' in linkedStreamRecord
				? linkedStreamRecord.parentStreamID
				: linkedStreamRecord.streamID
		spiceLog('Stream restart detected')
	}
	processingStreamOnlineEvents.add(streamID)
	const streamRecord = createStreamRecord(streamID, parentStreamID)
	StreamEvents.emit('streamOnline', { id: streamID, downtime })
	let getStreamAttempts = 0
	let messageID: string | null = null
	// Stream info may be null at first
	while (!streamInfo) {
		streamInfo = DEV_MODE ? getMockStream() : await streamerUser.getStream()
		if (!streamInfo) {
			getStreamAttempts++
			if (getStreamAttempts === 2) {
				// After 2 attempts, post a message without stream info
				spiceLog('Posting stream message without full info')
				messageID = await sendOrUpdateLiveMessage(streamRecord)
			}
			if (getStreamAttempts === 60) {
				// Give up after 5 minutes of no stream info
				timestampLog(`Gave up trying to get stream info for ID ${streamID}`)
				processingStreamOnlineEvents.delete(streamID)
				return
			}
			await sleep(5000)
		}
	}
	timestampLog('Got stream info, posting/updating message')
	processingStreamOnlineEvents.delete(streamID)
	streamRecord.title = streamInfo.title
	streamRecord.streamInfo = true
	streamRecord.startTime = streamInfo.startDate.getTime()
	streamRecord.games.push(streamInfo.gameName)
	if (!('parentStreamID' in streamRecord) && messageID)
		streamRecord.messageID = messageID
	streamRecord.thumbnailURL = streamInfo.getThumbnailUrl(360, 180)
	updateStreamRecord(streamRecord)
	checkVideos(streamInfo) // To end other streams
	sendOrUpdateLiveMessage(streamRecord)
}

export function onStreamOffline() {
	timestampLog(`${process.env.TWITCH_STREAMER_USERNAME} just went offline`)
	checkVideos()
}

async function checkStreamAndVideos() {
	try {
		const stream = DEV_MODE ? getMockStream() : await streamerUser.getStream()
		if (stream) checkStream(stream)
		checkVideos(stream)
	} catch (e) {
		timestampLog('Error checking stream/videos', e)
	}
}

function checkStream(stream: HelixStream) {
	if (processingStreamOnlineEvents.has(stream.id)) {
		// The live event for this stream was received and is still processing
		return
	}
	const existingRecord = getStreamRecord(stream.id)
	if (existingRecord) {
		// Update thumbnail index and check for other updated info
		if (stream.title !== existingRecord.title)
			timestampLog('Title changed to:', stream.title)
		const newGame = !existingRecord.games.includes(stream.gameName)
		if (newGame) timestampLog('New game:', stream.gameName)
		const updatedRecord = updateStreamRecord(
			{
				streamID: stream.id,
				streamStatus: 'live',
				streamInfo: true,
				startTime: stream.startDate.getTime(),
				title: stream.title,
				thumbnailURL: stream.getThumbnailUrl(360, 180),
				thumbnailIndex: (existingRecord.thumbnailIndex || 0) + 1,
				games: newGame
					? [...existingRecord.games, stream.gameName]
					: existingRecord.games,
			} as StreamRecord,
			['endTime']
		)
		sendOrUpdateLiveMessage(updatedRecord)
	} else {
		// Start of stream was missed
		timestampLog(`Start event missed for stream ID ${stream.id}`)
		onNewStream(stream.id, stream)
	}
}

async function checkVideos(stream: HelixStream | null = null) {
	const { data: videos } = DEV_MODE
		? getMockVideos()
		: await apiClient.videos.getVideosByUser(streamerUser.id, {
				limit: 4, // A safe buffer
				type: 'archive',
		  })
	if (videos.length === 0) return
	const oldestToNewest = videos.reverse()
	for (const video of oldestToNewest) {
		const streamRecord = video.streamId && getStreamRecord(video.streamId)
		if (!streamRecord) continue // No record, skip it
		// Update ended streams that have no video info or a 404 thumbnail
		const videoThumbnail = video.getThumbnailUrl(360, 180)
		if (
			'messageID' in streamRecord &&
			streamRecord.streamStatus === 'ended' &&
			streamRecord.messageID &&
			(!streamRecord.videoURL ||
				(streamRecord.thumbnailURL?.includes('twitch.tv/_404/') &&
					!videoThumbnail.includes('twitch.tv/_404/')))
		) {
			const updatedRecord = updateStreamRecord({
				streamID: streamRecord.streamID,
				thumbnailURL: videoThumbnail,
				videoURL: video.url,
			})
			const noLiveChildStreams = !getChildStreams(streamRecord.streamID).some(
				(cs) => cs.streamStatus === 'live'
			)
			if (noLiveChildStreams) {
				editStreamMessage(streamRecord.messageID, {
					embeds: [getStreamEndEmbed(updatedRecord, video)],
				})
			}
		}
		// Normal stream ending flow
		if (
			streamRecord.streamStatus === 'live' && // Marked as live
			streamRecord.streamID !== stream?.id && // Not still going
			!processingStreamOnlineEvents.has(streamRecord.streamID) // Not currently processing
		) {
			// End this stream
			timestampLog(`Ending stream ID ${video!.streamId}`)
			await endStream(streamRecord, video)
		}
	}
	// Force end any stale "live" stream records with no video
	const staleStreamRecords = getStreamRecords().filter(
		(sr) =>
			sr.streamStatus === 'live' && // Marked as live
			sr.streamID !== stream?.id && // Not still going
			!processingStreamOnlineEvents.has(sr.streamID) && // Not currently processing
			sr.startTime < Date.now() - 5 * 60 * 1000 && // Older than 5 minutes
			sr.streamID < videos[0].streamId! // Older than the newest video
	)
	for (const staleStreamRecord of staleStreamRecords) {
		timestampLog(
			`Force ending stale stream ID ${staleStreamRecord.streamID} marked as "live"`
		)
		const endedRecord = {
			streamID: staleStreamRecord.streamID,
			streamStatus: 'ended',
		}
		if ('messageID' in staleStreamRecord) {
			if (staleStreamRecord.messageID) {
				deleteStreamMessage(staleStreamRecord.messageID)
				checkStreamPingButtons() // Add ping buttons back to previous message
			}
			updateStreamRecord(endedRecord as ParentStreamRecord, ['messageID'])
		} else {
			updateStreamRecord(endedRecord as ChildStreamRecord)
		}
	}
}

async function sendOrUpdateLiveMessage(streamRecord: StreamRecord) {
	const messageOptions: BaseMessageOptions = {
		embeds: [getStreamStartEmbed(streamRecord)],
	}
	if ('parentStreamID' in streamRecord) {
		const parentStreamRecord = getStreamRecord(
			streamRecord.parentStreamID
		) as ParentStreamRecord
		// TODO: Wait for parent stream to be posted?
		if (parentStreamRecord) {
			await editStreamMessage(parentStreamRecord.messageID!, messageOptions)
		}
		return null
	}
	if (streamRecord.messageID) {
		await editStreamMessage(streamRecord.messageID, messageOptions)
		return streamRecord.messageID
	}
	// Create new message
	const twitchPingRole = getTwitchPingRole()
	if (twitchPingRole) {
		messageOptions.content = twitchPingRole.toString()
		messageOptions.components = getTwitchPingButtons()
		streamRecord.pingButtons = 'posted'
	}
	const message = await createStreamMessage(messageOptions)
	updateStreamRecord({
		...streamRecord,
		messageID: message.id,
	})
	cleanPingButtons()
	return message.id
}

async function endStream(streamRecord: StreamRecord, video: HelixVideo) {
	const updatedRecord = updateStreamRecord({
		...streamRecord,
		streamStatus: 'ended',
		videoURL: video.url,
		thumbnailURL: video.getThumbnailUrl(360, 180),
		endTime: streamRecord.startTime + video.durationInSeconds * 1000,
	}) as StreamRecord
	const messageOptions: BaseMessageOptions = {
		content: '', // Remove ping text
		embeds: [getStreamEndEmbed(updatedRecord, video)],
	}
	let messageRecord: ParentStreamRecord
	if ('parentStreamID' in updatedRecord) {
		const parentStreamRecord = getStreamRecord(
			updatedRecord.parentStreamID
		) as ParentStreamRecord
		if (!parentStreamRecord) return
		messageRecord = parentStreamRecord
	} else {
		if (getTwitchPingRole()) {
			messageOptions.components = getTwitchPingButtons()
			updatedRecord.pingButtons = 'posted'
			updateStreamRecord(updatedRecord)
		}
		messageRecord = updatedRecord
	}
	if (messageRecord.messageID)
		editStreamMessage(messageRecord.messageID, messageOptions)
}

function cleanPingButtons() {
	const buttonRecords = getStreamRecords().filter(
		(sr) => 'messageID' in sr && sr.pingButtons === 'posted' && sr.messageID
	) as ParentStreamRecord[]
	const latestParentStreamRecord = buttonRecords.at(-1)
	for (const buttonRecord of buttonRecords) {
		if (buttonRecord === latestParentStreamRecord) continue
		editStreamMessage(buttonRecord.messageID!, { components: [] })
		updateStreamRecord({
			streamID: buttonRecord.streamID,
			pingButtons: 'cleaned',
		})
	}
}

// Add ping buttons to last stream message if latest was deleted
export async function checkStreamPingButtons() {
	if (!getTwitchPingRole()) return
	const postedRecords = getStreamRecords().filter(
		(sr) => 'messageID' in sr && sr.messageID
	) as ParentStreamRecord[]
	const lastPostedRecord = postedRecords.at(-1)
	if (!lastPostedRecord || lastPostedRecord.pingButtons === 'posted') return
	editStreamMessage(lastPostedRecord.messageID!, {
		components: getTwitchPingButtons(),
	})
	updateStreamRecord({
		streamID: lastPostedRecord.streamID,
		pingButtons: 'posted',
	})
}
