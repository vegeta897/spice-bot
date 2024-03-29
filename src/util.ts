import { Duration } from 'luxon'

export const DEV_MODE = process.env.NODE_ENV === 'development'
export const CHAT_TEST_MODE = process.env.CHAT_TEST_MODE === 'true'

export const HOST_URL = DEV_MODE
	? `http://localhost:${process.env.EXPRESS_PORT}`
	: `https://${process.env.EXPRESS_HOSTNAME}`

export const sleep = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms))

export const formatDuration = (ms: number) =>
	Duration.fromMillis(ms).toFormat(ms >= 60 * 60 * 1000 ? 'h:mm:ss' : 'm:ss')

// Sort an array of objects by the specified prop key
export const sortByProp = <T, K extends keyof T>(
	arr: T[],
	prop: K,
	options: { reverse?: boolean; propValueTransform?: (v: T[K]) => any } = {}
) => {
	const reverse = options.reverse || false
	const propValueTransform = options.propValueTransform || ((v) => v)
	return arr.sort(
		(a, b) =>
			(propValueTransform(a[prop]) > propValueTransform(b[prop]) ? 1 : -1) *
			(reverse ? -1 : 1)
	) as T[]
}

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

export const randomIntRange = (minOrMax: number, max?: number) => {
	const min = max === undefined ? 0 : minOrMax
	const range = max === undefined ? minOrMax : max - minOrMax
	return Math.floor(min + Math.random() * (range + 1))
}

export const randomElement = <T>(arr: T[]): T =>
	arr[randomIntRange(0, arr.length - 1)]

// https://stackoverflow.com/a/59700012/2612679
export type DeepReadonly<T> = T extends Function // eslint-disable-line @typescript-eslint/ban-types
	? T
	: T extends object
	? { readonly [K in keyof T]: DeepReadonly<T[K]> }
	: T

export type MaybeReadonly<T> = T | DeepReadonly<T>
