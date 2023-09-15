import Emittery from 'emittery'
import {
	breakGraceTrain,
	getCurrentGraceTrain,
	hypeGraceTrain,
} from './graceStats.js'
import { getCurrentHypeTrain, setHypeStatsGraces } from './hype.js'
import type { GraceEventBaseData } from 'grace-train-lib/trains'

type HypeEventBaseData = {
	level: number
	total: number
	progress: number
	goal: number
	graces: number
}
type GraceTrainData = {
	grace: GraceEventBaseData & { colors: string[]; frog?: boolean }
}
type GraceTrainAddData = { grace: GraceEventBaseData & { color: string } }
type GraceTrainEndData = { grace: GraceEventBaseData & { username: string } }
export type HypeTrainData = {
	hype: HypeEventBaseData & { contributions: HypeProgress[] }
}
export type HypeProgress = {
	type: 'bits' | 'subs'
	amount: number
	color: string
}
type HypeTrainAddData = {
	hype: HypeEventBaseData & { contribution?: HypeProgress }
}
type HypeTrainEndData = { hype: Omit<HypeEventBaseData, 'progress' | 'goal'> }

type ID = { id: number }
export type TrainStartData = ID & (GraceTrainData | HypeTrainData)
export type TrainAddData = ID & (GraceTrainAddData | HypeTrainAddData)
export type TrainEndData = ID & (GraceTrainEndData | HypeTrainEndData)
export type OverlayData = { position: 'top' | 'bottom' }

export const TrainEvents = new Emittery<{
	start: TrainStartData
	add: TrainAddData
	end: TrainEndData
	overlay: OverlayData
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
