import {
	type ApiClient,
	type HelixUser,
	type HelixStream,
	type HelixVideo,
} from '@twurple/api'
import { type MessageCreateOptions } from 'discord.js'
import { modifyData } from '../db.js'
import {
	getMockInitialVideos,
	getMockStream,
	getMockVideosAfterStream,
} from '../dev.js'
import {
	createStreamMessage,
	deleteStreamMessage,
	editStreamMessage,
} from '../discord.js'
import { getTwitchPingButtons, getTwitchPingRole } from '../pings.js'
import { DEV_MODE, sleep, timestampLog } from '../util.js'
import { getStreamEndEmbed, getStreamStartEmbed } from './twitchEmbeds.js'
import { TwitchEvents } from './eventSub.js'
import { getUserByAccountType } from './twitchApi.js'
import {
	getStreamRecords,
	recordStream,
	StreamRecord,
	updateStreamRecord,
} from './streamRecord.js'

const processingStreamOnlineEvents: Set<string> = new Set()

let apiClient: ApiClient
let streamerUser: HelixUser

export function initStreams(params: { apiClient: ApiClient }) {
	apiClient = params.apiClient
	streamerUser = getUserByAccountType('streamer')

	TwitchEvents.on('streamOnline', async (event) => {
		timestampLog(`${event.displayName} just went live!`)
		if (getStreamRecords().find((sr) => sr.streamID === event.id)) {
			console.log(`Stream record ID ${event.id} already exists`)
			return
		}
		processingStreamOnlineEvents.add(event.id)
		const streamRecord = recordStream({
			streamID: event.id,
			streamStatus: 'live',
			streamInfo: false,
		})
		let getStreamAttempts = 0
		let streamInfo: HelixStream | null = null
		let messageID: string | undefined
		// Stream info may be null at first
		do {
			if (!processingStreamOnlineEvents.has(event.id)) {
				// Processing was ended elsewhere
				return
			}
			streamInfo = (await streamerUser.getStream()) as HelixStream | null
			if (!streamInfo) {
				getStreamAttempts++
				if (getStreamAttempts === 2) {
					// After 2 attempts, post a message without stream info
					console.log('Posting stream message without full info')
					messageID = await sendOrUpdateLiveMessage(streamRecord)
				}
				if (getStreamAttempts === 60) {
					// Give up after 5 minutes of no stream info
					timestampLog(`Gave up trying to get stream info for ID ${event.id}`)
					processingStreamOnlineEvents.delete(event.id)
					return
				}
				await sleep(5000)
			}
		} while (!streamInfo)
		timestampLog('Got stream info, posting/updating message')
		processingStreamOnlineEvents.delete(event.id)
		streamRecord.streamInfo = true
		streamRecord.startTime = streamInfo.startDate.getTime()
		streamRecord.title = streamInfo.title
		streamRecord.games.push(streamInfo.gameName)
		streamRecord.thumbnailURL = streamInfo.getThumbnailUrl(360, 180)
		if (messageID) streamRecord.messageID = messageID
		sendOrUpdateLiveMessage(streamRecord)
	})

	TwitchEvents.on('streamOffline', (event) => {
		timestampLog(`${event.displayName} just went offline`)
		// It's so annoying that the stream ID isn't part of this event 😤
		checkVideos()
	})
	if (!DEV_MODE) {
		checkStreamAndVideos()
		// Check for stream/video updates every 5 minutes
		setInterval(() => checkStreamAndVideos(), 5 * 60 * 1000)
	} else {
		modifyData({
			streams: getStreamRecords().filter((s) => s.streamID !== 'test'),
		})
	}
}

async function checkStreamAndVideos() {
	const stream = DEV_MODE ? getMockStream() : await streamerUser.getStream()
	handleStream(stream)
	checkVideos(stream)
}

