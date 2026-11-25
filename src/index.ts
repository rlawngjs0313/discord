import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { createDatabase } from './database/database';
import { commandHandler, registerCommands } from './domains/bot/commands';
import { createGeminiTrivia, loadDailyTrivia, runDailyTrivia } from './domains/bot/daily-trivia';
import { createBraveMemeSearch } from './domains/meme/brave';
import { createGeminiMemeModel } from './domains/meme/gemini';
import { createMemeSelector } from './domains/meme/selector';
import { tokenCipher } from './domains/replies/store';
import { startWorker } from './domains/replies/worker';

function required(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(name + ' is required.');
    return value;
}

async function start() {
    const url = required('DATABASE_URL');
    const botToken = required('DISCORD_TOKEN');
    const applicationId = required('DISCORD_CLIENT_ID');
    const cipher = tokenCipher(Buffer.from(required('DISCORD_RESPONSE_KEY'), 'base64'));
    const memeEnabled = process.env.MEME_DISCORD_ENABLED === 'true';
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
    const selectMeme = memeEnabled && geminiKey && braveKey
        ? createMemeSelector(createGeminiMemeModel(geminiKey, process.env.GEMINI_MODEL || undefined), createBraveMemeSearch(braveKey))
        : undefined;
    if (memeEnabled && !selectMeme) console.warn('Discord meme search requires GEMINI_API_KEY and BRAVE_SEARCH_API_KEY.');
    const db = createDatabase(url);
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const triviaAbort = new AbortController();
    let trivia: Promise<void> | undefined;
    let triviaActivity: string | undefined;
    function restoreTriviaActivity(shardId?: number) {
        if (triviaActivity && !triviaAbort.signal.aborted) {
            client.user?.setActivity(triviaActivity, { type: ActivityType.Playing, shardId });
        }
    }
    let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
    let closing: Promise<void> | undefined;
    function close() {
        closing ??= (async () => {
            triviaAbort.abort();
            try { await client.destroy(); }
            finally {
                try { await worker?.stop(); }
                finally {
                    try { await trivia; }
                    finally { await db.close(); }
                }
            }
        })();
        return closing;
    }

    try {
        await db.prisma.privateResponse.findFirst({ select: { responseId: true } });
        worker = await startWorker(url, db, cipher, applicationId);
        worker.promise.catch(() => {
            console.error('Reply deletion worker stopped unexpectedly.');
            process.exitCode = 1;
            void close().catch(() => undefined);
        });
        await registerCommands(botToken, applicationId, process.env.DISCORD_GUILD_ID, memeEnabled);
        const handle = commandHandler(db, cipher, selectMeme, process.env.MEME_DISCORD_SEARCH_PREVIEW === 'true');
        client.on(Events.ShardReady, restoreTriviaActivity);
        client.on(Events.ShardResume, restoreTriviaActivity);
        client.once(Events.ClientReady, () => {
            const readyFile = process.env.DISCORD_READY_FILE;
            if (readyFile) writeFileSync(readyFile, '');
            console.info('Discord Gateway ready.');
            if (geminiKey && !triviaAbort.signal.aborted) {
                const generate = createGeminiTrivia(geminiKey, process.env.GEMINI_MODEL || undefined);
                trivia = runDailyTrivia(
                    (date, signal) => loadDailyTrivia(db, date, generate, signal),
                    activity => {
                        triviaActivity = activity;
                        restoreTriviaActivity();
                    },
                    triviaAbort.signal,
                ).catch(() => console.error('Daily trivia presence loop stopped unexpectedly.'));
            }
        });
        client.on(Events.InteractionCreate, interaction => {
            void handle(interaction).catch(() => console.error('Discord interaction failed.'));
        });
        if (!closing) await client.login(botToken);
        for (const signal of ['SIGINT', 'SIGTERM'] as const) {
            process.once(signal, () => void close().catch(() => { process.exitCode = 1; }));
        }
    } catch {
        await close().catch(() => undefined);
        throw new Error('Discord bot startup failed. Check configuration, migrations, and Discord access.');
    }
}

if (require.main === module) {
    void start().catch((error: Error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
