declare global {
	namespace NodeJS {
		interface ProcessEnv {
			TWITCH_USERNAME: string
			TWITCH_CLIENT_ID: string
			TWITCH_CLIENT_SECRET: string
			TWITCH_EVENTSUB_HOSTNAME: string
			TWITCH_EVENTSUB_PATH_PREFIX: string
			TWITCH_EVENTSUB_PORT: string
			TWITCH_BANNER_URL?: string
			TWITTER_USERNAME: string
			TWITTER_SCRAPE_MODE: string
			TWITTER_TOKEN: string
			TWITTER_INCLUDE_RETWEETS: string
			TWITTER_INCLUDE_REPLIES: string
			DISCORD_BOT_TOKEN: string
			DISCORD_SERVER_ID: string
			DISCORD_TWITCH_CHANNEL_ID: string
			DISCORD_TWITTER_CHANNEL_ID: string
			NICKNAME?: string
			NODE_ENV?: 'development' | 'production'
		}
	}
}
export {}
