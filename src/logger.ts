import { DateTime } from 'luxon'

export const timestamp = () =>
	DateTime.now().setZone('America/New_York').toFormat('yyyy-MM-dd, tt ZZZZ')

export const timestampLog = (message?: any, ...optionalParams: any[]) => {
	console.log(timestamp(), message, ...optionalParams)
}
