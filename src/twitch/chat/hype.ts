import type {
	EventSubChannelHypeTrainBeginEvent,
	EventSubChannelHypeTrainContribution,
	EventSubChannelHypeTrainEndEvent,
	EventSubChannelHypeTrainProgressEvent,
} from '@twurple/eventsub-base'
import Emittery from 'emittery'
import {
	randomElement,
	randomIntRange,
	sleep,
	timestampLog,
} from '../../util.js'
import {
	HypeProgress,
	addToHypeTrain,
	endHypeTrain,
	startHypeTrain,
} from './trains.js'
import { getRandomUserColor, getUserColor } from './userColors.js'
import randomstring from 'randomstring'

export const HypeEvents = new Emittery<{
	begin: EventSubChannelHypeTrainBeginEvent
	progress: EventSubChannelHypeTrainProgressEvent
	end: EventSubChannelHypeTrainEndEvent
}>()

type ContributionKey = `${'bits' | 'subs'}:${string}`
type HypeStats = {
	id: string
	level: number
	total: number
	progress: number
	goal: number
	graces: number
	contributions: HypeProgress[]
	state: 'starting' | 'started'
	initialContributions: Map<ContributionKey, number>
	initialContributionTimeout?: NodeJS.Timeout
}

let hypeStats: HypeStats | null = null
let endedHypeTrainID: string | null = null

HypeEvents.on('begin', (event) => {
	timestampLog(
		`Hype Train ID ${event.id} begin!
Goal: ${event.goal} | Level: ${event.level} | Progress: ${
			event.progress
		} | Total: ${event.total}
Last Contrib: ${formatHypeContribution(event.lastContribution)}
Top Contribs: ${listHypeContributions(event.topContributors)}`
	)
	// This event doesn't necessarily come before the initial batch of progress events
	// But we use it to see if it contains any unique contributions
	hypeStats ||= createHypeStats(event.id)
	updateStats(event)
	if (hypeStats.state === 'starting') handleInitialHypeEvent(event)
})

HypeEvents.on('progress', (event) => {
	timestampLog(`Hype Train ID ${event.id} progress
	Goal: ${event.goal} | Level: ${event.level} | Progress: ${
		event.progress
	} | Total: ${event.total}
Last Contrib: ${formatHypeContribution(event.lastContribution)}
Top Contribs: ${listHypeContributions(event.topContributors)}`)
	if (event.id === endedHypeTrainID) {
		timestampLog('Ignoring hype train progress event for ended train')
		return
	}
	const newTrain = !hypeStats
	hypeStats ||= createHypeStats(event.id)
	const { statsWereUpdated } = updateStats(event)
	if (!newTrain && statsWereUpdated && hypeStats.state === 'starting') {
		clearTimeout(hypeStats.initialContributionTimeout)
		beginHypeTrain()
	}
	if (hypeStats.state === 'starting') {
		handleInitialHypeEvent(event)
		return
	}
	if (event.lastContribution.total >= 100) {
		const contribution = createHypeContribution(event.lastContribution)
		hypeStats.contributions.push(contribution)
		addToHypeTrain({ ...getHypeTrainBaseData(hypeStats), contribution })
	} else if (statsWereUpdated) {
		// Update stats but don't include the contribution if less than 100 bits
		addToHypeTrain(getHypeTrainBaseData(hypeStats))
	}
})

HypeEvents.on('end', (event) => {
	timestampLog(`Hype Train ID ${event.id} end!
Level: ${event.level} | Total: ${event.total}
Top Contribs: ${listHypeContributions(event.topContributors)}`)
	if (!hypeStats) return
	hypeStats.level = event.level
	hypeStats.total = event.total
	endHypeTrain({
		level: hypeStats.level,
		total: hypeStats.total,
		graces: hypeStats.graces,
	})
	endedHypeTrainID = hypeStats.id
	hypeStats = null
})

function createHypeStats(id: string): HypeStats {
	return {
		id,
		level: 0,
		total: 0,
		progress: 0,
		goal: 0,
		graces: 0,
		contributions: [],
		state: 'starting',
		initialContributions: new Map(),
	}
}

