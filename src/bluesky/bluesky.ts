import {
	Agent,
	type AppBskyFeedDefs,
	CredentialSession,
} from '@bluesky-social/api'
import {
	deleteSkeetRecord,
	getSkeetRecords,
	RECORD_LIMIT,
	recordSkeet,
	updateSkeetRecord,
} from './skeetRecord.js'
import { timestampLog } from '../logger.js'
import type { MessageCreateOptions } from 'discord.js'
import { getBlueskyPingButtons, getBlueskyPingRole } from '../pings.js'
import {
	createSkeetMessage,
	deleteSkeetMessage,
	editSkeetMessage,
} from '../discord.js'

const USERNAME = process.env.BLUESKY_USERNAME
const INCLUDE_REPLIES = process.env.BLUESKY_INCLUDE_REPLIES === 'true'

export async function initBluesky() {
	if (!USERNAME) {
		console.log('Missing BLUESKY_USERNAME, skipping Bluesky module')
		return
	}
	const session = new CredentialSession(new URL('https://public.api.bsky.app'))
	const agent = new Agent(session)
	let userID: string | undefined = undefined
	try {
		const response = await agent.resolveHandle({ handle: USERNAME })
		if (!response.success) throw `success=false ${JSON.stringify(response)}`
		userID = response.data.did
	} catch (e) {
		timestampLog(`Failed to resolve Bluesky handle "${USERNAME}":`, e)
	}
	if (!userID) return
	console.log(`Resolved Bluesky user handle "${USERNAME}"`)
	checkSkeets(agent)
	setInterval(() => checkSkeets(agent), 5 * 1000)
	checkDeletedSkeets(agent, userID)
	setInterval(() => checkDeletedSkeets(agent, userID), 60 * 1000)
}

let lastSuccessOrLoggedError = 0

async function checkSkeets(agent: Agent) {
	let feed: AppBskyFeedDefs.FeedViewPost[] | undefined = undefined
	try {
		const response = await agent.getAuthorFeed({
			actor: USERNAME,
			limit: RECORD_LIMIT,
		})
		if (!response.success) throw `success=false ${JSON.stringify(response)}`
		feed = response.data.feed
	} catch (e) {
		console.log('Failed to fetch Bluesky feed:', e)
	}
	if (!feed) {
		const sinceLast = Date.now() - lastSuccessOrLoggedError
		if (sinceLast >= 5 * 60 * 1000) {
			timestampLog(`Failed to fetch Bluesky feed for 5 minutes`)
			lastSuccessOrLoggedError = Date.now()
		}
		return
	}
	lastSuccessOrLoggedError = Date.now()
	const recordedSkeets = getSkeetRecords()
	let latestSkeetID: null | string = null
	let filteredFeed = feed
		.filter((post) => {
			const isRepost = post.reason?.$type === 'app.bsky.feed.defs#reasonRepost'
			if (isRepost) return false
			const isReply = post.reply?.parent.$type === 'app.bsky.feed.defs#postView'
			const isSelfReply =
				isReply &&
				'author' in post.reply!.parent &&
				'handle' in post.reply!.parent.author &&
				post.reply!.parent.author.handle === USERNAME
			if (isReply && !isSelfReply && !INCLUDE_REPLIES) return false
			return true
		})
		.reverse() // Reverse for oldest to newest
	if (recordedSkeets.length === 0) {
		// If no skeets recorded, just get the first one
		filteredFeed = filteredFeed.slice(-1)
	} else {
		latestSkeetID = recordedSkeets.at(-1)!.skeet_id
	}
	for (const post of filteredFeed) {
		// console.log('checking post', number++)
		const skeetID = post.post.uri.split('/').at(-1)!
		if (latestSkeetID !== null && skeetID <= latestSkeetID) {
			// Skip if older than last recorded skeet
			continue
		}
		if (recordedSkeets.find((rs) => rs.skeet_id === skeetID)) continue
		await postSkeet(skeetID)
	}
}

const getSkeetURL = (skeetID: string) =>
	`https://bskx.app/profile/${USERNAME}/post/${skeetID}`

async function postSkeet(skeetID: string) {
	timestampLog(`Posting skeet ID ${skeetID}`)
	const url = getSkeetURL(skeetID)
	const messageOptions: MessageCreateOptions = {
		content: url,
	}
	const blueskyPingRole = getBlueskyPingRole()
	if (blueskyPingRole) {
		messageOptions.content += ` ${blueskyPingRole.toString()}`
		messageOptions.components = getBlueskyPingButtons()
	}
	const message = await createSkeetMessage(messageOptions)
	if (!message?.id) {
		console.log('Failed to create Discord message for skeet!')
		return
	}
	const skeetRecordsWithButtons = getSkeetRecords().filter(
		(tr) => tr.pingButtons === 'posted'
	)
	// Remove buttons from previous posts
	for (const skeetRecord of skeetRecordsWithButtons) {
		editSkeetMessage(skeetRecord.message_id, {
			content: getSkeetURL(skeetRecord.skeet_id),
			components: [],
		})
		skeetRecord.pingButtons = 'cleaned'
		updateSkeetRecord(skeetRecord)
	}
	recordSkeet({
		messageID: message.id,
		skeetID,
		pingButtons: !!blueskyPingRole,
	})
}

async function checkDeletedSkeets(agent: Agent, userID: string) {
	const recordedSkeets = getSkeetRecords()
	if (recordedSkeets.length === 0) return
	let posts: AppBskyFeedDefs.PostView[] | undefined = undefined
	try {
		const response = await agent.getPosts({
			uris: recordedSkeets.map(
				(rs) => `at://${userID}/app.bsky.feed.post/${rs.skeet_id}`
			),
		})
		if (!response.success) throw `success=false ${JSON.stringify(response)}`
		posts = response.data.posts
	} catch (e) {
		console.log(`Failed to get posts:`, e)
	}
	if (!posts) return
	const deletedSkeets = recordedSkeets.filter(
		(rs) =>
			!posts.find(
				(p) => p.uri === `at://${userID}/app.bsky.feed.post/${rs.skeet_id}`
			)
	)
	if (deletedSkeets.length === 0) return
	timestampLog(`Found ${deletedSkeets.length} deleted post(s)`)
	for (const deletedSkeet of deletedSkeets) {
		timestampLog(
			`Deleting message ID ${deletedSkeet.message_id} for post ID ${deletedSkeet.skeet_id}`
		)
		deleteSkeetRecord(deletedSkeet)
		await deleteSkeetMessage(deletedSkeet.message_id)
	}
	checkSkeetPingButtons()
}

// Add ping buttons to last bluesky message if latest was deleted
export async function checkSkeetPingButtons() {
	if (!getBlueskyPingRole()) return
	const newestSkeetRecord = getSkeetRecords().at(-1)
	if (!newestSkeetRecord || newestSkeetRecord.pingButtons === 'posted') return
	editSkeetMessage(newestSkeetRecord.message_id, {
		components: getBlueskyPingButtons(),
	})
	newestSkeetRecord.pingButtons = 'posted'
	updateSkeetRecord(newestSkeetRecord)
}
