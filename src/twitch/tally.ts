import { ChatEvents, sendChatMessage } from './twitchChat.js'
import { TwitchEvents } from './eventSub.js'

type Message = { text: string; date: Date; userID: string }
const recentMessages: Message[] = []
const TTL = 3 * 60 * 1000

export function initTally() {
	ChatEvents.on('message', ({ text, date, userID, mod }) => {
		if (text.toLowerCase() === '!tally' && mod) {
			tallyUp()
			return
		}
		if (text.startsWith('!')) return // Ignore other commands
		recentMessages.unshift({ text, date, userID })
		const now = Date.now()
		for (let i = 0; i < recentMessages.length; i++) {
			const msg = recentMessages[i]
			if (msg.date.getTime() + TTL < now) {
				recentMessages.length = i
				break
			}
		}
	})
	TwitchEvents.on('streamOnline', () => {
		recentMessages.length = 0
	})
}

let commandLastUsed = new Date(0)
const COOLDOWN = 10 * 1000

export function tallyUp() {
	const now = new Date()
	if (now.getTime() - commandLastUsed.getTime() < COOLDOWN) return
	commandLastUsed = now
	let prevMsg: Message | undefined
	const options: Record<string, Set<string>> = {}
	for (const msg of recentMessages) {
		if (prevMsg) {
			const gap = prevMsg.date.getTime() - msg.date.getTime()
			// Stop going back if there was a 1+ minute gap between messages
			if (gap > 60 * 1000) break
		}
		prevMsg = msg
		let text = msg.text.toLowerCase().replace(/[,\.!?]/g, '')
		// Check first word
		const firsts = [...'123456', 'one', 'two', 'three', 'four', 'five', 'six']
		for (const firstWord of firsts) {
			if (text.split(' ')[0] === firstWord) {
				text = firstWord
				break
			}
		}
		// Change written numbers to digits
		if (text === 'one') text = '1'
		if (text === 'two') text = '2'
		if (text === 'three') text = '3'
		if (text === 'four') text = '4'
		if (text === 'five') text = '5'
		if (text === 'six') text = '6'
		// Consolidate repeated digits or letters
		for (const singleChar of '123456abcde') {
			const regex = new RegExp(`^${singleChar}+$`)
			if (regex.test(text.replace(/ /g, ''))) {
				text = singleChar
				break
			}
		}
		if (!options[text]) options[text] = new Set()
		options[text].add(msg.userID)
	}
	const winners: { name: string; votes: number }[] = []
	Object.entries(options).forEach(([name, users]) => {
		const votes = users.size
		if (votes === 1) return
		if (votes > winners[0]?.votes) winners.length = 0
		if (winners.length === 0 || winners[0].votes === votes) {
			winners.push({ name, votes })
		}
	})
	if (winners.length === 0) {
		sendChatMessage("Sorry, can't find anything to tally!")
		return // Early return so recent messages aren't cleared
	} else if (winners.length === 1) {
		sendChatMessage(`"${winners[0].name}" won with ${winners[0].votes} votes!`)
	} else {
		// Multiple winners
		const [lastWinner, ...firstWinners] = winners
			.sort()
			.map((w) => `"${w.name}"`)
			.reverse()
		const firstWinnersList = firstWinners.reverse().join(', ')
		sendChatMessage(`It's a tie between ${firstWinnersList} and ${lastWinner}`)
	}
	recentMessages.length = 0
}
