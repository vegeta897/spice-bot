import {
	DepotTrainAddRequest,
	DepotTrainEndRequest,
	DepotTrainStartRequest,
	GraceTrainCar,
} from 'grace-train-lib/trains'
import { DEV_MODE } from '../../util.js'

export async function depotTrainStart(
	request: DepotTrainStartRequest
): Promise<GraceTrainCar[]> {
	try {
		return await callDepotAPI('start', request)
	} catch (e) {
		console.log('error calling "start" on depot api', e)
		return request.graces
	}
}

export async function depotTrainAdd(
	request: DepotTrainAddRequest
): Promise<GraceTrainCar> {
	try {
		return await callDepotAPI('add', request)
	} catch (e) {
		console.log('error calling "add" on depot api', e)
		return request.grace
	}
}

export async function depotTrainEnd(
	request: DepotTrainEndRequest
): Promise<{ carDebutCount: number }> {
	try {
		return await callDepotAPI('end', request)
	} catch (e) {
		console.log('error calling "end" on depot api', e)
		return { carDebutCount: 0 }
	}
}

async function callDepotAPI(
	endpoint: 'start',
	request: DepotTrainStartRequest
): Promise<GraceTrainCar[]>
async function callDepotAPI(
	endpoint: 'add',
	request: DepotTrainAddRequest
): Promise<GraceTrainCar>
async function callDepotAPI(
	endpoint: 'end',
	request: DepotTrainEndRequest
): Promise<{ carDebutCount: number }>
async function callDepotAPI(endpoint: 'start' | 'add' | 'end', request: any) {
	if (DEV_MODE) console.log('callDepotAPI', endpoint, JSON.stringify(request))
	const response = await fetch(
		`${process.env.DEPOT_URL}/api/train/${endpoint}`,
		{
			body: JSON.stringify(request),
			method: 'POST',
			headers: {
				Authorization: process.env.DEPOT_SECRET,
				Accept: 'application/json',
				'Content-Type': 'application/json',
				Origin: process.env.DEPOT_HOSTNAME,
			},
		}
	)
	return await response.json()
}

export async function pingDepot(): Promise<'pong' | 'unauthorized' | 'dead'> {
	try {
		const response = await fetch(`${process.env.DEPOT_URL}/api/ping`, {
			headers: { Authorization: process.env.DEPOT_SECRET },
		})
		const maybePong = await response.text()
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
