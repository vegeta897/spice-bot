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
- [A Twitter Developer account](https://developer.twitter.com/en/apply-for-access) (unless using scrape mode)

### Install

Clone this repository and run `npm install`

If you do not need the Twitter scraper, run `npm install --omit=optional`

### Config

Rename or copy `.env.example` to `.env` and fill it out. All variables are required unless marked optional.

| Variable                     | Description                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `TWITCH_STREAMER_USERNAME`   | The Twitch username to watch for streams. Leave this blank to disable the entire Twitch portion of the bot |
| `TWITCH_BOT_USERNAME`        | The Twitch username for your chat bot                                                                      |
| `TWITCH_ADMIN_USERNAME`      | Your own Twitch username as the bot admin bot                                                              |
| `TWITCH_CLIENT_ID`           | The client ID of your Twitch App                                                                           |
| `TWITCH_CLIENT_SECRET`       | The client secret of your Twitch App                                                                       |
| `TWITCH_BANNER_URL`          | _(optional)_ An image URL to use in stream notification embeds                                             |
| `TWITTER_USERNAME`           | The Twitter username to watch for tweets                                                                   |
| `TWITTER_SCRAPE_MODE`        | If "true", the Twitter API will be substituted for page scraping                                           |
| `TWITTER_TOKEN`              | The bearer token for your Twitter app                                                                      |
| `TWITTER_INCLUDE_RETWEETS`   | If set to "true", retweets will be posted (quote retweets are always be posted)                            |
| `TWITTER_INCLUDE_REPLIES`    | If set to "true", tweet replies will be posted (self-replies are always posted)                            |
| `DISCORD_BOT_TOKEN`          | The token of your Discord bot                                                                              |
| `DISCORD_SERVER_ID`          | The Discord server ID to post to                                                                           |
| `DISCORD_TWITCH_CHANNEL_ID`  | The Discord channel ID to post Twitch streams to                                                           |
| `DISCORD_TWITTER_CHANNEL_ID` | The Discord channel ID to post tweets to (this can be the same as the Twitch channel)                      |
| `NICKNAME`                   | _(optional)_ A nickname for the streamer, used in stream notifications                                     |
| `EXPRESS_HOSTNAME`           | The URL that points to the Express server                                                                  |
| `EXPRESS_PORT`               | The port used by the Express server                                                                        |

### Setup

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

## Twitter API

On February 2nd 2023, [Twitter announced](https://twitter.com/TwitterDev/status/1621026986784337922) that there will no longer be free access to their API, merely one week hence. This is an absurd move that I don't need to go into here. The point is, I immediately began creating a workaround which amounts to scraping Twitter with an emulated browser, with the help of the awesome library [Puppeteer](https://pptr.dev/). I am writing this before the paywall has actually gone up, so I don't know for sure if this work will be necessary, but I'm preparing for the worst.

## About

Add me on Discord if you have any questions or comments: `vegeta897#7777`

Spice Bot was originally created for the official [Abby Russell](https://www.abbyfrombrooklyn.com/) Discord server. Shout-out to the sweeties!

Future development will be dictated by the needs of the server I'm using it on, and anything I'm interesteed in pursuing. This may include scope expansions that seem pretty irrelevant or specialized. I don't feel like spending time and effort making it modular, so it's all happening in this repo. ~~Not like anyone is really going to use this bot, this readme is just for me!~~ I stand corrected, the Twitter scraper has proved valuable.
