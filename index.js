require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

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

// 메시지가 생성되었을 때 실행되는 이벤트
client.on('messageCreate', (message) => {
    // 봇이 보낸 메시지라면 무시
    if (message.author.bot) return;

    // '핑'이라는 메시지에 '퐁!'으로 응답
    if (message.content === '핑') {
        message.reply('퐁!');
    }
});

// 봇 로그인
client.login(process.env.DISCORD_TOKEN);
