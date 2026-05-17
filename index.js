require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const cron = require('node-cron');

// Express 앱 설정
const app = express();
const PORT = process.env.PORT || 8000;

// HTML 이스케이프 유틸리티 (XSS 방지)
const escapeHtml = (text) => {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// OAuth2 콜백 핸들러
app.get('/oauth/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('잘못된 접근입니다: code가 누락되었습니다.');
    }

    try {
        // 1. 토큰 교환 (Authorization Code -> Access Token)
        const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.DISCORD_REDIRECT_URI,
            }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const tokens = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error('토큰 교환 실패:', tokens);
            return res.status(500).send('인증 토큰을 가져오는 데 실패했습니다.');
        }

        // 2. 사용자 정보 조회 (Access Token 사용)
        const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`,
            },
        });

        const userData = await userResponse.json();

        if (!userResponse.ok) {
            console.error('사용자 정보 조회 실패:', userData);
            return res.status(500).send('사용자 정보를 조회하는 데 실패했습니다.');
        }

        // 3. 성공 응답 (XSS 방지를 위해 사용자명 이스케이프)
        const safeUsername = escapeHtml(userData.username);
        const discriminator = userData.discriminator === '0' ? '' : '#' + userData.discriminator;

        res.send(`
            <h1>봇 초대가 성공적으로 완료되었습니다!</h1>
            <p>환영합니다, <strong>${safeUsername}${discriminator}</strong>님!</p>
            <p>이제 디스코드 서버에서 봇을 사용할 수 있습니다. 이 창을 닫으셔도 좋습니다.</p>
        `);
    } catch (error) {
        console.error('OAuth2 처리 중 시스템 오류 발생:', error);
        res.status(500).send('서버 내부 오류가 발생했습니다.');
    }
});

// 기본 헬스체크 경로
app.get('/', (req, res) => {
    const status = client.isReady() ? 'Online' : 'Starting';
    res.send('Discord Bot Server is ' + status + '.');
});

// 클라이언트 생성 및 인텐트 설정
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// 봇이 준비되었을 때 실행되는 이벤트
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// 메시지 처리 로직 분리 (테스트 가능하게 함)
const handleMessage = async (message) => {
    // 봇이 보낸 메시지라면 무시
    if (message.author.bot) return;

    // '!ping'이라는 메시지에 'Pong!'으로 응답
    if (message.content.trim() === '!ping') {
        try {
            await message.reply('Pong!');
        } catch (error) {
            console.error('메시지 응답 중 오류 발생:', error);
        }
    }
};

// 스케줄된 메시지 전송 로직
const sendScheduledGif = async (client, channelName) => {
    try {
        // 모든 채널 중에서 이름이 일치하는 텍스트 채널 검색
        const channel = client.channels.cache.find(c => c.name === channelName && c.isTextBased());
        
        if (channel) {
            await channel.send('https://giphy.com/gifs/0357-1557-15-57-MethllSyrDoPZ13awK');
            console.log(`스케줄된 GIF 전송 완료: 채널명 "${channelName}" (15:57)`);
        } else {
            console.error(`채널을 찾을 수 없습니다: "${channelName}"`);
        }
    } catch (error) {
        console.error('스케줄된 메시지 전송 중 오류 발생:', error);
    }
};

// 봇 로그인 및 서버 시작 (직접 실행될 때만)
if (require.main === module) {
    // 매일 15:57에 GIF 전송 스케줄링 (한국 시간 기준 Asia/Seoul)
    cron.schedule('57 15 * * *', () => {
        if (client.isReady()) {
            sendScheduledGif(client, '깡-통');
        }
    }, {
        scheduled: true,
        timezone: "Asia/Seoul"
    });

    // Express 서버 시작
    app.listen(PORT, () => {
        console.log(`Web server is running on port ${PORT}`);
    }).on('error', (err) => {
        console.error('Web server failed to start:', err);
        process.exit(1);
    });

    client.login(process.env.DISCORD_TOKEN).catch(error => {
        console.error('로그인 실패:', error);
        process.exit(1);
    });
}

module.exports = { client, handleMessage, app, sendScheduledGif };
