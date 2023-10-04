import Emittery from 'emittery'
import {
	breakGraceTrain,
	getCurrentGraceTrain,
	hypeGraceTrain,
} from './graceStats.js'
import { getCurrentHypeTrain, setHypeStatsGraces } from './hype.js'
import type {
	GraceTrainAddData,
	GraceTrainData,
	GraceTrainEndData,
	HypeTrainAddData,
	HypeTrainData,
	HypeTrainEndData,
	OverlayOptions,
	TrainAddData,
	TrainEndData,
	TrainStartData,
} from 'grace-train-lib/trains'

export const TrainEvents = new Emittery<{
	start: TrainStartData
	add: TrainAddData
	end: TrainEndData
	overlay: OverlayOptions
}>()

let currentTrainID: number | null = null

export function startGraceTrain(grace: GraceTrainData['grace']) {
	if (!currentTrainID) currentTrainID = Date.now()
	TrainEvents.emit('start', { id: currentTrainID, grace })
}

export function addToGraceTrain(grace: GraceTrainAddData['grace']) {
	if (!currentTrainID) throw 'Trying to add grace to non-existent train!'
	TrainEvents.emit('add', { id: currentTrainID, grace })
}

export function endGraceTrain(grace: GraceTrainEndData['grace']) {
	if (!currentTrainID) return
	TrainEvents.emit('end', { id: currentTrainID, grace })
	currentTrainID = null
}

export async function startHypeTrain(hype: HypeTrainData['hype']) {
	const startData: HypeTrainData = { hype }
	const currentGraceTrain = await getCurrentGraceTrain()
	if (currentGraceTrain) {
		startData.hype.graces = currentGraceTrain.combo
		hypeGraceTrain()
		setHypeStatsGraces(currentGraceTrain.combo)
	}
	currentTrainID = Date.now()
	TrainEvents.emit('start', { id: currentTrainID, ...startData })
}

export function addToHypeTrain(hype: HypeTrainAddData['hype']) {
	if (!currentTrainID) throw 'Trying to add hype to non-existent train!'
	TrainEvents.emit('add', { id: currentTrainID, hype })
}

export function endHypeTrain(hype: HypeTrainEndData['hype']) {
	if (!currentTrainID) return
	breakGraceTrain('HYPE TRAIN')
	TrainEvents.emit('end', { id: currentTrainID, hype })
	currentTrainID = null
}

export async function getCurrentTrain() {
	if (!currentTrainID) return false
	const hype = getCurrentHypeTrain()
	if (hype) {
		return { id: currentTrainID, hype } as TrainStartData
	}
	const currentGraceTrain = await getCurrentGraceTrain()
	if (currentGraceTrain) {
		return { id: currentTrainID, grace: currentGraceTrain } as TrainStartData
	}
	return false
}
