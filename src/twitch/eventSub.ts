import { type ApiClient } from '@twurple/api'
import {
	EventSubHttpListener,
	EventSubMiddleware,
} from '@twurple/eventsub-http'
import { DEV_MODE } from '../util.js'
import { timestampLog } from '../logger.js'
import { NgrokAdapter } from '@twurple/eventsub-ngrok'
import { getData, modifyData } from '../db.js'
import randomstring from 'randomstring'
import {
	AuthEvents,
	getAccountScopes,
	getUserByAccountType,
	UserAccountTypes,
	userIsMod,
} from './twitchApi.js'
import { Express } from 'express'
import { ChatEvents, sendChatMessage, sendWhisper } from './chat/twitchChat.js'
import { initStreams, onNewStream, onStreamOffline } from './streams.js'
import { HypeEvents } from './chat/hype.js'
import { makeTextGraceTrainSafe } from './chat/grace.js'
import { Emotes } from './chat/emotes.js'

type EventSubListener = EventSubHttpListener | EventSubMiddleware

let apiClient: ApiClient
const scopedEventSubs: Map<
	string,
	ReturnType<EventSubListener['onChannelFollow']>
> = new Map()

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
		listener = new EventSubHttpListener({
			apiClient,
			adapter: new NgrokAdapter({
				ngrokConfig: { authtoken: process.env.NGROK_AUTH_TOKEN },
			}),
			secret: eventSubSecret,
			strictHostCheck: true,
		})
	} else {
		listener = new EventSubMiddleware({
			apiClient,
			hostName: process.env.EXPRESS_HOSTNAME,
			pathPrefix: 'eventsub',
			secret: eventSubSecret,
			strictHostCheck: true,
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
		if (event.broadcasterId !== streamerUser.id) return // Just to be safe
		onNewStream(event.id)
	})
	listener.onStreamOffline(streamerUser, async (event) => {
		if (!DEV_MODE && event.broadcasterId !== streamerUser.id) return // Just to be safe
		// It's so annoying that the stream ID isn't part of this event 😤
		onStreamOffline()
	})
	listener.onUserAuthorizationRevoke(async (event) => {
		if (!event.userName) return
		timestampLog(`${event.userName} has revoked authorization`)
		const accountType = UserAccountTypes[event.userName]
		if (accountType)
			AuthEvents.emit('authRevoke', { method: 'disconnect', accountType })
	})
}

async function initScopedEventSubs(listener: EventSubListener) {
	const streamerUser = getUserByAccountType('streamer')
	const streamerScopes = await getAccountScopes('streamer')
	const botUser = getUserByAccountType('bot')
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
			listener.onChannelHypeTrainBeginV2(streamerUser, (event) => {
				HypeEvents.emit('begin', event)
			})
		)
		scopedEventSubs.set(
			'channelHypeTrainProgressSub',
			listener.onChannelHypeTrainProgressV2(streamerUser, (event) => {
				HypeEvents.emit('progress', event)
			})
		)
		scopedEventSubs.set(
			'channelHypeTrainEndSub',
			listener.onChannelHypeTrainEndV2(streamerUser, (event) => {
				HypeEvents.emit('end', event)
			})
		)
	}
	if (botScopes.includes('moderator:read:chat_messages')) {
		scopedEventSubs.set(
			'channelModerateSub',
			listener.onChannelModerate(streamerUser, botUser, (event) => {
				if (event.moderationAction === 'raid') ChatEvents.emit('raid')
			})
		)
	}
	if (botScopes.includes('user:read:chat')) {
		scopedEventSubs.set(
			'channelChatMessage',
			listener.onChannelChatMessage(streamerUser, botUser, async (event) => {
				ChatEvents.emit('message', {
					username: event.chatterName,
					userID: event.chatterId,
					userColor: event.color,
					text: event.messageText,
					date: new Date(),
					msgEvent: event,
					mod:
						event.chatterName === streamerUser.name ||
						(await userIsMod(event.chatterName)),
					self: event.chatterName === botUser.name,
				})
			})
		)
	}
	if (botScopes.includes('user:manage:whispers')) {
		const whispers: Map<string, number> = new Map()
		const whisperCooldown = 30 * 1000
		scopedEventSubs.set(
			'userWhisper',
			listener.onUserWhisperMessage(botUser, (event) => {
				// Maybe use this to send debug commands?
				timestampLog(
					`Whisper from ${event.senderUserDisplayName}: ${event.messageText}`
				)
				const userID = event.senderUserId
				if ((whispers.get(userID) || 0) + whisperCooldown > Date.now()) return
				whispers.set(userID, Date.now())
				sendWhisper(
					userID,
					`Hi, I'm Spice Bot! I do various tasks in ${
						process.env.NICKNAME || process.env.TWITCH_STREAMER_USERNAME
					}'s channel. Please contact ${
						process.env.TWITCH_ADMIN_USERNAME
					} with any problems or questions`
				)
			})
		)
	}

	if (streamerScopes.includes('channel:read:subscriptions')) {
		scopedEventSubs.set(
			'channelSubscription',
			listener.onChannelSubscription(streamerUser, (event) => {
				// TODO: Send to hype train

				if (event.isGift && event.userId === botUser.id) {
					timestampLog(`Bot received a gift sub to ${event.broadcasterName}`)
					modifyData({ twitchBotLastSubbed: Date.now() })
					sendChatMessage(
						makeTextGraceTrainSafe(
							`Thank you for the gift sub! <3 ${Emotes.POGGERS} ${Emotes.POGGERS}`
						)
					)
				}
			})
		)
	}
}

export async function getEventSubs() {
	const subs = await apiClient.eventSub.getSubscriptions()
	return subs.data.map((e) => ({ id: e.id, type: e.type, status: e.status }))
}
