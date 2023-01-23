import {
	type Client,
	type Role,
	type Guild,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageActionRowComponentBuilder,
} from 'discord.js'
import { timestampLog } from './util.js'

const TWITCH_PING_ROLE_NAME = 'stream-pings'
const TWITTER_PING_ROLE_NAME = 'tweet-pings'

let twitchPingRole: Role | undefined
let twitterPingRole: Role | undefined

type PingConfig = {
	type: 'twitch' | 'twitter'
	getRole: () => Role
	btnAddID: string
	btnRemoveID: string
	name: string
	buttonVerb: string
	responseVerb: string
	collectiveNoun: string
}

const pingConfigs: Record<PingConfig['type'], PingConfig> = {
	twitch: {
		type: 'twitch',
		getRole: () => twitchPingRole!,
		btnAddID: 'btnTwitchPingAdd',
		btnRemoveID: 'btnTwitchPingRemove',
		name: process.env.NICKNAME || process.env.TWITCH_USERNAME,
		buttonVerb: 'goes live',
		responseVerb: 'streams',
		collectiveNoun: 'streams',
	},
	twitter: {
		type: 'twitter',
		getRole: () => twitterPingRole!,
		btnAddID: 'btnTwitterPingAdd',
		btnRemoveID: 'btnTwitterPingRemove',
		name: process.env.NICKNAME || process.env.TWITTER_USERNAME,
		buttonVerb: 'tweets',
		responseVerb: 'tweets',
		collectiveNoun: 'tweets',
	},
} as const

function getPingConfig(customId: string) {
	if (
		customId === pingConfigs.twitch.btnAddID ||
		customId === pingConfigs.twitch.btnRemoveID
	)
		return pingConfigs.twitch
	if (
		customId === pingConfigs.twitter.btnAddID ||
		customId === pingConfigs.twitter.btnRemoveID
	)
		return pingConfigs.twitter
}

export async function initPings(bot: Client, server: Guild) {
	const botMember = await server.members.fetchMe()
	if (!botMember.permissions.has('ManageRoles')) {
		console.log(
			'Spice Bot is missing the "Manage Roles" permission, so pings will be unavailable!'
		)
		return
	}
	const roles = await server.roles.fetch()
	try {
		twitchPingRole =
			roles.find((role) => role.name === TWITCH_PING_ROLE_NAME) ||
			(await server.roles.create({ name: TWITCH_PING_ROLE_NAME }))
		twitterPingRole =
			roles.find((role) => role.name === TWITTER_PING_ROLE_NAME) ||
			(await server.roles.create({ name: TWITTER_PING_ROLE_NAME }))
	} catch (e) {
		console.log(e)
		throw 'Error creating ping roles!'
	}
	bot.on('interactionCreate', async (interaction) => {
		if (!interaction.isButton() || !interaction.member) return
		const member = await server.members.fetch(interaction.member.user.id)
		const { customId } = interaction
		const pingConfig = getPingConfig(customId)
		if (!pingConfig) {
			timestampLog('Unknown interaction received:', customId)
			return
		}
		const addOrRemove = customId === pingConfig.btnAddID ? 'add' : 'remove'
		const role = pingConfig.getRole()
		if (!role) {
			interaction.reply({
				content: 'Sorry, the ping role is broken, please tell an admin!',
				ephemeral: true,
			})
			return
		}
		const memberName = member.nickname || member.user.username
		if (addOrRemove === 'add') {
			timestampLog(`${memberName} opted into ${pingConfig.type} pings`)
			member.roles.add(role.id)
			interaction.reply({
				content: `OK, you will be pinged whenever ${pingConfig.name} ${pingConfig.responseVerb}!`,
				ephemeral: true,
			})
		} else {
			timestampLog(`${memberName} opted out of ${pingConfig.type} pings`)
			member.roles.remove(role.id)
			interaction.reply({
				content: `OK, you will no longer be pinged for ${pingConfig.collectiveNoun}`,
				ephemeral: true,
			})
		}
	})
}

export const getTwitchPingButtons = () => getButtons(pingConfigs.twitch)
export const getTwitterPingButtons = () => getButtons(pingConfigs.twitter)

function getButtons(pingConfig: PingConfig) {
	return [
		new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(pingConfig.btnAddID)
				.setLabel(`Ping me when ${pingConfig.name} ${pingConfig.buttonVerb}`)
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(pingConfig.btnRemoveID)
				.setLabel('Stop pinging me')
				.setStyle(ButtonStyle.Secondary)
		),
	] as ActionRowBuilder<MessageActionRowComponentBuilder>[]
}

export const getTwitchPingRole = () => twitchPingRole
export const getTwitterPingRole = () => twitterPingRole
