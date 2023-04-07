import Emittery from 'emittery'
import { GraceStats } from './graceStats.js'

type TrainEventBaseData = { id: number; combo: number; score: number }
export type TrainStartData = TrainEventBaseData & { colors: string[] }
export type TrainAddData = TrainEventBaseData & { color: string }
export type TrainEndData = TrainEventBaseData & { username: string }
export type OverlayData = { position: 'top' | 'bottom' }

export const GraceTrainEvents = new Emittery<{
	start: TrainStartData
	add: TrainAddData
	end: TrainEndData
	overlay: OverlayData
}>()

export function sendTrainStartEvent(graceStats: GraceStats) {
	GraceTrainEvents.emit('start', createTrainStartEvent(graceStats))
}

export function sendTrainAddEvent(graceStats: GraceStats) {
	GraceTrainEvents.emit('add', {
		...createBaseEvent(graceStats),
		color: graceStats.graces.at(-1)!.user.color,
	})
}

export function sendTrainEndEvent(graceStats: GraceStats, username: string) {
	GraceTrainEvents.emit('end', { ...createBaseEvent(graceStats), username })
}

export const createTrainStartEvent = (graceStats: GraceStats) => ({
	...createBaseEvent(graceStats),
	colors: graceStats.graces.map((g) => g.user.color),
})

const createBaseEvent = (graceStats: GraceStats): TrainEventBaseData => ({
	id: graceStats.id,
	combo: graceStats.totalCombo,
	score: graceStats.finalScore || graceStats.runningTotalScore,
})
