import type {
	EventSubChannelHypeTrainBeginEvent,
	EventSubChannelHypeTrainContribution,
	EventSubChannelHypeTrainEndEvent,
	EventSubChannelHypeTrainProgressEvent,
} from '@twurple/eventsub-base'
import Emittery from 'emittery'
import { DEV_MODE, timestampLog } from '../../util.js'
import { HypeTrainData, addToHypeTrain, endHypeTrain } from './trains.js'
import { getUserColor } from './userColors.js'

export const HypeEvents = new Emittery<{
	begin: EventSubChannelHypeTrainBeginEvent
	progress: EventSubChannelHypeTrainProgressEvent
	end: EventSubChannelHypeTrainEndEvent
}>()

type HypeStats = { id: string } & HypeTrainData

let hypeStats: HypeStats | null = null
let endedHypeTrainID: string | null = null

HypeEvents.on('begin', (event) => {
	timestampLog(
		`Hype Train ID ${event.id} begin!
Goal: ${event.goal}
Level: ${event.level}
Progress: ${event.progress}
Total: ${event.total}
Top Contribs: ${listHypeContributions(event.topContributors)}`
	)
	// Ignore this event, because the first progress event will start the train
})

HypeEvents.on('progress', (event) => {
	timestampLog(`Hype Train ID ${event.id} progress
Goal: ${event.goal}
Level: ${event.level}
Progress: ${event.progress}
Total: ${event.total}
Last Contrib: ${formatHypeContribution(event.lastContribution)}
Top Contribs: ${listHypeContributions(event.topContributors)}`)
	if (!DEV_MODE) return // TODO: Remove
	if (event.id === endedHypeTrainID) {
		timestampLog('Ignoring hype train progress event for ended train')
		return
	}
	hypeStats ||= createHypeStats(event.id)
	if (!eventStatsAreOutdated(event)) {
		hypeStats.level = event.level
		hypeStats.total = event.total
		hypeStats.progress = event.progress
		hypeStats.goal = event.goal
	}
	if (
		event.lastContribution.type !== 'bits' ||
		event.lastContribution.total >= 100
	) {
		const contribution = createHypeContribution(event.lastContribution)
		hypeStats.contributions.push(contribution)
		addToHypeTrain({ ...hypeStats, contribution })
	} else {
		// Do not include cheers less than 100 bits in the contributions
		addToHypeTrain(hypeStats)
	}
})

HypeEvents.on('end', (event) => {
	timestampLog(`Hype Train ID ${event.id} end!
Level: ${event.level}
Total: ${event.total}
Top Contribs: ${listHypeContributions(event.topContributors)}`)
	if (!DEV_MODE) return // TODO: Remove
	if (!hypeStats) return
	hypeStats.level = event.level
	hypeStats.total = event.total
	endHypeTrain(hypeStats)
	endedHypeTrainID = hypeStats.id
	hypeStats = null
})

function createHypeStats(id: string) {
	return { id, level: 0, total: 0, progress: 0, goal: 0, contributions: [] }
}

function createHypeContribution(
	lastContribution: EventSubChannelHypeTrainProgressEvent['lastContribution']
): HypeTrainData['contributions'][number] {
	const type = lastContribution.type === 'subscription' ? 'subs' : 'bits'
	let amount = lastContribution.total
	// In case subs are a # of subs instead of the bits equivalent
	if (type === 'subs' && amount < 500) amount *= 500
	const color = getUserColor(lastContribution.userId)
	return { type, amount, color }
}

function eventStatsAreOutdated(event: EventSubChannelHypeTrainProgressEvent) {
	if (!hypeStats) return false
	return event.total < hypeStats.total
}

export const getCurrentHypeTrain = () => hypeStats

const listHypeContributions = (
	contributions: EventSubChannelHypeTrainContribution[]
) => contributions.map(formatHypeContribution).join(', ')

const formatHypeContribution = ({
	userDisplayName,
	type,
	total,
}: EventSubChannelHypeTrainContribution) =>
	`${userDisplayName}:${type}:${total}`

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

*/
