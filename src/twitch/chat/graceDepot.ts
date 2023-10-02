import { GraceTrainCar } from 'grace-train-lib/trains'
import { randomElement } from '../../util.js'
import { GraceUser } from './graceStats.js'
import { timestampLog } from '../../logger.js'

type DepotUser = {
	userId: string
	cars: GraceTrainCar[]
}
type DepotUserError = {
	error: string
}

export async function getCarFromGraceUser(
	graceUser: GraceUser
): Promise<GraceTrainCar> {
	const depotUser = await getDepotUser(graceUser.id)
	let car: GraceTrainCar
	if ('cars' in depotUser && depotUser.cars.length > 0) {
		car = pickDepotUserCar(depotUser)
	} else {
		if ('error' in depotUser) {
			timestampLog('Error fetching depot user:', depotUser.error)
		}
		car = graceUser.color
	}
	return car
}

export async function getDepotUser(
	twitchUserId: string
): Promise<DepotUser | DepotUserError> {
	try {
		const response = await fetch(
			`${process.env.DEPOT_URL}/api/user/${twitchUserId}`,
			{
				headers: { Authorization: process.env.DEPOT_SECRET },
			}
		)
		if (response.status === 404) {
			return { error: (await response.json()).message }
		}
		const data = (await response.json()) as {
			userId: string
			cars: GraceTrainCar[]
		}
		return data
	} catch (e) {
		console.log(e)
		return { error: 'error fetching depot user' }
	}
}

export function pickDepotUserCar(user: DepotUser) {
	console.log('picking user car from', user.cars.length)
	return randomElement(user.cars)
}
