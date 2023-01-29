import { ClientCredentialsAuthProvider } from '@twurple/auth'
import {
	ApiClient,
	type HelixVideo,
	type HelixStream,
	type HelixUser,
} from '@twurple/api'
import {
	ReverseProxyAdapter,
	EventSubHttpListener,
} from '@twurple/eventsub-http'
import { DEV_MODE, sleep, timestampLog } from './util.js'
import { NgrokAdapter } from '@twurple/eventsub-ngrok'
import {
	getData,
	getStreamRecords,
	modifyData,
	recordStream,
	StreamRecord,
	updateStreamRecord,
} from './db.js'
import { type MessageCreateOptions } from 'discord.js'
import {
	createStreamMessage,
	deleteStreamMessage,
	editStreamMessage,
} from './discord.js'
import { getTwitchPingButtons, getTwitchPingRole } from './pings.js'
import {
	getMockStreamOnlineEvent,
	getMockInitialVideos,
	getMockVideosAfterStream,
	getMockStream,
} from './dev.js'
import { getStreamEndEmbed, getStreamStartEmbed } from './twitchEmbeds.js'
import randomstring from 'randomstring'

// TODO: Think about splitting up this file

const TWITCH_USERNAME = process.env.TWITCH_USERNAME

let apiClient: ApiClient
let twitchUser: HelixUser

const processingEvents: Set<string> = new Set()

export async function initTwitch() {
	const authProvider = new ClientCredentialsAuthProvider(
		process.env.TWITCH_CLIENT_ID,
		process.env.TWITCH_CLIENT_SECRET
	)

	apiClient = new ApiClient({ authProvider })
	twitchUser = (await apiClient.users.getUserByName(TWITCH_USERNAME))!
	if (!twitchUser) throw `Could not find twitch user "${TWITCH_USERNAME}"`
	const adapter = DEV_MODE
		? new NgrokAdapter()
		: new ReverseProxyAdapter({
				hostName: process.env.TWITCH_EVENTSUB_HOSTNAME,
				pathPrefix: process.env.TWITCH_EVENTSUB_PATH_PREFIX,
				port: +process.env.TWITCH_EVENTSUB_PORT,
		  })
	if (DEV_MODE) {
		await apiClient.eventSub.deleteAllSubscriptions()
		modifyData({
			streams: getStreamRecords().filter(
				(sr) => !sr.streamID.startsWith('test_')
			),
		})
	}
	let eventSubSecret = getData().twitchEventSubSecret
	if (!eventSubSecret) {
		eventSubSecret = randomstring.generate()
		modifyData({ twitchEventSubSecret: eventSubSecret })
		console.log('Generated new EventSub listener secret')
		await apiClient.eventSub.deleteAllSubscriptions()
		console.log('Deleted all EventSub subscriptions')
	}
	const listener = new EventSubHttpListener({
		apiClient,
		adapter,
		secret: eventSubSecret,
		strictHostCheck: true,
	})
	const onlineSubscription = await listener.subscribeToStreamOnlineEvents(
		twitchUser.id,
		async (event) => {
			if (DEV_MODE) event = getMockStreamOnlineEvent(twitchUser.id)
			processingEvents.add(event.id)
			if (event.broadcasterId !== twitchUser.id) return // Just to be safe
			timestampLog(`${TWITCH_USERNAME} just went live!`)
			if (getStreamRecords().find((sr) => sr.streamID === event.id)) {
				console.log(`Stream record ID ${event.id} already exists`)
				return
			}
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
				if (!processingEvents.has(event.id)) {
					// Processing was ended elsewhere
					return
				}
				streamInfo = (await event.getStream()) as HelixStream | null
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
						processingEvents.delete(event.id)
						return
					}
					await sleep(5000)
				}
			} while (!streamInfo)
			console.log('Got stream info, posting/updating message')
			processingEvents.delete(event.id)
			streamRecord.streamInfo = true
			streamRecord.startTime = streamInfo.startDate.getTime()
			streamRecord.title = streamInfo.title
			streamRecord.games.push(streamInfo.gameName)
			streamRecord.thumbnailURL = streamInfo.getThumbnailUrl(360, 180)
			if (messageID) streamRecord.messageID = messageID
			sendOrUpdateLiveMessage(streamRecord)
		}
	)
	const offlineSubscription = await listener.subscribeToStreamOfflineEvents(
		twitchUser.id,
		async (event) => {
			if (!DEV_MODE && event.broadcasterId !== twitchUser.id) return // Just to be safe
			timestampLog(`${TWITCH_USERNAME} just went offline`)
			// It's so annoying that the stream ID isn't part of this event 😤
			checkVideos()
		}
	)
	await listener.start()
	if (!DEV_MODE) checkStreamAndVideos()
	// Check for stream/video updates every 5 minutes
	setInterval(() => checkStreamAndVideos(), (DEV_MODE ? 0.5 : 5) * 60 * 1000)
	if (DEV_MODE) {
		console.log(await onlineSubscription.getCliTestCommand())
		console.log(await offlineSubscription.getCliTestCommand())
	}
	console.log('Twitch EventSub connected')
}

