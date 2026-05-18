import { Client, Message } from 'discord.js';
import config from '../../config';
import { handlePlayCommand, handleStopCommand } from '../music/music.service';

// 디스코드 클라이언트 인스턴스 싱글톤 관리
const client = new Client({
    intents: config.discord.intents,
});

/**
 * 메시지 처리 핸들러
 * @param {Message} message 
 */
export const handleMessage = async (message: Message): Promise<void> => {
    if (message.author.bot) return;

    const content = message.content.trim();

    if (content === '!ping') {
        try {
            console.log('!ping 감지: Pong 메시지 전송!');
            await message.reply('Pong!');
        } catch (error) {
            console.error('메시지 응답 중 오류 발생:', error);
        }
    }

    // 노래 재생 명령어 처리
    if (content.startsWith('!재생')) {
        const args = content.split(' ').slice(1);
        await handlePlayCommand(message, args);
    }

    // 노래 정지 명령어 처리
    if (content === '!정지') {
        await handleStopCommand(message);
    }
};

/**
 * 봇 이벤트 리스너 등록 (Side Effect 방지)
 * @param {Client} client 
 */
export const registerEvents = (client: Client): void => {
    client.once('ready', (c) => {
        console.log(`Logged in as ${c.user.tag}!`);
    });

    client.on('messageCreate', handleMessage);
};

export { client };
