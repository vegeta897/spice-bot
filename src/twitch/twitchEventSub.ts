import {
	type ApiClient,
	type HelixVideo,
	type HelixStream,
	type HelixUser,
} from '@twurple/api'
import {
	EventSubHttpListener,
	EventSubMiddleware,
} from '@twurple/eventsub-http'
import { DEV_MODE, sleep, timestampLog } from '../util.js'
import { NgrokAdapter } from '@twurple/eventsub-ngrok'
import {
	getData,
	getStreamRecords,
	modifyData,
	recordStream,
	StreamRecord,
	updateStreamRecord,
} from '../db.js'
import { type MessageCreateOptions } from 'discord.js'
import {
	createStreamMessage,
	deleteStreamMessage,
	editStreamMessage,
} from '../discord.js'
import { getTwitchPingButtons, getTwitchPingRole } from '../pings.js'
import {
	getMockStreamOnlineEvent,
	getMockInitialVideos,
	getMockVideosAfterStream,
	getMockStream,
} from '../dev.js'
import { getStreamEndEmbed, getStreamStartEmbed } from './twitchEmbeds.js'
import randomstring from 'randomstring'
import { AuthEvents, getUserScopes, UserAccountTypes } from './twitchApi.js'
import { Express } from 'express'
import { ChatEvents } from './twitchChat.js'

// TODO: Think about splitting up this file
// Maybe use Emittery to forward events, let them be handled in other files

type EventSubListener = EventSubHttpListener | EventSubMiddleware

let apiClient: ApiClient
let streamerUser: HelixUser
const scopedEventSubs: Map<
	string,
	ReturnType<EventSubListener['onChannelFollow']>
> = new Map()

const processingStreamOnlineEvents: Set<string> = new Set()

export async function initTwitchEventSub(params: {
	apiClient: ApiClient
	expressApp: Express
	streamerUser: HelixUser
}) {
	apiClient = params.apiClient
	streamerUser = params.streamerUser

	let eventSubSecret = getData().twitchEventSubSecret
	if (!eventSubSecret) {
		eventSubSecret = randomstring.generate()
		modifyData({ twitchEventSubSecret: eventSubSecret })
		console.log('Generated new EventSub listener secret')
		await apiClient.eventSub.deleteAllSubscriptions()
		console.log('Deleted all EventSub subscriptions')
	}
	let listener: EventSubListener
	if (DEV_MODE) {
		await apiClient.eventSub.deleteAllSubscriptions()
		modifyData({
			streams: getStreamRecords().filter(
				(sr) => !sr.streamID.startsWith('test_')
			),
		})
		listener = new EventSubHttpListener({
			apiClient,
			adapter: new NgrokAdapter(),
			secret: eventSubSecret,
			strictHostCheck: true,
			legacySecrets: false,
		})
	} else {
		listener = new EventSubMiddleware({
			apiClient,
			hostName: process.env.EXPRESS_HOSTNAME,
			pathPrefix: 'eventsub',
			secret: eventSubSecret,
			strictHostCheck: true,
			legacySecrets: false,
		})
		listener.apply(params.expressApp)
		await listener.markAsReady()
	}
	initGlobalEventSubs(listener)
	await initScopedEventSubs(listener)
	AuthEvents.on('auth', ({ accountType }) => {
		if (accountType === 'streamer') initScopedEventSubs(listener)
	})
	AuthEvents.on('authRevoke', ({ accountType, method }) => {
		if (accountType !== 'streamer') return
		if (method === 'sign-out') scopedEventSubs.forEach((sub) => sub.stop())
		apiClient.eventSub.deleteBrokenSubscriptions()
	})
	if (DEV_MODE) (listener as EventSubHttpListener).start()
	if (!DEV_MODE) checkStreamAndVideos()
	// Check for stream/video updates every 5 minutes
	setInterval(() => checkStreamAndVideos(), (DEV_MODE ? 0.5 : 5) * 60 * 1000)
	console.log('Twitch EventSub connected')
}

async function initGlobalEventSubs(listener: EventSubListener) {
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
	const userAuthRevokeSub = listener.onUserAuthorizationRevoke(
		process.env.TWITCH_CLIENT_ID,
		async (event) => {
			if (!event.userName) return
			timestampLog(`${event.userName} has revoked authorization`)
			const accountType = UserAccountTypes[event.userName]
			if (accountType)
				AuthEvents.emit('authRevoke', { method: 'disconnect', accountType })
		}
	)
	if (DEV_MODE) {
		console.log(await streamOnlineSub.getCliTestCommand())
		console.log(await streamOfflineSub.getCliTestCommand())
	}
}

async function initScopedEventSubs(listener: EventSubListener) {
	const streamerScopes = await getUserScopes(streamerUser)
	if (streamerScopes.includes('channel:read:redemptions')) {
		scopedEventSubs.set(
			'channelRedemptionAddSub',
			listener.onChannelRedemptionAdd(streamerUser, async (event) => {
				console.log(event.rewardTitle, event.status, event.rewardPrompt)
				ChatEvents.emit('redemption', {
					username: event.userName,
					userID: event.userId,
					title: DEV_MODE ? 'GRACE' : event.rewardTitle,
					date: event.redemptionDate,
					status: event.status,
					rewardText: event.input,
				})
			})
		)
		console.log(
			await scopedEventSubs.get('channelRedemptionAddSub')!.getCliTestCommand()
		)
	}
	if (streamerScopes.includes('moderator:read:followers')) {
		scopedEventSubs.set(
			'channelFollowSub',
			listener.onChannelFollow(streamerUser, streamerUser, (event) => {
				console.log(event.userName, 'is now following!')
			})
		)
	}
	if (streamerScopes.includes('moderation:read')) {
		scopedEventSubs.set(
			'channelModAddSub',
			listener.onChannelModeratorAdd(streamerUser, (event) => {
				console.log(event.userName, 'is now a mod!')
			})
		)
	}
}

async function checkStreamAndVideos() {
	if (DEV_MODE) return // TODO: Remove
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
