import { getData, modifyData } from '../../db.js'
import { getEmoteByName, getUsableEmotes, Emotes } from './emotes.js'
import { botInChat, ChatEvents, sendChatMessage } from './twitchChat.js'

type Grace = { date: Date; userID: string }

export const GRACE = 'GRACE'

const train: Grace[] = []

export function initGrace() {
	ChatEvents.on('message', (event) => {
		if (event.msg.isHighlight && isGraceText(event.text)) {
			addGrace(event.date, event.userID)
			return
		}
		if (train.length === 0) return
		for (let i = train.length - 1; i >= 0; i--) {
			if (train[i].date < event.date) {
				if (i < train.length - 2) train.splice(i, train.length - i)
				endGraceTrain(event.msg.userInfo.displayName)
				break
			}
		}
	})
	ChatEvents.on('redemption', (event) => {
		if (botInChat()) addGrace(event.date, event.userID)
	})
}

function addGrace(date: Date, userID: string) {
	// Only add to train if it's a different user than the last grace
	if (train.at(-1)?.userID !== userID) {
		train.push({ date, userID })
	}
}

function isGraceText(text: string) {
	return text
		.toLowerCase()
		.replace(/ /g, '')
		.replace('classic', '')
		.replace(new RegExp(Emotes.PRAYBEE, 'g'), '')
		.replace(/old?school/g, '')
		.startsWith('grace')
}

async function endGraceTrain(endUser: string) {
	const trainLength = train.length
	train.length = 0
	if (trainLength < 5) return
	const longestTrain = getData().twichGraceTrainRecord
	let message = `Grace train ended by ${endUser}! That was ${trainLength} graces`
	if (trainLength > longestTrain) {
		// New longest train!
		message += `, a NEW RECORD!`
		if (getEmoteByName(Emotes.PRAYBEE, await getUsableEmotes())) {
			const prayBees = ` ${Emotes.PRAYBEE}`.repeat(Math.ceil(trainLength / 5))
			message += prayBees
		}
		modifyData({ twichGraceTrainRecord: trainLength })
	} else if (trainLength === longestTrain) {
		// Equal to longest train
		message += `, tying the record!`
	} else {
		// Shorter than longest train
		message += '!'
	}
	sendChatMessage(message)
}
