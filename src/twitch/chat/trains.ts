import Emittery from 'emittery'
import { breakGraceTrain, getCurrentGraceTrain } from './graceStats.js'
import { RequireAtLeastOne } from '../../util.js'
import { getCurrentHypeTrain } from './hype.js'

type ID = { id: number }
type GraceEventBaseData = {
	combo: number
	score: number
}
type HypeEventBaseData = {
	level: number
	total: number
	progress: number
	goal: number
}
type HypeProgress = { type: 'bits' | 'subs'; amount: number; color: string }

type GraceTrainData = GraceEventBaseData & { colors: string[] }
type GraceTrainAddData = GraceEventBaseData & { color: string }
type GraceTrainEndData = GraceEventBaseData & { username: string }
export type HypeTrainData = HypeEventBaseData & {
	contributions: HypeProgress[]
}
type HypeTrainAddData = HypeEventBaseData & { contribution?: HypeProgress }
type HypeTrainEndData = Omit<HypeEventBaseData, 'progress' | 'goal'>

export type TrainStartData = ID &
	RequireAtLeastOne<{ grace: GraceTrainData; hype: HypeTrainData }>
export type TrainAddData = ID &
	RequireAtLeastOne<{ grace: GraceTrainAddData; hype: HypeTrainAddData }>
export type TrainEndData = ID &
	RequireAtLeastOne<{ grace: GraceTrainEndData; hype: HypeTrainEndData }>
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
	if (!currentTrainID) throw 'Trying to add grace to non-existent train!'
	TrainEvents.emit('add', { id: currentTrainID, grace })
}

export function endGraceTrain(grace: GraceTrainEndData) {
	if (!currentTrainID) return
	if (getCurrentHypeTrain()) return // Is this necessary?
	TrainEvents.emit('end', { id: currentTrainID, grace })
	currentTrainID = null
}

export function startHypeTrain(hype: HypeTrainData) {
	if (!currentTrainID) currentTrainID = Date.now()
	else breakGraceTrain('HYPE TRAIN')
	TrainEvents.emit('start', { id: currentTrainID, hype })
}

export function addToHypeTrain(hype: HypeTrainAddData) {
	if (!currentTrainID) throw 'Trying to add hype to non-existent train!'
	TrainEvents.emit('add', { id: currentTrainID, hype })
}

export function endHypeTrain(hype: HypeTrainEndData) {
	if (!currentTrainID) return
	TrainEvents.emit('end', { id: currentTrainID, hype })
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
