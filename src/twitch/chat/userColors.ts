import { COLORS } from 'grace-train-lib'
import { randomElement } from '../../random.js'

const userColors: Map<string, string> = new Map()

export function updateUserColor(userID: string, color: string | null) {
	if (color === null) color = userColors.get(userID) || getRandomUserColor()
	userColors.set(userID, color!)
	return color!
}

export function getUserColor(userID: string) {
	// There is an endpoint for getting user color, but this would add latency
	return userColors.get(userID) || updateUserColor(userID, null)
}

const randomColorChoices = [...COLORS.POP]
export const getRandomUserColor = () => randomElement(randomColorChoices)
