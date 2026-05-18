import { GatewayIntentBits } from 'discord.js';

export interface Config {
    discord: {
        token: string | undefined;
        clientId: string | undefined;
        clientSecret: string | undefined;
        redirectUri: string | undefined;
        intents: GatewayIntentBits[];
        endpoints: {
            token: string;
            userMe: string;
            authorize: string;
        };
    };
    web: {
        port: number | string;
        cookieSecret: string;
    };
    scheduler: {
        channelId: string | undefined;
        channelName: string;
        gifUrl: string;
        cronSchedule: string;
        timezone: string;
    };
    api: {
        timeout: number;
    };
}

const config: Config = {
    discord: {
        token: process.env.DISCORD_TOKEN,
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        redirectUri: process.env.DISCORD_REDIRECT_URI,
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
        ],
        endpoints: {
            token: 'https://discord.com/api/v10/oauth2/token',
            userMe: 'https://discord.com/api/v10/users/@me',
            authorize: 'https://discord.com/api/oauth2/authorize'
        }
    },
    web: {
        port: process.env.PORT || 8000,
        cookieSecret: process.env.COOKIE_SECRET || (process.env.NODE_ENV === 'production' 
            ? (() => { throw new Error('PRODUCTION ERROR: COOKIE_SECRET environment variable is required'); })()
            : 'dev-fallback-secret-strictly-for-local-development')
    },
    scheduler: {
        channelId: process.env.DISCORD_CHANNEL_ID,
        channelName: process.env.SCHEDULER_CHANNEL_NAME || '깡-통',
        gifUrl: process.env.SCHEDULER_GIF_URL || 'https://giphy.com/gifs/0357-1557-15-57-MethllSyrDoPZ13awK',
        cronSchedule: process.env.SCHEDULER_CRON || '57 15 * * *',
        timezone: process.env.SCHEDULER_TIMEZONE || 'Asia/Seoul'
    },
    api: {
        timeout: 5000
    }
};

export default config;
