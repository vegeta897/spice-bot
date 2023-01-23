import { DateTime, Duration } from 'luxon'

export const sleep = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms))

export const DEV_MODE = process.env.NODE_ENV === 'development'

export const timestamp = () => DateTime.now().toFormat('yyyy-MM-dd, tt')

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

// https://stackoverflow.com/a/59700012/2612679
export type DeepReadonly<T> = T extends Function // eslint-disable-line @typescript-eslint/ban-types
	? T
	: T extends object
	? { readonly [K in keyof T]: DeepReadonly<T[K]> }
	: T
