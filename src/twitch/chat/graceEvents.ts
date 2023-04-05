import Emittery from 'emittery'
import { GraceStats } from './graceStats.js'

type TrainBaseEvent = { id: number; combo: number; score: number }

export const GraceTrainEvents = new Emittery<{
	start: TrainBaseEvent & { colors: string[] }
	grace: TrainBaseEvent & { color: string }
	end: TrainBaseEvent & { username: string }
}>()

export function sendTrainStartEvent(graceStats: GraceStats) {
	GraceTrainEvents.emit('start', {
		...getBaseEvent(graceStats),
		colors: graceStats.graces.map((g) => g.user.color),
	})
}

export function sendTrainAddEvent(graceStats: GraceStats) {
	GraceTrainEvents.emit('grace', {
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

const getBaseEvent = (graceStats: GraceStats): TrainBaseEvent => ({
	id: graceStats.id,
	combo: graceStats.totalCombo,
	score: graceStats.finalScore || graceStats.runningTotalScore,
})
