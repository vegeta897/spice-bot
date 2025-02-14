declare global {
	namespace NodeJS {
		interface ProcessEnv {
			TWITCH_STREAMER_USERNAME: string
			TWITCH_BOT_USERNAME: string
			TWITCH_ADMIN_USERNAME: string
			TWITCH_CLIENT_ID: string
			TWITCH_CLIENT_SECRET: string
			TWITCH_BANNER_URL?: string
			TWITTER_USERNAME: string
			TWITTER_TOKEN: string
			TWITTER_SCRAPE_MODE: string
			TWITTER_AUTH_TOKEN_COOKIE: string
			TWITTER_INCLUDE_RETWEETS: string
			TWITTER_INCLUDE_REPLIES: string
			DISCORD_BOT_TOKEN: string
			DISCORD_SERVER_ID: string
			DISCORD_TWITCH_CHANNEL_ID: string
			DISCORD_TWITTER_CHANNEL_ID: string
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
