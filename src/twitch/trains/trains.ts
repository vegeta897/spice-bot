import Emittery from 'emittery'
import {
	breakGraceTrain,
	getCurrentGraceTrain,
	hypeGraceTrain,
} from './graceStats.js'
import { getCurrentHypeTrain, setHypeStatsGraces } from './hype.js'
import type {
	HideUser,
	HypeTrainAddData,
	HypeTrainData,
	HypeTrainEndData,
	OverlayOptions,
	TrainAddData,
	TrainEndData,
	TrainStartData,
} from 'grace-train-lib/data'
import { timestampLog } from '../../logger.js'

export const TrainEvents = new Emittery<{
	start: TrainStartData
	add: TrainAddData
	end: TrainEndData
	overlay: OverlayOptions
	hideUser: HideUser
}>()

// TODO: Emote train, show emote images as cars, allow any abby channel emote
// Multiple emotes in one message stack up like boxes, dynamically

let currentHypeTrainId: number | null = null

export async function startHypeTrain(hype: HypeTrainData['hype']) {
	const startData: HypeTrainData = { hype }
	const currentGraceTrain = await getCurrentGraceTrain()
	currentHypeTrainId = Date.now()
	if (currentGraceTrain) {
		currentHypeTrainId = currentGraceTrain.id
		startData.hype.graces = currentGraceTrain.grace.combo
		hypeGraceTrain()
		setHypeStatsGraces(currentGraceTrain.grace.combo)
	}
	TrainEvents.emit('start', { id: currentHypeTrainId, ...startData })
}

export function addToHypeTrain(hype: HypeTrainAddData['hype']) {
	if (!currentHypeTrainId) {
		timestampLog('Trying to add hype to non-existent train!', hype)
	} else {
		TrainEvents.emit('add', { id: currentHypeTrainId, hype })
	}
}

export function endHypeTrain(hype: HypeTrainEndData['hype']) {
	if (!currentHypeTrainId) return
	breakGraceTrain('HYPE TRAIN')
	TrainEvents.emit('end', { id: currentHypeTrainId, hype })
	currentHypeTrainId = null
}

export async function getCurrentTrain() {
	const hype = getCurrentHypeTrain()
	if (hype && currentHypeTrainId) {
		return { id: currentHypeTrainId, hype } as TrainStartData
	}
	const currentGraceTrain = await getCurrentGraceTrain()
	if (currentGraceTrain) return currentGraceTrain
	return false
}
