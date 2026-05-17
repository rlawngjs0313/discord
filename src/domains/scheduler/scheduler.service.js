/**
 * 스케줄된 GIF 전송 로직
 * @param {import('discord.js').Client} client 
 * @param {string} channelName 
 * @param {string} gifUrl 
 */
const sendScheduledGif = async (client, channelName, gifUrl) => {
    if (!channelName) {
        console.error('스케줄된 메시지 전송 실패: channelName이 설정되지 않았습니다.');
        return;
    }

    try {
        const channel = client.channels.cache.find(c => c.name === channelName && c.isTextBased());
        
        if (channel && channel.isTextBased()) {
            await channel.send(gifUrl);
            console.log(`스케줄된 GIF 전송 완료: 채널명 "${channelName}"`);
        } else {
            console.error(`채널을 찾을 수 없거나 메시지 전송이 불가능한 채널입니다: "${channelName}"`);
        }
    } catch (error) {
        console.error('스케줄된 메시지 전송 중 오류 발생:', error);
    }
};

module.exports = { sendScheduledGif };