async function checkStreamAndVideos() {
	const stream = DEV_MODE ? getMockStream() : await twitchUser.getStream()
	handleStream(stream)
	checkVideos(stream)
}

function handleStream(stream: HelixStream | null) {
	if (!stream) return
	if (processingEvents.has(stream.id)) {
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
		: await apiClient.videos.getVideosByUser(twitchUser.id, {
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
			!processingEvents.has(streamRecord.streamID) // Not currently processing
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
			!processingEvents.has(sr.streamID) && // Not currently processing
			sr.startTime < Date.now() - 5 * 60 * 1000 && // Older than 5 minutes
			sr.streamID < newestVideo.streamId! && // Older than the newest video
			sr.messageID // Has a message to edit
	)
	if (staleStreamRecords.length > 0)
		timestampLog(
			`Force ending ${staleStreamRecords.length} stale stream(s) marked as "live"`
		)
	for (const staleStreamRecord of staleStreamRecords) {
		const updatedRecord = updateStreamRecord({
			streamID: staleStreamRecord.streamID,
			streamStatus: 'ended',
			videoInfo: false,
		})
		editStreamMessage(updatedRecord.messageID!, {
			content: '',
			embeds: [getStreamEndEmbed(updatedRecord)],
		})
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
		const twitchPingRole = getTwitchPingRole()
		if (twitchPingRole) {
			messageOptions.content = twitchPingRole.toString()
			messageOptions.components = getTwitchPingButtons()
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
	const oldButtonRecords = getStreamRecords().filter(
		(sr) =>
			sr.pingButtons === 'posted' &&
			sr.messageID &&
			sr.streamID !== streamRecord.streamID
	)
	for (const oldButtonRecord of oldButtonRecords) {
		editStreamMessage(oldButtonRecord.messageID!, { components: [] })
		updateStreamRecord({
			streamID: oldButtonRecord.streamID,
			pingButtons: 'cleaned',
		})
	}
	const updatedRecord: StreamRecord = {
		...streamRecord,
		streamStatus: 'ended',
		videoInfo: true,
		thumbnailURL: video.getThumbnailUrl(360, 180),
	}
	const messageOptions: MessageCreateOptions = {
		embeds: [getStreamEndEmbed(updatedRecord, video)],
	}
	const twitchPingRole = getTwitchPingRole()
	if (twitchPingRole) {
		messageOptions.components = getTwitchPingButtons()
		updatedRecord.pingButtons = 'posted'
	}
	const message = await createStreamMessage(messageOptions)
	if (streamRecord.messageID) deleteStreamMessage(streamRecord.messageID)
	updatedRecord.messageID = message.id
	updateStreamRecord(updatedRecord)
}
