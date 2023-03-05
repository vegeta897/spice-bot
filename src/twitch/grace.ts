import { getData, modifyData } from '../db.js'
import { getBotSub } from './twitchApi.js'
import {
	botInChat,
	ChatEvents,
	PRAYBEE,
	sendChatMessage,
} from './twitchChat.js'

type Grace = { date: Date }

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
		if (event.title !== 'GRACE') return
		if (!botInChat) return
		train.push({ date: event.date })
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
		const exclamations = '!'.repeat(Math.ceil(trainLength / 5))
		message += `, a NEW RECORD${exclamations}`
		if (await getBotSub()) message += ` ${PRAYBEE}`
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
