import { getData, modifyData } from '../db.js'
import { getEmoteByName, getUsableEmotes, PRAYBEE } from './emotes.js'
import { botInChat, ChatEvents, sendChatMessage } from './twitchChat.js'

type Grace = { date: Date; userID: string }

export const GRACE = 'GRACE'

const train: Grace[] = []

export function initGrace() {
	ChatEvents.on('message', (event) => {
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
		if (event.title !== GRACE) return
		if (!botInChat) return
		// Only add to train if it's a different user than the last grace
		if (train.at(-1)?.userID !== event.userID) {
			train.push({ date: event.date, userID: event.userID })
		}
	})
}

async function endGraceTrain(endUser: string) {
	const trainLength = train.length
	train.length = 0
	if (trainLength < 3) return
	const longestTrain = getData().twichGraceTrainRecord
	let message = `Grace train ended by ${endUser}! That was ${trainLength} graces`
	if (trainLength > longestTrain) {
		// New longest train!
		message += `, a NEW RECORD!`
		if (getEmoteByName(PRAYBEE, await getUsableEmotes())) {
			const prayBees = ` ${PRAYBEE}`.repeat(Math.ceil(trainLength / 5))
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
