import { type ApiClient } from '@twurple/api'
import {
	EventSubHttpListener,
	EventSubMiddleware,
} from '@twurple/eventsub-http'
import { DEV_MODE, timestampLog } from '../util.js'
import { NgrokAdapter } from '@twurple/eventsub-ngrok'
import { getData, modifyData } from '../db.js'
import { getMockStreamOnlineEvent } from './mockStreams.js'
import randomstring from 'randomstring'
import {
	AuthEvents,
	getAccountScopes,
	getUserByAccountType,
	UserAccountTypes,
} from './twitchApi.js'
import { Express } from 'express'
import { ChatEvents } from './chat/twitchChat.js'
import Emittery from 'emittery'
import { initStreams, onNewStream } from './streams.js'
import { getStreamRecords } from './streamRecord.js'
import { HypeEvents } from './chat/hype.js'

type EventSubListener = EventSubHttpListener | EventSubMiddleware

let apiClient: ApiClient
const scopedEventSubs: Map<
	string,
	ReturnType<EventSubListener['onChannelFollow']>
> = new Map()

export const StreamEvents = new Emittery<{
	streamOnline: { id: String; downtime: number }
	streamOffline: { displayName: string }
}>()

export async function initTwitchEventSub(params: {
	apiClient: ApiClient
	expressApp: Express
}) {
	apiClient = params.apiClient

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
		if (accountType !== 'admin') initScopedEventSubs(listener)
	})
	AuthEvents.on('authRevoke', ({ accountType, method }) => {
		if (accountType !== 'streamer') return
		if (method === 'sign-out') scopedEventSubs.forEach((sub) => sub.stop())
		apiClient.eventSub.deleteBrokenSubscriptions()
	})
	if (DEV_MODE) (listener as EventSubHttpListener).start()
	initStreams({ apiClient })
	console.log('Twitch EventSub connected')
}

async function initGlobalEventSubs(listener: EventSubListener) {
	const streamerUser = getUserByAccountType('streamer')
	listener.onStreamOnline(streamerUser, async (event) => {
		if (DEV_MODE) event = getMockStreamOnlineEvent(streamerUser.id)
		if (event.broadcasterId !== streamerUser.id) return // Just to be safe
		onNewStream(event.id)
		// let downtime = Infinity
		// // TODO: Move this to a method in streamRecord.ts
		// let parentStreamID: string | undefined = undefined
		// const otherStreams = getStreamRecords().filter(
		// 	(sr) => sr.streamID !== event.id
		// )
		// const otherLiveStreams = otherStreams.filter(
		// 	(sr) => sr.streamStatus === 'live'
		// )
		// if (otherLiveStreams.length > 0) {
		// 	const parentStream = otherLiveStreams.find((sr) => !sr.parentStreamID)
		// 	if (parentStream) parentStreamID = parentStream.streamID
		// 	downtime = 0
		// } else {
		// 	const latestStream = otherStreams.at(-1)
		// 	if (latestStream)
		// 		downtime = event.startDate.getTime() - latestStream.endTime!
		// }
		// if (downtime < 30 * 60 * 1000) {
		// }
		// TwitchEvents.emit('streamOnline', {
		// 	id: event.id,
		// 	displayName: event.broadcasterDisplayName,
		// 	downtime,
		// })
	})
	listener.onStreamOffline(streamerUser, async (event) => {
		if (!DEV_MODE && event.broadcasterId !== streamerUser.id) return // Just to be safe
		StreamEvents.emit('streamOffline', {
			displayName: event.broadcasterDisplayName,
		})
	})
	listener.onUserAuthorizationRevoke(
		process.env.TWITCH_CLIENT_ID,
		async (event) => {
			if (!event.userName) return
			timestampLog(`${event.userName} has revoked authorization`)
			const accountType = UserAccountTypes[event.userName]
			if (accountType)
				AuthEvents.emit('authRevoke', { method: 'disconnect', accountType })
		}
	)
	// TODO: Use admin panel instead
	// if (DEV_MODE) {
	// 	console.log(await streamOnlineSub.getCliTestCommand())
	// 	console.log(await streamOfflineSub.getCliTestCommand())
	// }
}

async function initScopedEventSubs(listener: EventSubListener) {
	const streamerUser = getUserByAccountType('streamer')
	const streamerScopes = await getAccountScopes('streamer')
	const botScopes = await getAccountScopes('bot')
	if (streamerScopes.includes('channel:read:redemptions')) {
		scopedEventSubs.set(
			'channelRedemptionAddSub',
			listener.onChannelRedemptionAdd(streamerUser, async (event) => {
				if (DEV_MODE)
					timestampLog(event.rewardTitle, event.status, event.userDisplayName)
				ChatEvents.emit('redemption', {
					username: event.userName,
					userID: event.userId,
					title: event.rewardTitle,
					date: event.redemptionDate,
					status: event.status,
					rewardText: event.input,
				})
			})
		)
	}
	if (DEV_MODE && botScopes.includes('moderator:read:followers')) {
		const botUser = getUserByAccountType('bot')
		scopedEventSubs.set(
			'channelFollowSub',
			listener.onChannelFollow(streamerUser, botUser, (event) => {
				timestampLog(event.userName, 'is now following!')
			})
		)
	}
	// Maybe keep this in prod, and add the remove event too,
	// to check when the bot is modded or de-modded
	if (DEV_MODE && streamerScopes.includes('moderation:read')) {
		scopedEventSubs.set(
			'channelModAddSub',
			listener.onChannelModeratorAdd(streamerUser, (event) => {
				timestampLog(event.userName, 'is now a mod!')
			})
		)
	}
	if (streamerScopes.includes('channel:read:hype_train')) {
		scopedEventSubs.set(
			'channelHypeTrainBeginSub',
			listener.onChannelHypeTrainBegin(streamerUser, (event) => {
				HypeEvents.emit('begin', event)
			})
		)
		scopedEventSubs.set(
			'channelHypeTrainProgressSub',
			listener.onChannelHypeTrainProgress(streamerUser, (event) => {
				HypeEvents.emit('progress', event)
			})
		)
		scopedEventSubs.set(
			'channelHypeTrainEndSub',
			listener.onChannelHypeTrainEnd(streamerUser, (event) => {
				HypeEvents.emit('end', event)
			})
		)
	}
}

export async function getEventSubs() {
	const subs = await apiClient.eventSub.getSubscriptions()
	return subs.data.map((e) => ({ id: e.id, type: e.type, status: e.status }))
}
