import {
	type ApiClient,
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

let apiClient: ApiClient
let streamerUser: HelixUser

const processingStreamOnlineEvents: Set<string> = new Set()

export async function initTwitchEventSub(options: {
	apiClient: ApiClient
	streamerUser: HelixUser
}) {
	apiClient = options.apiClient
	streamerUser = options.streamerUser
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
	// TODO: Change this toEventSubMiddleware to share express app?
	// https://twurple.js.org/docs/getting-data/eventsub/express.html
	const listener = new EventSubHttpListener({
		apiClient,
		adapter,
		secret: eventSubSecret,
		strictHostCheck: true,
		legacySecrets: false,
	})
	// Have twitchAuth verify token and scopes, to init event subs
	// Don't init priveleged subs if required scope(s) not present
	// Use grant event to (re)create privileged listeners
	// Maybe store a boolean to indicate whether privileged events are enabled,
	// so the chatbot knows whether it can listen for grace trains etc.
	const streamOnlineSub = listener.onStreamOnline(
		streamerUser,
		async (event) => {
			if (DEV_MODE) event = getMockStreamOnlineEvent(streamerUser.id)
			processingStreamOnlineEvents.add(event.id)
			if (event.broadcasterId !== streamerUser.id) return // Just to be safe
			timestampLog(`${event.broadcasterName} just went live!`)
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
				if (!processingStreamOnlineEvents.has(event.id)) {
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
		}
	)
	const streamOfflineSub = listener.onStreamOffline(
		streamerUser,
		async (event) => {
			if (!DEV_MODE && event.broadcasterId !== streamerUser.id) return // Just to be safe
			timestampLog(`${event.broadcasterName} just went offline`)
			// It's so annoying that the stream ID isn't part of this event 😤
			checkVideos()
		}
	)
	const channelRedemptionAddSub = listener.onChannelRedemptionAdd(
		streamerUser,
		async (event) => {
			// TODO: Watch for GRACE
			console.log(event.rewardTitle, event.status, event.rewardPrompt)
		}
	)
	const userAuthRevokeSub = listener.onUserAuthorizationRevoke(
		process.env.TWITCH_CLIENT_ID,
		async (event) => {
			timestampLog(`${event.userName} has revoked authorization`)
			if (event.userName === process.env.TWITCH_BOT_USERNAME) {
				// Need to await data write before calling process.exit()
				await modifyData({ twitchBotToken: null })
			}
			if (event.userName === process.env.TWITCH_STREAMER_USERNAME) {
				await modifyData({ twitchStreamerToken: null })
				apiClient.eventSub.deleteBrokenSubscriptions()
			}
		}
	)
	const userAuthGrantSub = listener.onUserAuthorizationGrant(
		process.env.TWITCH_CLIENT_ID,
		async (event) => {
			timestampLog(`${event.userName} has granted authorization`)
			if (event.userName === process.env.TWITCH_BOT_USERNAME) {
			}
			if (event.userName === process.env.TWITCH_STREAMER_USERNAME) {
				console.log('re-creating channel mod add sub')
				// TODO: Re-initialized privileged subs
				// Create a method that initializes them, separate from the non-priv subs
				channelModAddSub = listener.onChannelModeratorAdd(
					streamerUser,
					(event) => {
						console.log(event.userName, 'is a mod now!')
					}
				)
			}
		}
	)
	let channelModAddSub = listener.onChannelModeratorAdd(
		streamerUser,
		(event) => {
			console.log(event.userName, 'is a mod now!')
		}
	)
	let channelFollowSub = listener.onChannelFollow(
		streamerUser,
		streamerUser,
		(event) => {
			console.log(event.userName, 'is now following!')
		}
	)
	listener.start()
	// TODO: Don't need to use onVerify
	// Use getSubscriptionsForType to check if privileged events are enabled
	// They won't exist if app wasn't authed when they were created
	// They will have a revoked status if auth was revoked during runtime
	// setInterval(async () => {
	// 	const subs = await apiClient.eventSub.getSubscriptions()
	// 	console.log(
	// 		subs.data.map((s) => [s.type, s.id, s.creationDate, s.status].join(' | '))
	// 	)
	// }, 8 * 1000)
	if (!DEV_MODE) checkStreamAndVideos()
	// Check for stream/video updates every 5 minutes
	setInterval(() => checkStreamAndVideos(), (DEV_MODE ? 0.5 : 5) * 60 * 1000)
	if (DEV_MODE) {
		console.log(await streamOnlineSub.getCliTestCommand())
		console.log(await streamOfflineSub.getCliTestCommand())
		// console.log(await channelRedemptionAddSub.getCliTestCommand())
	}
	console.log('Twitch EventSub connected')
}

async function checkStreamAndVideos() {
	return // TODO: Remove
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
		// TODO: Maybe delete the message instead
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
