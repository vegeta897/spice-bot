import { getData, modifyData } from '../db.js'
import { sortByProp } from '../util.js'

export type SkeetRecord = {
	skeet_id: string
	recorded_time: number
	message_id: string
	pingButtons?: 'posted' | 'cleaned'
}

export const RECORD_LIMIT = 20

export const getSkeetRecords = () =>
	getData().skeets.map((tr) => ({ ...tr })) as SkeetRecord[]

export function recordSkeet({
	messageID,
	skeetID,
	pingButtons,
}: {
	messageID: string
	skeetID: string
	pingButtons?: boolean
}) {
	const skeetRecord: SkeetRecord = {
		skeet_id: skeetID,
		message_id: messageID,
		recorded_time: Date.now(),
	}
	if (pingButtons) skeetRecord.pingButtons = 'posted'
	const skeets = [...getData().skeets, skeetRecord]
	const sortedSkeets = sortByProp(skeets, 'skeet_id').slice(-RECORD_LIMIT)
	modifyData({ skeets: sortedSkeets })
	return { ...skeetRecord }
}

export function updateSkeetRecord(skeetRecord: SkeetRecord) {
	const skeetRecords = getSkeetRecords()
	const existingRecord = skeetRecords.find(
		(tr) => tr.skeet_id === skeetRecord.skeet_id
	)
	if (!existingRecord)
		throw `Trying to update non-existent skeet record ID ${skeetRecord.skeet_id}`
	const existingRecordIndex = skeetRecords.indexOf(existingRecord)
	skeetRecords.splice(existingRecordIndex, 1, skeetRecord)
	modifyData({ skeets: skeetRecords })
}

export function deleteSkeetRecord(skeetRecord: SkeetRecord) {
	modifyData({
		skeets: getData().skeets.filter(
			(tr) => tr.skeet_id !== skeetRecord.skeet_id
		),
	})
}
