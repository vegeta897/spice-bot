import {
	transformCarFromDBToDepotCar,
	type DBCar,
	type DepotTrainAddRequest,
	type DepotTrainEndRequest,
	type DepotTrainStartRequest,
	type GraceTrainCar,
} from 'grace-train-lib/data'
import prisma from '../../db/prisma.js'
import { Prisma } from 'grace-train-lib/prisma'
import { randomElement } from '../../util.js'

const orderBySlot = { orderBy: { slot: 'asc' } } as const
const carsIncludeQuery = { decals: orderBySlot, toppers: orderBySlot } as const
const userCarsIncludeQuery = {
	cars: { include: carsIncludeQuery, where: { published: true } },
} satisfies Prisma.UserInclude

export async function depotTrainStart({
	trainId,
	graces,
	score,
}: DepotTrainStartRequest): Promise<GraceTrainCar[]> {
	await prisma.graceTrain.updateMany({
		data: { ended: true },
		where: { ended: false, id: { not: trainId } },
	})
	// Get grace train users and their cars
	const users = await prisma.user.findMany({
		where: {
			twitchUserId: { in: graces.map((g) => g.userId) },
			trustLevel: { notIn: ['hidden', 'banned'] }, // No cars from hidden or banned users
			cars: { some: {} }, // Only get users with at least one car
		},
		include: userCarsIncludeQuery,
	})
	const graceTrainCars: GraceTrainCar[] = []
	const createGraceTrainCars: Prisma.GraceTrainCarUncheckedCreateWithoutTrainInput[] =
		[]
	const pickedCars: Parameters<typeof pickUserCar>[1] = []
	const pickedCarIds: Set<number> = new Set()
	for (let i = 0; i < graces.length; i++) {
		const grace = graces[i]
		const createGraceTrainCar: Prisma.GraceTrainCarUncheckedCreateWithoutTrainInput =
			{
				index: i,
				twitchUserId: grace.userId,
				carData: { color: grace.color },
			}
		const user = users.find((u) => u.twitchUserId === grace.userId)
		if (user) {
			const pickedCar = pickUserCar(user.cars, pickedCars)
			await incrementGraceTrainTotalAppearances(pickedCar.id)
			const pickedCarData = {
				depotCar: transformCarFromDBToDepotCar(pickedCar),
			}
			graceTrainCars.push(pickedCarData)
			pickedCars.push({ carId: pickedCar.id, userId: user.id })
			pickedCarIds.add(pickedCar.id)
			createGraceTrainCar.carData = pickedCarData
			createGraceTrainCar.carId = pickedCar.id
			createGraceTrainCar.carRevision = pickedCar.revision
			createGraceTrainCar.userId = user.id
		} else {
			graceTrainCars.push({ color: grace.color })
		}
		createGraceTrainCars.push(createGraceTrainCar)
	}
	await updateGraceTrainCarStatsForTrain([...pickedCarIds], trainId)
	await prisma.graceTrain.create({
		data: { id: trainId, score, cars: { create: createGraceTrainCars } },
	})
	return graceTrainCars
}