function handleInitialHypeEvent(
	event:
		| EventSubChannelHypeTrainProgressEvent
		| EventSubChannelHypeTrainBeginEvent
) {
	updateInitialContributions(event)
	clearTimeout(hypeStats!.initialContributionTimeout)
	hypeStats!.initialContributionTimeout = setTimeout(beginHypeTrain, 1000)
}

function beginHypeTrain() {
	if (!hypeStats || hypeStats.state !== 'starting') return
	hypeStats.state = 'started'
	let initialTotal = 0
	for (const [key, contribution] of hypeStats.initialContributions) {
		const [type, userId] = key.split(':')
		hypeStats.contributions.push(
			createHypeContribution({
				type,
				total: contribution,
				userId,
			} as EventSubChannelHypeTrainContribution)
		)
		initialTotal += contribution
	}
	// Add artificial contributions to meet total
	while (initialTotal < hypeStats.total) {
		const amount = Math.min(500, hypeStats.total - initialTotal)
		if (amount < 100) break
		initialTotal += amount
		const color = getRandomUserColor()
		// Add to the beginning of the train
		hypeStats.contributions.unshift({ type: 'bits', amount, color })
	}
	startHypeTrain(getHypeTrainStartData(hypeStats))
}

function createHypeContribution(
	contribution: EventSubChannelHypeTrainContribution
): HypeProgress {
	const type = contribution.type === 'subscription' ? 'subs' : 'bits'
	let amount = contribution.total
	// Convert subs total to number of subs
	if (type === 'subs' && amount >= 500) amount = Math.round(amount / 500)
	const color = getUserColor(contribution.userId)
	return { type, amount, color }
}

const getContributionKey = (
	contribution: EventSubChannelHypeTrainProgressEvent['lastContribution']
): ContributionKey =>
	`${contribution.type === 'subscription' ? 'subs' : 'bits'}:${
		contribution.userId
	}`

function updateInitialContributions(
	event:
		| EventSubChannelHypeTrainProgressEvent
		| EventSubChannelHypeTrainBeginEvent
) {
	for (const contribution of event.topContributors) {
		const cKey = getContributionKey(contribution)
		hypeStats!.initialContributions.set(cKey, contribution.total)
	}
	// Add last contribution too, in case it's missing from top contributors
	const cKey = getContributionKey(event.lastContribution)
	const initialContribution = hypeStats!.initialContributions.get(cKey) || 0
	if (initialContribution < event.lastContribution.total) {
		hypeStats!.initialContributions.set(cKey, event.lastContribution.total)
	}
}

function updateStats(
	event:
		| EventSubChannelHypeTrainProgressEvent
		| EventSubChannelHypeTrainBeginEvent
) {
	let statsWereUpdated = false
	if (event.total > hypeStats!.total || event.level > hypeStats!.level) {
		hypeStats!.level = event.level
		hypeStats!.total = event.total
		hypeStats!.progress = event.progress
		hypeStats!.goal = event.goal
		statsWereUpdated = true
	}
	return { statsWereUpdated }
}

export const getCurrentHypeTrain = () => {
	if (!hypeStats) return false
	return getHypeTrainStartData(hypeStats)
}

function getHypeTrainBaseData(stats: HypeStats) {
	return {
		type: 'hype',
		level: stats.level,
		total: stats.total,
		progress: stats.progress,
		goal: stats.goal,
		graces: stats.graces,
	}
}

function getHypeTrainStartData(stats: HypeStats) {
	return { ...getHypeTrainBaseData(stats), contributions: stats.contributions }
}

export function addGraceToHypeTrain(combo: number) {
	if (!hypeStats) return
	hypeStats.graces = combo
	addToHypeTrain(getHypeTrainBaseData(hypeStats))
}

export function setHypeStatsGraces(combo: number) {
	if (!hypeStats) return
	hypeStats.graces = combo
}

const listHypeContributions = (
	contributions: EventSubChannelHypeTrainContribution[]
) => contributions.map(formatHypeContribution).join(', ')

const formatHypeContribution = ({
	userDisplayName,
	type,
	total,
}: EventSubChannelHypeTrainContribution) =>
	`${userDisplayName}:${type}:${total}`

