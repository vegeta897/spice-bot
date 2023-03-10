import { DateTime, Duration } from 'luxon'

export const DEV_MODE = process.env.NODE_ENV === 'development'
export const CHAT_TEST_MODE = process.env.CHAT_TEST_MODE === 'true'

export const HOST_URL = DEV_MODE
	? `http://localhost:${process.env.EXPRESS_PORT}`
	: `https://${process.env.EXPRESS_HOSTNAME}`

export const sleep = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms))

export const timestamp = () =>
	DateTime.now().setZone('America/New_York').toFormat('yyyy-MM-dd, tt ZZZZ')

export const timestampLog = (message?: any, ...optionalParams: any[]) => {
	console.log(timestamp(), message, ...optionalParams)
}

export const formatDuration = (seconds: number) =>
	Duration.fromMillis(seconds * 1000).toFormat(
		seconds >= 60 * 60 ? 'h:mm:ss' : 'm:ss'
	)

// Sort an array of objects by the specified prop key
export const sortByProp = <T>(arr: T[], prop: keyof T, reverse = false) =>
	arr.sort((a, b) => (a[prop] > b[prop] ? 1 : -1) * (reverse ? -1 : 1))

export const compareArrays = (first: unknown[], second: unknown[]) => {
	const extra = first.filter((el) => !second.includes(el))
	const missing = second.filter((el) => !first.includes(el))
	return {
		extra,
		missing,
		bothHave: first.filter((el) => second.includes(el)),
		bothHaveAll: extra.length + missing.length === 0,
	}
}

// https://stackoverflow.com/a/59700012/2612679
export type DeepReadonly<T> = T extends Function // eslint-disable-line @typescript-eslint/ban-types
	? T
	: T extends object
	? { readonly [K in keyof T]: DeepReadonly<T[K]> }
	: T

export type MaybeReadonly<T> = T | DeepReadonly<T>
