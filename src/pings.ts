import {
	type Client,
	type Role,
	type Guild,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageActionRowComponentBuilder,
	MessageFlags,
} from 'discord.js'
import { timestampLog } from './logger.js'

let twitchPingRole: Role | undefined
let blueskyPingRole: Role | undefined

type PingConfig = {
	type: 'twitch' | 'bluesky'
	roleName: string
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
		roleName: 'stream-pings',
		getRole: () => twitchPingRole!,
		btnAddID: 'btnTwitchPingAdd',
		btnRemoveID: 'btnTwitchPingRemove',
		name: process.env.NICKNAME || process.env.TWITCH_STREAMER_USERNAME,
		buttonVerb: 'goes live',
		responseVerb: 'streams',
		collectiveNoun: 'streams',
	},
	bluesky: {
		type: 'bluesky',
		roleName: 'bluesky-pings',
		getRole: () => blueskyPingRole!,
		btnAddID: 'btnBlueskyPingAdd',
		btnRemoveID: 'btnBlueskyPingRemove',
		name: process.env.NICKNAME || process.env.BLUESKY_USERNAME,
		buttonVerb: 'posts on Bluesky',
		responseVerb: 'posts on Bluesky',
		collectiveNoun: 'Bluesky posts',
	},
} as const

function getPingConfig(customId: string) {
	if (
		customId === pingConfigs.twitch.btnAddID ||
		customId === pingConfigs.twitch.btnRemoveID
	)
		return pingConfigs.twitch
	if (
		customId === pingConfigs.bluesky.btnAddID ||
		customId === pingConfigs.bluesky.btnRemoveID
	)
		return pingConfigs.bluesky
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
			roles.find((role) => role.name === pingConfigs.twitch.roleName) ||
			(await server.roles.create({ name: pingConfigs.twitch.roleName }))
		if (process.env.DISCORD_BLUESKY_CHANNEL_ID !== '') {
			blueskyPingRole =
				roles.find((role) => role.name === pingConfigs.bluesky.roleName) ||
				(await server.roles.create({ name: pingConfigs.bluesky.roleName }))
		}
	} catch (e) {
		console.log(e)
		throw 'Error creating ping roles!'
	}
	bot.on('interactionCreate', async (interaction) => {
		if (!interaction.isButton() || !interaction.member) return
		if (interaction.guildId !== process.env.DISCORD_SERVER_ID) return
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
				flags: MessageFlags.Ephemeral,
			})
			return
		}
		const memberName = member.nickname || member.user.username
		if (addOrRemove === 'add') {
			timestampLog(`${memberName} opted into ${pingConfig.type} pings`)
			member.roles.add(role.id)
			interaction.reply({
				content: `🔔 OK, you will be pinged whenever ${pingConfig.name} ${pingConfig.responseVerb}!`,
				flags: MessageFlags.Ephemeral,
			})
		} else {
			timestampLog(`${memberName} opted out of ${pingConfig.type} pings`)
			member.roles.remove(role.id)
			interaction.reply({
				content: `🔕 OK, you will no longer be pinged for ${pingConfig.collectiveNoun}`,
				flags: MessageFlags.Ephemeral,
			})
		}
	})
}

export const getTwitchPingButtons = () => getButtons(pingConfigs.twitch)
export const getBlueskyPingButtons = () => getButtons(pingConfigs.bluesky)

function getButtons(pingConfig: PingConfig) {
	return [
		new ActionRowBuilder().addComponents(
			new ButtonBuilder()
				.setCustomId(pingConfig.btnAddID)
				.setLabel(`Ping me when ${pingConfig.name} ${pingConfig.buttonVerb}`)
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId(pingConfig.btnRemoveID)
				.setLabel('Stop pinging me')
				.setStyle(ButtonStyle.Secondary)
		),
	] as ActionRowBuilder<MessageActionRowComponentBuilder>[]
}

export const getTwitchPingRole = () => twitchPingRole
export const getBlueskyPingRole = () => blueskyPingRole
