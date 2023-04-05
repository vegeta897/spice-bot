import { randomElement } from '../../util.js'

const userColors: Map<string, string> = new Map()

export function updateUserColor(userID: string, color: string | null) {
	if (color === null)
		color = userColors.get(userID) || randomElement(defaultColors)
	userColors.set(userID, color)
	return color
}

export function getUserColor(userID: string) {
	return userColors.get(userID) || updateUserColor(userID, null)
}

// These are the default twitch colors, but maybe we could use prettier ones?
const defaultColors = [
	'#FF0000',
	'#0000FF',
	'#008000',
	'#B22222',
	'#FF7F50',
	'#9ACD32',
	'#FF4500',
	'#2E8B57',
	'#DAA520',
	'#D2691E',
	'#5F9EA0',
	'#1E90FF',
	'#FF69B4',
	'#8A2BE2',
	'#00FF7F',
]
