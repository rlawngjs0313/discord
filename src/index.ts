import 'dotenv/config';
import cron from 'node-cron';
import config from './config';
import { client, registerEvents } from './domains/bot/bot.service';
import { createServer } from './domains/web/web.app';
import { sendScheduledGif } from './domains/scheduler/scheduler.service';
import { initLavalink } from './domains/music/music.service';

const app = createServer(client);

// 애플리케이션 시작
const start = async (): Promise<void> => {
    // 0. Lavalink 초기화
    initLavalink(client);

    // 1. 이벤트 리스너 등록
    registerEvents(client);

    // 2. 웹 서버 시작
    app.listen(config.web.port, () => {
        console.log(`Web server is running on port ${config.web.port}`);
    }).on('error', (err: Error) => {
        console.error('Web server failed to start:', err);
        process.exit(1);
    });

    // 3. 스케줄러 등록
    cron.schedule(config.scheduler.cronSchedule, () => {
        if (client.isReady()) {
            sendScheduledGif(client, {
                channelId: config.scheduler.channelId,
                channelName: config.scheduler.channelName,
                gifUrl: config.scheduler.gifUrl
            });
        }
    }, {
        scheduled: true,
        timezone: config.scheduler.timezone
    });

    // 4. 디스코드 봇 로그인
    client.login(config.discord.token).catch(error => {
        console.error('Discord login failed:', error);
        process.exit(1);
    });
};

// Check if this file is the entry point
if (require.main === module) {
    start();
}

export { app, client };
