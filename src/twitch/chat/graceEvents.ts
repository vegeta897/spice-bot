import Emittery from 'emittery'
import { GraceStats } from './graceStats.js'

type TrainEventBaseData = { id: number; combo: number; score: number }
export type TrainStartData = TrainEventBaseData & { colors: string[] }
export type TrainAddData = TrainEventBaseData & { color: string }
export type TrainEndData = TrainEventBaseData & { username: string }

export const GraceTrainEvents = new Emittery<{
	start: TrainStartData
	add: TrainAddData
	end: TrainEndData
}>()

export function sendTrainStartEvent(graceStats: GraceStats) {
	GraceTrainEvents.emit('start', {
		...getBaseEvent(graceStats),
		colors: graceStats.graces.map((g) => g.user.color),
	})
}

export function sendTrainAddEvent(graceStats: GraceStats) {
	GraceTrainEvents.emit('add', {
		...getBaseEvent(graceStats),
		color: graceStats.graces.at(-1)!.user.color,
	})
}

export function sendTrainEndEvent(graceStats: GraceStats) {
	GraceTrainEvents.emit('end', {
		...getBaseEvent(graceStats),
		username: graceStats.endUsername!,
	})
}

const getBaseEvent = (graceStats: GraceStats): TrainEventBaseData => ({
	id: graceStats.id,
	combo: graceStats.totalCombo,
	score: graceStats.finalScore || graceStats.runningTotalScore,
})
