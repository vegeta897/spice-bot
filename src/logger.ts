import { WebhookClient } from 'discord.js'
import { DateTime } from 'luxon'
import { DEV_MODE } from './util.js'

export const timestamp = () =>
	DateTime.now().setZone('America/New_York').toFormat('yyyy-MM-dd, tt ZZZZ')

export const timestampLog = (message?: any, ...optionalParams: any[]) => {
	console.log(timestamp(), message, ...optionalParams)
	webhookLog(message, ...optionalParams)
}

export const spiceLog = (message?: any, ...optionalParams: any[]) => {
	console.log(message, ...optionalParams)
	webhookLog(message, ...optionalParams)
}

const webhookClient =
	process.env.LOG_WEBHOOK_URL &&
	new WebhookClient({ url: process.env.LOG_WEBHOOK_URL })

const webhookLog = (message?: any, ...optionalParams: any[]) => {
	if (!DEV_MODE && webhookClient)
		webhookClient.send({
			content: '```\n' + [message, ...optionalParams].join('\n') + '```',
			username: 'Spice Bot Logger',
		})
}
