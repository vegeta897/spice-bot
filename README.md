# Spice Bot 🌶️

A Discord bot for posting Twitch and Bluesky activity

Spice Bot will automatically send stream notifications and Bluesky posts to your Discord server!

## Features

- 🔔 Notification roles that users can self-assign
- 🕹️ Twitch posts
  - 📰 Rich embeds with updating stream info and images
  - 🎞️ Twitch VOD archive link posted after each stream
  - 🎬 Stream restarts automatically detected and consolidated
- 🦋 Bluesky posts
  - 💬 Optionally include replies to other posts
  - 🗑️ Automatic message removal when posts are deleted
- ♾️ Persistence
  - 🩺 State revival and verification for safe restarts
  - 🔍 Looks for any recent posts or stream events missed while offline
  - 📝 Simple human-readable JSON file database
- 🙈 Does not read messages, and never sends DMs or @everyone pings

## How to use

This is not a public bot that you can invite, but you can set up your own Spice Bot if you have a server that can run NodeJS and a host name or public IP with SSL and a reverse proxy.

### Requirements

- [NodeJS v18 or newer](https://nodejs.org/)
- [A Discord bot](https://discordjs.guide/preparations/setting-up-a-bot-application.html)
- [A Twitch App](https://dev.twitch.tv/console/apps/create)
- [A host name or public IP with SSL](https://twurple.js.org/docs/getting-data/eventsub/listener-setup.html)

### Install

Clone this repository and run `npm install`

Rename or copy `.env.example` to `.env` and fill it out. All variables are required unless marked optional.

| Variable                     | Description                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `TWITCH_STREAMER_USERNAME`   | The Twitch username to watch for streams. Leave this blank to disable the entire Twitch portion of the bot |
| `TWITCH_BOT_USERNAME`        | The Twitch username for your chat bot                                                                      |
| `TWITCH_ADMIN_USERNAME`      | Your own Twitch username as the bot admin bot                                                              |
| `TWITCH_CLIENT_ID`           | The client ID of your Twitch App                                                                           |
| `TWITCH_CLIENT_SECRET`       | The client secret of your Twitch App                                                                       |
| `TWITCH_BANNER_URL`          | _(optional)_ An image URL to use in stream notification embeds                                             |
| `BLUESKY_USERNAME`           | The Bluesky username to watch for posts (e.g. `vegeta897.bsky.social`)                                     |
| `BLUESKY_INCLUDE_REPLIES`    | If set to "true", replies will be posted (self-replies are always posted)                                  |
| `DISCORD_BOT_TOKEN`          | The token of your Discord bot                                                                              |
| `DISCORD_SERVER_ID`          | The Discord server ID to post to                                                                           |
| `DISCORD_TWITCH_CHANNEL_ID`  | The Discord channel ID to post Twitch streams to                                                           |
| `DISCORD_BLUESKY_CHANNEL_ID` | The Discord channel ID to post Bluesky posts to (this can be the same as the Twitch channel)               |
| `NICKNAME`                   | _(optional)_ A nickname for the streamer, used in stream notifications                                     |
| `EXPRESS_HOSTNAME`           | The URL that points to the Express server                                                                  |
| `EXPRESS_PORT`               | The port used by the Express server                                                                        |
| `LOG_WEBHOOK_URL`            | _(optional)_ A Discord webhook URL to mirror log messages to                                               |

### Twitch Setup

Spice Bot needs a reverse proxy set up for the Twitch functions to work. In **nginx**, your config should include something like this:

```nginx
server {
  server_name spicebot.example.com; # This should be your EXPRESS_HOSTNAME
  location / {
    proxy_pass http://localhost:3000/; # The port should be your EXPRESS_PORT
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
  }
}
```

You must add the OAuth Callback URL to your Twitch App. The URL is composed of the `EXPRESS_SERVER_URL` variable followed by `/callback`.

The Discord bot requires only these permissions to function:

- Manage Roles (to assign notice roles)
- Send Messages
- Embed Links
- Mention @everyone, @here, and All Roles (**only** to ping the notice roles)

The bot does not require any privileged intents.

### Start

Build Spice Bot with `npm run build` and start it with `npm start`. I recommend using a service such as [PM2](https://pm2.keymetrics.io/) to handle auto-restarts and log files.

## About

Add me on Discord if you have any questions or comments: `vegeta897`

Spice Bot was originally created for the official Abby Russell Discord server. Shout-out to the sweeties!

Future development will be dictated by the needs of the server I'm using it on, and anything I'm interesteed in pursuing. This may include scope expansions that seem pretty irrelevant or specialized. I don't feel like spending time and effort making it modular, so it's all happening in this repo. Not like anyone is really going to use this bot, this readme is just for me!
