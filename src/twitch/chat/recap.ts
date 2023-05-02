import { getEmoteByName, getUsableEmotes, Emotes } from './emotes.js'
import { GRACE } from './grace.js'
import { ChatEvents, sendChatMessage } from './twitchChat.js'
import { TwitchEvents } from '../eventSub.js'
import { getData, modifyData } from '../../db.js'
import { DEV_MODE } from '../../util.js'
import { parseChatMessage } from '@twurple/common'
import { TrainEvents } from './trains.js'

let emoteCounts: Map<string, number>
let redeemCounts: Map<string, number>
let graceTrainCount = 0

export function initRecap() {
	const recapData = getData().streamRecap
	emoteCounts = new Map(recapData.emoteCounts)
	redeemCounts = new Map(recapData.redeemCounts)
	graceTrainCount = recapData.graceTrainCount
	if (DEV_MODE) clearCounts()
	ChatEvents.on('message', (event) => {
		if (event.text.toLowerCase() === '!recap' && event.mod) {
			sendRecap()
			return
		}
		if (event.text.startsWith('!')) return // Ignore other commands
		parseChatMessage(event.text, event.msg.emoteOffsets).forEach((msgPart) => {
			if (msgPart.type !== 'emote') return
			// Only count channel emotes
			if (getEmoteByName(msgPart.name)) {
				emoteCounts.set(msgPart.name, (emoteCounts.get(msgPart.name) || 0) + 1)
			}
		})
		saveCounts()
	})
	ChatEvents.on('redemption', (event) => {
		redeemCounts.set(event.title, (redeemCounts.get(event.title) || 0) + 1)
		saveCounts()
	})
	TrainEvents.on('start', () => {
		graceTrainCount++
		saveCounts()
	})
	TwitchEvents.on('streamOnline', ({ downtime }) => {
		if (downtime > 10 * 60 * 1000) clearCounts()
	})
}

function saveCounts() {
	modifyData({
		streamRecap: {
			emoteCounts: [...emoteCounts.entries()],
			redeemCounts: [...redeemCounts.entries()],
			graceTrainCount,
		},
	})
}

function clearCounts() {
	emoteCounts.clear()
	redeemCounts.clear()
	graceTrainCount = 0
	saveCounts()
}

let commandLastUsed = 0
const COOLDOWN = 10 * 1000

export async function sendRecap() {
	const now = Date.now()
	if (now - commandLastUsed < COOLDOWN) return
	commandLastUsed = now
	sendChatMessage(`STREAM RECAP!`)
	const usableEmotes = await getUsableEmotes()
	console.log(usableEmotes)
	const canPoggers = getEmoteByName(Emotes.POGGERS, usableEmotes)
	const [mostUsedEmoteName, mostUsedEmoteTimes] = [
		...emoteCounts.entries(),
	].reduce((prev, curr) => (curr[1] > prev[1] ? curr : prev), ['', 0])
	if (mostUsedEmoteName)
		sendChatMessage(
			`Most used emote: ${mostUsedEmoteName} x ${mostUsedEmoteTimes}`
		)
	const pogCount = emoteCounts.get(Emotes.POGGERS) || 0
	const sogCount = emoteCounts.get(Emotes.SOGGERS) || 0
	if (pogCount > 0 || sogCount > 0) {
		let pogSogRatioMessage = `Pog/Sog ratio: ${pogCount}:${sogCount}`
		if (canPoggers) {
			if (pogCount > sogCount) pogSogRatioMessage += ` ${Emotes.POGGERS}`
			if (pogCount < sogCount) pogSogRatioMessage += ` ${Emotes.SOGGERS}`
		}
		sendChatMessage(pogSogRatioMessage)
	}
	const graces = redeemCounts.get(GRACE) || 0
	if (graces > 0) {
		let graceMessage = `GRACE count: ${graces} `
		if (graceTrainCount > 1) graceMessage += `(${graceTrainCount} trains!) `
		if (getEmoteByName(Emotes.PRAYBEE, usableEmotes))
			graceMessage += Emotes.PRAYBEE
		sendChatMessage(graceMessage)
	}
	const hydroChecks = redeemCounts.get('Hydration Check!') || 0
	if (hydroChecks > 0)
		sendChatMessage(
			`Hydration checks: ${hydroChecks}${
				getEmoteByName('ybbaaaJug', usableEmotes)
					? ' ybbaaaJug'.repeat(hydroChecks)
					: ''
			}`
		)
	const stretchChecks = redeemCounts.get('Stretch Check') || 0
	if (stretchChecks > 0) sendChatMessage(`Stretch checks: ${stretchChecks}`)
}
