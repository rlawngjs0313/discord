require('dotenv').config();
const cron = require('node-cron');
const config = require('./config');
const { client } = require('./domains/bot/bot.service');
const { createServer } = require('./domains/web/web.service');
const { sendScheduledGif } = require('./domains/scheduler/scheduler.service');

const app = createServer(client);

// 애플리케이션 시작
const start = () => {
    // 1. 웹 서버 시작
    app.listen(config.web.port, () => {
        console.log(`Web server is running on port ${config.web.port}`);
    }).on('error', (err) => {
        console.error('Web server failed to start:', err);
        process.exit(1);
    });

    // 2. 스케줄러 등록
    cron.schedule(config.scheduler.cronSchedule, () => {
        if (client.isReady()) {
            sendScheduledGif(client, config.scheduler.channelName, config.scheduler.gifUrl);
        }
    }, {
        scheduled: true,
        timezone: config.scheduler.timezone
    });

    // 3. 디스코드 봇 로그인
    client.login(config.discord.token).catch(error => {
        console.error('Discord login failed:', error);
        process.exit(1);
    });
};

if (require.main === module) {
    start();
}

module.exports = { app, client };
