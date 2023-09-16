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

export function startHypeTrain(hype: HypeTrainData['hype']) {
	const startData: HypeTrainData = { hype }
	const currentGrace = getCurrentGraceTrain()
	if (currentGrace) {
		startData.hype.graces = currentGrace.combo
		hypeGraceTrain()
		setHypeStatsGraces(currentGrace.combo)
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

export function getCurrentTrain() {
	if (!currentTrainID) return false
	const hype = getCurrentHypeTrain()
	if (hype) {
		return { id: currentTrainID, hype } as TrainStartData
	}
	const grace = getCurrentGraceTrain()
	if (grace) {
		return { id: currentTrainID, grace } as TrainStartData
	}
	return false
}
