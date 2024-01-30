// Because every random library has one problem or another

export function randomFloat(min: number, max: number) {
	return min + Math.random() * (max - min)
}

export function randomInt(min: number, max: number) {
	return min + Math.floor(Math.random() * (max - min + 1))
}

export function randomElement<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]
}

export function randomChance(chance: number) {
	return Math.random() < chance
}

// Based on https://github.com/ChrisCavs/aimless.js/blob/main/src/weighted.ts
export function randomElementWeighted<T>(arr: T[], weights: number[]) {
	if (arr.length === 1) return arr[0]
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
	const random = randomFloat(0, totalWeight)
	let cumulativeWeight = 0
	for (let i = 0; i < arr.length; i++) {
		cumulativeWeight += weights[i]
		if (random < cumulativeWeight) return arr[i]
	}
	return arr[0] // Should never reach here, but just in case
}
