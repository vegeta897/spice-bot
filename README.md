# Spice Bot 🌶️

A Discord bot for posting Twitch and Twitter activity

Spice Bot will automatically post stream notifications and tweets to your Discord server!

## Features

- 🔔 Notification roles that users can self-assign
- 🕹️ Twitch posts
  - 📰 Rich embeds with updating stream info and images
  - 🎞️ Twitch VOD archive link posted after each stream
- 🐦 Twitter posts
  - 💬 Options to include retweets and/or replies
  - 🗑️ Automatic message removal when tweets are deleted
- ♾️ Persistence
  - 🔄 State revival and verification for safe restarts
  - 🔍 Looks for any recent tweets or stream events missed while offline
  - 📝 Simple human-readable JSON file database
- 🙈 Does not read messages, and never sends DMs or @everyone pings

## How to use

This is not a public bot that you can invite, but you can set up your own Spice Bot if you have a server that can run NodeJS and a host name or public IP with SSL and a reverse proxy.

### Requirements

- [NodeJS v16.9.0 or newer](https://nodejs.org/)
- [A Discord bot](https://discordjs.guide/preparations/setting-up-a-bot-application.html)
- [A Twitch App](https://dev.twitch.tv/console/apps/create)
- [A host name or public IP with SSL](https://twurple.js.org/docs/getting-data/eventsub/listener-setup.html)
- [A Twitter Developer account](https://developer.twitter.com/en/apply-for-access)

### Install

Clone this repository and run `npm install`

### Config

Rename or copy `.env.example` to `.env` and fill it out. All variables are required unless marked optional.

| Variable                      | Description                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `TWITCH_USERNAME`             | The Twitch username to watch for streams                                                              |
| `TWITCH_CLIENT_ID`            | The client ID of your Twitch App                                                                      |
| `TWITCH_CLIENT_SECRET`        | The client secret of your Twitch App                                                                  |
| `TWITCH_EVENTSUB_HOSTNAME`    | The domain or public IP that your server can listen to for Twitch events                              |
| `TWITCH_EVENTSUB_PATH_PREFIX` | The path to append to the host name, e.g. `twitch`                                                    |
| `TWITCH_EVENTSUB_PORT`        | The port for your server to listen to for Twitch events. This is internal only, for the reverse proxy |
| `TWITCH_BANNER_URL`           | _(optional)_ An image URL to use in stream notification embeds                                        |
| `TWITTER_USERNAME`            | The Twitter username to watch for tweets                                                              |
| `TWITTER_TOKEN`               | The bearer token for your Twitter app                                                                 |
| `TWITTER_INCLUDE_RETWEETS`    | If set to "true", retweets will be posted (quote retweets are always be posted)                       |
| `TWITTER_INCLUDE_REPLIES`     | If set to "true", tweet replies will be posted (self-replies are always posted)                       |
| `DISCORD_BOT_TOKEN`           | The token of your Discord bot                                                                         |
| `DISCORD_SERVER_ID`           | The Discord server ID to post to                                                                      |
| `DISCORD_TWITCH_CHANNEL_ID`   | The Discord channel ID to post Twitch streams to                                                      |
| `DISCORD_TWITTER_CHANNEL_ID`  | The Discord channel ID to post tweets to (this can be the same as the Twitch channel)                 |
| `NICKNAME`                    | _(optional)_ A nickname for the streamer, used in stream notifications                                |

### Setup

Spice Bot needs a reverse proxy set up to work. In **nginx**, your config should include something like this:

```nginx
location /twitch/ {
  proxy_pass http://localhost:3000/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 86400;
}
```

The Discord bot requires only these permissions to function:

- Manage Roles (to assign notice roles)
- Send Messages
- Embed Links
- Mention @everyone, @here, and All Roles (**only** to ping the notice roles)

The bot does not require any privileged intents.

### Start

Build Spice Bot with `npm run build` and start it with `npm start`. I recommend using a service such as [PM2](https://pm2.keymetrics.io/) to handle auto-restarts and log files.

## About

Add me on Discord if you have any questions or comments: `vegeta897#7777`

Spice Bot was originally created for the official [Abby Russell](https://www.abbyfrombrooklyn.com/) Discord server. Shout-out to the sweeties!
