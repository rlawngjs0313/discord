const { Client } = require('discord.js');
const config = require('../../config');

// 디스코드 클라이언트 인스턴스 싱글톤 관리
const client = new Client({
    intents: config.discord.intents,
});

/**
 * 메시지 처리 핸들러
 * @param {import('discord.js').Message} message 
 */
const handleMessage = async (message) => {
    if (message.author.bot) return;

    if (message.content.trim() === '!ping') {
        try {
            await message.reply('Pong!');
        } catch (error) {
            console.error('메시지 응답 중 오류 발생:', error);
        }
    }
};

// 이벤트 등록
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', handleMessage);

module.exports = { client, handleMessage };
