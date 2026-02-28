declare global {
	namespace NodeJS {
		interface ProcessEnv {
			TWITCH_STREAMER_USERNAME: string
			TWITCH_BOT_USERNAME: string
			TWITCH_ADMIN_USERNAME: string
			TWITCH_CLIENT_ID: string
			TWITCH_CLIENT_SECRET: string
			TWITCH_BANNER_URL?: string
			BLUESKY_USERNAME: string
			BLUESKY_INCLUDE_REPLIES: string
			DISCORD_BOT_TOKEN: string
			DISCORD_SERVER_ID: string
			DISCORD_TWITCH_CHANNEL_ID: string
			DISCORD_BLUESKY_CHANNEL_ID: string
			NICKNAME?: string
			EXPRESS_HOSTNAME: string
			EXPRESS_PORT: string
			NGROK_AUTH_TOKEN: string
			CHAT_TEST_MODE: string
			LOG_WEBHOOK_URL: string
			DEPOT_URL: string
			DEPOT_SECRET: string
			NODE_ENV?: 'development' | 'production'
		}
	}
}
export {}
