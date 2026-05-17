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

// 메시지가 생성되었을 때 실행되는 이벤트
client.on('messageCreate', handleMessage);

// 봇 로그인 (직접 실행될 때만 로그인)
if (require.main === module) {
    client.login(process.env.DISCORD_TOKEN).catch(error => {
        console.error('로그인 실패:', error);
        process.exit(1);
    });
}

module.exports = { client, handleMessage };
