import Emittery from 'emittery'
import { getCurrentGraceTrain } from './graceStats.js'
import { RequireAtLeastOne } from '../../util.js'
import { getCurrentHypeTrain } from './hype.js'

type ID = { id: number }
type GraceEventBaseData = {
	combo: number
	score: number
}
type HypeEventBaseData = {
	totalBits: number
	totalSubs: number
}
type HypeProgress = { type: 'bits' | 'subs'; amount: number; color: string }

type GraceTrainData = GraceEventBaseData & { colors: string[] }
type GraceTrainAddData = GraceEventBaseData & { color: string }
type GraceTrainEndData = GraceEventBaseData & { username: string }
type HypeTrainData = HypeEventBaseData & { contributions: HypeProgress[] }
type HypeTrainAddData = HypeEventBaseData & { contribution: HypeProgress }

export type TrainStartData = ID &
	RequireAtLeastOne<{ grace: GraceTrainData; hype: HypeTrainData }>
export type TrainAddData = ID &
	RequireAtLeastOne<{ grace: GraceTrainAddData; hype: HypeTrainAddData }>
export type TrainEndData = ID &
	RequireAtLeastOne<{ grace: GraceTrainEndData; hype: HypeEventBaseData }>
export type OverlayData = { position: 'top' | 'bottom' }

export const TrainEvents = new Emittery<{
	start: TrainStartData
	add: TrainAddData
	end: TrainEndData
	overlay: OverlayData
}>()

let currentTrainID: number | null = null

export function startGraceTrain(grace: GraceTrainData) {
	if (!currentTrainID) currentTrainID = Date.now()
	TrainEvents.emit('start', { id: currentTrainID, grace })
}

export function addToGraceTrain(grace: GraceTrainAddData) {
	if (!currentTrainID) throw 'Trying to add to non-existent train!'
	TrainEvents.emit('add', { id: currentTrainID, grace })
}

export function endGraceTrain(grace: GraceTrainEndData) {
	if (!currentTrainID) return
	if (getCurrentHypeTrain()) return // Is this necessary?
	TrainEvents.emit('end', { id: currentTrainID, grace })
	currentTrainID = null
}

export function getCurrentTrain() {
	if (!currentTrainID) return false
	const currentTrain: Partial<TrainStartData> = {
		id: currentTrainID,
	}
	const grace = getCurrentGraceTrain()
	if (grace) currentTrain.grace = grace
	const hype = getCurrentHypeTrain()
	if (hype) currentTrain.hype = hype
	return currentTrain as TrainStartData
}
