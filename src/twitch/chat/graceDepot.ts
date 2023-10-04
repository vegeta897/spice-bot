import { GraceTrainCar } from 'grace-train-lib/trains'
import { DEV_MODE, randomElement } from '../../util.js'
import { GraceUser } from './graceStats.js'
import { timestampLog } from '../../logger.js'

type DepotUser = {
	userId: string
	cars: GraceTrainCar[]
}
type DepotUserError = {
	error: string
}

// TODO: Caching
// Send lastFetched timestamp for each user so depot can tell us our cache is good

export async function getCarFromGraceUser(
	graceUser: GraceUser
): Promise<GraceTrainCar> {
	let car: GraceTrainCar = graceUser.color
	try {
		const depotUser = (await getDepotUsers([graceUser.id]))[0]
		if ('cars' in depotUser && depotUser.cars.length > 0) {
			car = pickDepotUserCar(depotUser)
		} else {
			if (DEV_MODE && 'error' in depotUser) {
				timestampLog(depotUser.error)
			}
		}
	} catch (e) {
		timestampLog('Error fetching depot user:', e)
	}
	return car
}

export async function getDepotUsers(
	twitchUserIds: string[]
): Promise<(DepotUser | DepotUserError)[]> {
	try {
		const response = await fetch(
			`${process.env.DEPOT_URL}/api/users/${twitchUserIds.join(',')}`,
			{
				headers: { Authorization: process.env.DEPOT_SECRET },
			}
		)
		const data = (await response.json()) as {
			users: { userId: string; cars: GraceTrainCar[] }[]
			unknownUserIds?: string[]
		}
		const depotUsers: (DepotUser | DepotUserError)[] = data.users
		if (data.unknownUserIds) {
			depotUsers.push(
				...data.unknownUserIds.map((uid) => ({
					error: `Twitch User ID "${uid}" not found`,
				}))
			)
		}
		return depotUsers
	} catch (e) {
		console.log(e)
		throw 'error fetching depot user(s)'
	}
}

export function pickDepotUserCar(user: DepotUser) {
	console.log('picking user car from', user.cars.length)
	return randomElement(user.cars)
}

export async function pingDepot(): Promise<'pong' | 'unauthorized' | 'dead'> {
	try {
		const response = await fetch(`${process.env.DEPOT_URL}/api/ping`, {
			headers: { Authorization: process.env.DEPOT_SECRET },
		})
		const maybePong = await response.text()
		console.log(maybePong)
		if (maybePong === 'pong!') return 'pong'
		return 'unauthorized'
	} catch (e) {
		if (e instanceof TypeError) {
			console.log(e.message)
		} else {
			console.log(e)
		}
		return 'dead'
	}
}