function handleStream(stream: HelixStream | null) {
	if (!stream) return
	if (processingStreamOnlineEvents.has(stream.id)) {
		// The live event for this stream was received and is still processing
		return
	}
	const streamRecords = getStreamRecords()
	const existingRecord = streamRecords.find((s) => s.streamID === stream.id)
	if (existingRecord) {
		// Update thumbnail index and check for other updated info
		if (stream.title !== existingRecord.title)
			timestampLog('Title changed to:', stream.title)
		const gameChanged = !existingRecord.games.includes(stream.gameName)
		if (gameChanged) timestampLog('Game changed to:', stream.gameName)
		const nextThumbnailIndex = (existingRecord.thumbnailIndex || 0) + 1
		const updatedRecord = updateStreamRecord({
			streamID: stream.id,
			streamInfo: true,
			startTime: stream.startDate.getTime(),
			title: stream.title,
			thumbnailURL: stream.getThumbnailUrl(360, 180),
			thumbnailIndex: nextThumbnailIndex,
			games: gameChanged
				? [...existingRecord.games, stream.gameName]
				: existingRecord.games,
		})
		sendOrUpdateLiveMessage(updatedRecord)
	} else {
		// Start of stream was missed
		timestampLog(
			`Stream start event was missed, posting stream ID ${stream.id}`
		)
		const newStreamRecord = recordStream({
			streamID: stream.id,
			streamInfo: true,
			streamStatus: 'live',
			startTime: stream.startDate.getTime(),
			title: stream.title,
			thumbnailURL: stream.getThumbnailUrl(360, 180),
			games: [stream.gameName],
		})
		sendOrUpdateLiveMessage(newStreamRecord)
	}
}

let checkVideosRun = 0 // Just for dev mode stuff

async function checkVideos(stream: HelixStream | null = null) {
	const { data: videos } = DEV_MODE
		? checkVideosRun++ === 0
			? getMockInitialVideos()
			: getMockVideosAfterStream()
		: await apiClient.videos.getVideosByUser(streamerUser.id, {
				limit: 4, // A safe buffer
				type: 'archive',
		  })
	if (videos.length === 0) return
	const newestVideo = videos[0]
	const streamRecords = getStreamRecords()
	const oldestToNewest = videos.reverse()
	for (const video of oldestToNewest) {
		const streamRecord = streamRecords.find(
			(sr) => sr.streamID === video.streamId
		)
		if (!streamRecord) continue // No record, skip it
		// Update ended streams that have no video info or a 404 thumbnail
		const videoThumbnail = video.getThumbnailUrl(360, 180)
		if (
			streamRecord.streamStatus === 'ended' &&
			streamRecord.messageID &&
			(!streamRecord.videoInfo ||
				(streamRecord.thumbnailURL?.includes('twitch.tv/_404/') &&
					!videoThumbnail.includes('twitch.tv/_404/')))
		) {
			const updatedRecord = updateStreamRecord({
				streamID: streamRecord.streamID,
				thumbnailURL: videoThumbnail,
				videoInfo: true,
			})
			editStreamMessage(streamRecord.messageID, {
				embeds: [getStreamEndEmbed(updatedRecord, video)],
			})
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
			sr.streamID < newestVideo.streamId! && // Older than the newest video
			sr.messageID // Has a message to delete
	)
	for (const staleStreamRecord of staleStreamRecords) {
		timestampLog(
			`Force ending stale stream ID ${staleStreamRecord.streamID} marked as "live"`
		)
		deleteStreamMessage(staleStreamRecord.messageID!)
		updateStreamRecord(
			{
				streamID: staleStreamRecord.streamID,
				streamStatus: 'ended',
				videoInfo: false,
			},
			['messageID']
		) // Message deleted
		checkStreamPingButtons() // Add ping buttons back to previous message
	}
}

async function sendOrUpdateLiveMessage(streamRecord: StreamRecord) {
	const messageOptions: MessageCreateOptions = {
		embeds: [getStreamStartEmbed(streamRecord)],
	}
	if (streamRecord.messageID) {
		await editStreamMessage(streamRecord.messageID, messageOptions)
		return streamRecord.messageID
	} else {
		cleanPingButtons(streamRecord.streamID)
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
		return message.id
	}
}

async function endStream(streamRecord: StreamRecord, video: HelixVideo) {
	const updatedRecord: StreamRecord = {
		...streamRecord,
		streamStatus: 'ended',
		videoInfo: true,
		thumbnailURL: video.getThumbnailUrl(360, 180),
	}
	const messageOptions: MessageCreateOptions = {
		embeds: [getStreamEndEmbed(updatedRecord, video)],
	}
	if (getTwitchPingRole()) {
		messageOptions.components = getTwitchPingButtons()
		updatedRecord.pingButtons = 'posted'
	}
	const message = await createStreamMessage(messageOptions)
	if (streamRecord.messageID) deleteStreamMessage(streamRecord.messageID)
	updatedRecord.messageID = message.id
	updateStreamRecord(updatedRecord)
}

function cleanPingButtons(exceptStreamID?: string) {
	const buttonRecords = getStreamRecords().filter(
		(sr) =>
			sr.pingButtons === 'posted' &&
			sr.messageID &&
			sr.streamID !== exceptStreamID
	)
	for (const buttonRecord of buttonRecords) {
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
	const postedRecords = getStreamRecords().filter((sr) => sr.messageID)
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