export async function depotTrainAdd({
	trainId,
	grace,
	index,
	score,
}: DepotTrainAddRequest): Promise<GraceTrainCar> {
	let train
	try {
		train = await prisma.graceTrain.update({
			data: { score },
			include: { cars: true },
			where: { id: trainId },
		})
	} catch (e) {
		// Update throws if record not found
		console.log('unknown train ID', trainId)
		return grace
	}
	const user = await prisma.user.findUnique({
		where: {
			twitchUserId: grace.userId,
			trustLevel: { notIn: ['hidden', 'banned'] },
			cars: { some: {} }, // Only get users with at least one car
		},
		include: userCarsIncludeQuery,
	})
	const createGraceTrainCar: Prisma.GraceTrainCarUncheckedCreateInput = {
		trainId,
		index,
		twitchUserId: grace.userId,
		carData: { color: grace.color },
	}
	let graceTrainCar: GraceTrainCar = { color: grace.color }
	if (user) {
		const pickedCar = pickUserCar(user.cars, train.cars)
		await incrementGraceTrainTotalAppearances(pickedCar.id)
		if (!train.cars.some((c) => c.carId === pickedCar.id)) {
			// Update train-specific stats if this is the first appearance in this train
			await updateGraceTrainCarStatsForTrain([pickedCar.id], trainId)
		}
		const pickedCarData = { depotCar: transformCarFromDBToDepotCar(pickedCar) }
		graceTrainCar = pickedCarData
		createGraceTrainCar.carData = pickedCarData
		createGraceTrainCar.carId = pickedCar.id
		createGraceTrainCar.carRevision = pickedCar.revision
		createGraceTrainCar.userId = user.id
	}
	prisma.graceTrainCar
		.create({
			data: createGraceTrainCar,
		})
		.then() // Prisma queries need to be awaited to work properly, but we don't need to wait to return a response
	return graceTrainCar
}

export async function depotTrainEnd({
	trainId,
	score,
}: DepotTrainEndRequest): Promise<{ carDebutCount: number }> {
	try {
		await prisma.graceTrain.update({
			where: { id: trainId },
			data: { score, ended: true },
		})
	} catch (e) {
		// Update throws here if train record not found
		console.log('Error ending train ID', trainId, e)
	}
	// Get a list of cars that debuted in this train
	const carDebutCount = await prisma.graceTrainCarStats.count({
		where: { lastGraceTrainId: trainId, graceTrainCount: 1 },
	})
	return { carDebutCount }
}

type TrainCarData = Prisma.GraceTrainCarGetPayload<{}>

// Round-robin algorithm randomly picks among the user's cars
// Prefers cars that appeared least in the current train
// Also avoids picking the last picked car if possible
function pickUserCar(
	userCars: DBCar[],
	trainCars: Pick<TrainCarData, 'userId' | 'carId'>[]
): DBCar {
	if (userCars.length === 1) return userCars[0] // Only one option
	const userId = userCars[0].userId
	const timesInTrainMap = new Map(userCars.map((car) => [car.id, 0]))
	let lastPickedUserCarId: number
	// Count train appearances for each of the user's cars
	for (const trainCar of trainCars) {
		if (trainCar.userId !== userId || !trainCar.carId) continue
		const timesInTrain = timesInTrainMap.get(trainCar.carId)
		lastPickedUserCarId = trainCar.carId
		if (timesInTrain === undefined) continue
		timesInTrainMap.set(trainCar.carId, timesInTrain + 1)
	}
	const leastPicked: Set<DBCar> = new Set()
	let leastPickedCount = Infinity
	// Make a list of cars with the lowest appearance count
	for (const userCar of userCars) {
		if (userCar.id === lastPickedUserCarId!) continue
		const timesInTrain = timesInTrainMap.get(userCar.id)!
		if (timesInTrain < leastPickedCount) {
			leastPicked.clear()
			leastPickedCount = timesInTrain
		}
		if (timesInTrain === leastPickedCount) {
			leastPicked.add(userCar)
		}
	}
	if (leastPicked.size === 0) return randomElement(userCars) // Just in case I coded badly
	return randomElement([...leastPicked])
}

async function incrementGraceTrainTotalAppearances(carId: number) {
	await prisma.graceTrainCarStats.upsert({
		where: { carId: carId },
		create: { carId, totalAppearances: 1 },
		update: { totalAppearances: { increment: 1 } },
	})
}

async function updateGraceTrainCarStatsForTrain(
	carIds: number[],
	trainId: number
) {
	await prisma.graceTrainCarStats.updateMany({
		// Exclude cars already updated for this train
		where: { carId: { in: carIds }, lastGraceTrainId: { not: trainId } },
		data: { graceTrainCount: { increment: 1 }, lastGraceTrainId: trainId },
	})
}
