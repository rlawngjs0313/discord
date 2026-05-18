import { Client, TextChannel } from 'discord.js';

export interface ScheduledGifOptions {
    channelId?: string;
    channelName?: string;
    gifUrl: string;
}

/**
 * 스케줄된 GIF 전송 로직
 * @param {Client} client 
 * @param {ScheduledGifOptions} options 
 */
export const sendScheduledGif = async (client: Client, options: ScheduledGifOptions): Promise<void> => {
    const { channelId, channelName, gifUrl } = options;
    console.log(`스케줄러 동작: 움짤 전송 시도 (${channelId ? 'ID ' + channelId : '채널명 ' + channelName})`);

    try {
        let channel;

        // 1. ID가 설정되어 있다면 직접 조회 (가장 안전함)
        if (channelId) {
            channel = await client.channels.fetch(channelId);
        } 
        // 2. ID가 없다면 이름으로 캐시에서 검색 (멀티 서버 고려 X, 이름 중복 위험 있음)
        else if (channelName) {
            channel = client.channels.cache.find(c => (c as any).name === channelName && c.isTextBased());
        }

        if (channel && channel.isTextBased()) {
            await (channel as TextChannel).send(gifUrl);
            console.log('스케줄러 동작: 움짤 전송 완료!');
        } else {
            console.error(`채널을 찾을 수 없거나 메시지 전송이 불가능합니다: ${channelId || channelName}`);
        }
    } catch (error) {
        console.error('스케줄된 메시지 전송 중 오류 발생:', error);
    }
};
