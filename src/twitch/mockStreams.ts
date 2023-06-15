import { type HelixVideo, type HelixStream } from '@twurple/api'
import { type EventSubHttpListener } from '@twurple/eventsub-http'

const testStream = {
	id: 'test_stream',
	startDate: new Date(Date.now() - 3 * 60 * 1000),
	title:
		"This is a test stream! Stream titles can be fairly long, so let's test it!",
	gameName: 'Nancy Drew: Secrets Can Kill',
	getThumbnailUrl: (x: number, y: number) =>
		'https://cdn.discordapp.com/attachments/209177876975583232/1066968149376901170/thumb1.png',
} as HelixStream

export const getMockStreamOnlineEvent = (twitchID: string) =>
	({
		broadcasterId: twitchID,
		broadcasterDisplayName: 'ybbaaabby',
		id: 'test_stream',
		getStream: () => testStream,
	} as unknown as Parameters<
		Parameters<EventSubHttpListener['onStreamOnline']>[1]
	>[0])

export const getMockStream = () =>
	({
		...testStream,
		title:
			'This is a test stream and the title, game, and thumbnail have been updated!',
		gameName: 'The Legend of Zelda: Breath of the Wild',
		getThumbnailUrl: (x: number, y: number) =>
			'https://cdn.discordapp.com/attachments/209177876975583232/1066968149070712893/thumb2.png',
	} as HelixStream)

const testOldVod = {
	streamId: 'test_old_vod',
	title: 'This is a VOD for an old stream! How about that?',
	url: 'https://www.twitch.tv/videos/100000001',
	creationDate: new Date('2023-01-20'),
	durationInSeconds: 3702,
	getThumbnailUrl: (x: number, y: number) =>
		'https://cdn.discordapp.com/attachments/209177876975583232/1066968149070712893/thumb2.png',
} as HelixVideo

export const getMockInitialVideos = () => ({
	data: [testOldVod] as HelixVideo[],
})

export const getMockVideosAfterStream = () => ({
	data: [
		{
			streamId: testStream.id,
			title: testStream.title,
			url: 'https://www.twitch.tv/videos/100000002',
			creationDate: testStream.startDate,
			durationInSeconds: 9373,
			getThumbnailUrl: testStream.getThumbnailUrl,
		},
		testOldVod,
	] as HelixVideo[],
})
