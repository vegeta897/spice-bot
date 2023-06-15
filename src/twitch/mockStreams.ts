import { type HelixVideo, type HelixStream } from '@twurple/api'
import { onNewStream, onStreamOffline } from './streams.js'

export function testStreamOnline(number: number) {
	updateVideoDurations()
	const streamID = `test_stream_${number}`
	const title = `Title for ${streamID}`
	const startDate = new Date()
	const getThumbnailUrl = (x: number, y: number) =>
		'https://cdn.discordapp.com/attachments/209177876975583232/1066968149376901170/thumb1.png'
	currentStream = {
		id: streamID,
		title,
		startDate,
		gameName: `Game ID ${gameIncrement}`,
		getThumbnailUrl,
	} as HelixStream
	videos.push({
		streamId: streamID,
		title,
		creationDate: startDate,
		getThumbnailUrl,
		durationInSeconds: 0,
		url: `https://www.twitch.tv/videos/${1000 + number}`,
	} as HelixVideo)
	onNewStream(streamID)
}

let currentStream: HelixStream | null = null
export const getMockStream = () => currentStream

const videos: HelixVideo[] = []
export const getMockVideos = () => ({ data: [...videos] })

export function testStreamOffline(keepOnline = false) {
	updateVideoDurations()
	if (!keepOnline) currentStream = null
	onStreamOffline()
}

let gameIncrement = 1
export function testChangeGame() {
	gameIncrement++
	// @ts-expect-error
	currentStream.gameName = `Game ID ${gameIncrement}`
}

function updateVideoDurations() {
	for (const video of videos) {
		// @ts-expect-error
		video.durationInSeconds = Math.round(
			(Date.now() - video.creationDate.getTime()) / 1000
		)
	}
}
