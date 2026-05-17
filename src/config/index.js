const { GatewayIntentBits } = require('discord.js');

module.exports = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        redirectUri: process.env.DISCORD_REDIRECT_URI,
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]
    },
    web: {
        port: process.env.PORT || 8000
    },
    scheduler: {
        channelName: '깡-통',
        gifUrl: 'https://giphy.com/gifs/0357-1557-15-57-MethllSyrDoPZ13awK',
        cronSchedule: '57 15 * * *',
        timezone: 'Asia/Seoul'
    }
};
