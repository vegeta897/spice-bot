import {
	getEmoteByName,
	getUsableEmotes,
	POGGERS,
	PRAYBEE,
	SOGGERS,
} from './emotes.js'
import { GRACE } from './grace.js'
import { ChatEvents, sendChatMessage } from './twitchChat.js'
import { TwitchEvents } from './eventSub.js'
import { getData, modifyData } from '../db.js'
import { DEV_MODE } from '../util.js'

let emoteCounts: Map<string, number>
let redeemCounts: Map<string, number>

export function initRecap() {
	emoteCounts = new Map(getData().emoteCounts)
	redeemCounts = new Map(getData().redeemCounts)
	if (DEV_MODE) clearCounts()
	ChatEvents.on('message', (event) => {
		if (event.text.toLowerCase() === '!recap' && event.mod) {
			sendRecap()
			return
		}
		event.msg.parseEmotes().forEach((msgPart) => {
			if (msgPart.type !== 'emote') return
			// Only count channel emotes
			if (getEmoteByName(msgPart.name)) {
				emoteCounts.set(msgPart.name, (emoteCounts.get(msgPart.name) || 0) + 1)
			}
		})
		modifyData({ emoteCounts: [...emoteCounts.entries()] })
	})
	ChatEvents.on('redemption', (event) => {
		redeemCounts.set(event.title, (redeemCounts.get(event.title) || 0) + 1)
		modifyData({ redeemCounts: [...redeemCounts.entries()] })
	})
	TwitchEvents.on('streamOnline', () => clearCounts())
}

function clearCounts() {
	emoteCounts.clear()
	redeemCounts.clear()
	modifyData({ emoteCounts: [] })
	modifyData({ redeemCounts: [] })
}

let commandLastUsed = new Date(0)
const COOLDOWN = 10 * 1000

export async function sendRecap() {
	const now = new Date()
	if (now.getTime() - commandLastUsed.getTime() < COOLDOWN) return
	commandLastUsed = now
	sendChatMessage(`STREAM RECAP!`)
	const usableEmotes = await getUsableEmotes()
	const canPoggers = getEmoteByName(POGGERS, usableEmotes)
	const [mostUsedEmoteName, mostUsedEmoteTimes] = [
		...emoteCounts.entries(),
	].reduce((prev, curr) => (curr[1] > prev[1] ? curr : prev), ['', 0])
	if (mostUsedEmoteName)
		sendChatMessage(
			`Most used emote: ${mostUsedEmoteName} x ${mostUsedEmoteTimes}`
		)
	const pogCount = emoteCounts.get(POGGERS) || 0
	const sogCount = emoteCounts.get(SOGGERS) || 0
	if (pogCount > 0 || sogCount > 0) {
		let pogSogRatioMessage = `Pog/Sog ratio: ${pogCount}:${sogCount}`
		if (canPoggers) {
			if (pogCount > sogCount) pogSogRatioMessage += ` ${POGGERS}`
			if (pogCount < sogCount) pogSogRatioMessage += ` ${SOGGERS}`
		}
		sendChatMessage(pogSogRatioMessage)
	}
	const graces = redeemCounts.get(GRACE) || 0
	if (graces > 0)
		sendChatMessage(
			`GRACE count: ${graces} ${
				getEmoteByName(PRAYBEE, usableEmotes) ? PRAYBEE : ''
			}`
		)
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