let lastTestUserID = 1000
export async function testHypeProgress() {
	if (hypeStats) {
		const lastContribution = createTestHypeContribution()
		const overGoal =
			hypeStats.progress + lastContribution.total - hypeStats.goal
		HypeEvents.emit('progress', {
			id: hypeStats.id,
			level: hypeStats.level + (overGoal >= 0 ? 1 : 0),
			goal: hypeStats.goal + (overGoal >= 0 ? 500 : 0),
			total: hypeStats.total + lastContribution.total,
			progress:
				overGoal >= 0 ? overGoal : hypeStats.progress + lastContribution.total,
			lastContribution,
			topContributors: [lastContribution],
		} as EventSubChannelHypeTrainProgressEvent)
	} else {
		// Initial train progress events
		const initialContributions: EventSubChannelHypeTrainContribution[] = []
		for (let i = 0; i < 4; i++) {
			const contribution = createTestHypeContribution()
			initialContributions.push(contribution)
		}
		const unaccountedPoints = 750 // Portion of total we saw no contribution data for
		const baseEvent = {
			id: randomstring.generate(12),
			level: 3,
			goal: 2200,
			total:
				unaccountedPoints +
				initialContributions.map((c) => c.total).reduce((p, c) => p + c),
			progress: 0,
			lastContribution: initialContributions.at(-1),
		}
		for (const _initialContribution of initialContributions) {
			HypeEvents.emit('progress', {
				...baseEvent,
				topContributors: [
					randomElement(initialContributions),
					randomElement(initialContributions),
				],
			} as EventSubChannelHypeTrainProgressEvent)
			await sleep(randomIntRange(0, 5) * 100)
		}
	}
}

function createTestHypeContribution() {
	const type = Math.random() < 0.7 ? 'subscription' : 'bits'
	const total =
		type === 'bits' ? randomIntRange(5, 30) * 10 : randomIntRange(1, 5) * 500
	return {
		type,
		total,
		userDisplayName: `TestUser${lastTestUserID}`,
		userId: `${lastTestUserID++}`,
	} as EventSubChannelHypeTrainContribution
}

export function testHypeEnd() {
	const lastContribution = {
		total: 500,
		type: 'bits',
		userDisplayName: `TestUser${lastTestUserID}`,
		userId: `${lastTestUserID}`,
	}
	HypeEvents.emit('end', {
		id: hypeStats?.id || endedHypeTrainID!,
		level: hypeStats?.level || 3,
		total: hypeStats?.total || 4600,
		lastContribution,
		topContributors: [lastContribution],
	} as unknown as EventSubChannelHypeTrainEndEvent)
}
/*

Twitch API docs are not very clear about how subs work in hype trains

https://dev.twitch.tv/docs/eventsub/eventsub-reference/#last-contribution
This says that if the contribution type is subscription, 
the total will be 500, 1000, or 2500, representing tier 1, 2, or 3 subs.
Does that mean there will be one event per sub?
And in the one of the example payloads, it shows a total of 45 for a sub type

So until I have real world data, I'm going to code defensively.

If the total is less than 500, then it's simply the number of subs (doubtful)
If the total is 500 or more, I'm going to divide by 500 to get the number of subs
(It's unlikely that anyone is going to do higher tier subs anyway)

HANG ON

https://twitch.uservoice.com/forums/310213-developers/suggestions/42201181-provide-the-amount-the-hype-train-progress-increas
So, great, now I'm not even sure if tracking all the last_contribution objects
will give me everything. Unfortunately I have nothing else to rely on here, because
I need this to separate bits from subs, and to get the user color. Oh well, maybe
this issue is out of date and they've fixed it since

And then I found...
https://github.com/plusmnt/twitch-train-led/blob/master/hype_train_sample.json
This is old, but it looks like real-world data
Based on lines 1-208 & 342-424, it does send one event per sub,
with the same timestamp, and the train total includes the value of
all the subs for that batch

UPDATE: What I learned from seeing real hype data for the first time:

- When a train begins, a batch of progress events are sent out, all within 1s
- These events may be out of order, but they should all have the same total/progress
- The last_contribution in these events is mostly worthless, as it may be just
the same one contribution repeated in every event
- The top_contributors can vary between these events, so we will keep track of
everything in it during this period to build a list of initial contributions
- We also want to look at the begin event, as it can contain a unique contribution

*/
