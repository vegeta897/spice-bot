import { type ApiClient } from '@twurple/api'
import {
	EventSubHttpListener,
	EventSubMiddleware,
} from '@twurple/eventsub-http'
import { DEV_MODE, timestampLog } from '../util.js'
import { NgrokAdapter } from '@twurple/eventsub-ngrok'
import { getData, getStreamRecords, modifyData } from '../db.js'
import { getMockStreamOnlineEvent } from '../dev.js'
import randomstring from 'randomstring'
import {
	AuthEvents,
	getAccountScopes,
	getUserByAccountType,
	UserAccountTypes,
} from './twitchApi.js'
import { Express } from 'express'
import { ChatEvents } from './twitchChat.js'
import Emittery from 'emittery'
import { initStreams } from './streams.js'

type EventSubListener = EventSubHttpListener | EventSubMiddleware

let apiClient: ApiClient
const scopedEventSubs: Map<
	string,
	ReturnType<EventSubListener['onChannelFollow']>
> = new Map()

export const TwitchEvents = new Emittery<{
	streamOnline: { id: string; displayName: string }
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
	const streamOnlineSub = listener.onStreamOnline(
		streamerUser,
		async (event) => {
			if (DEV_MODE) event = getMockStreamOnlineEvent(streamerUser.id)
			if (event.broadcasterId !== streamerUser.id) return // Just to be safe
			TwitchEvents.emit('streamOnline', {
				id: event.id,
				displayName: event.broadcasterDisplayName,
			})
		}
	)
	const streamOfflineSub = listener.onStreamOffline(
		streamerUser,
		async (event) => {
			if (!DEV_MODE && event.broadcasterId !== streamerUser.id) return // Just to be safe
			TwitchEvents.emit('streamOffline', {
				displayName: event.broadcasterDisplayName,
			})
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
	const streamerUser = getUserByAccountType('streamer')
	const streamerScopes = await getAccountScopes('streamer')
	const botScopes = await getAccountScopes('bot')
	if (streamerScopes.includes('channel:read:redemptions')) {
		scopedEventSubs.set(
			'channelRedemptionAddSub',
			listener.onChannelRedemptionAdd(streamerUser, async (event) => {
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
}

export async function getEventSubs() {
	const subs = await apiClient.eventSub.getSubscriptions()
	return subs.data.map((e) => ({ id: e.id, type: e.type, status: e.status }))
}
