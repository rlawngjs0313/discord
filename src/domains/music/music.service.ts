import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    VoiceConnectionStatus,
    getVoiceConnection,
    NoSubscriberBehavior,
    VoiceConnection,
    StreamType
} from '@discordjs/voice';
import { Message, GuildMember } from 'discord.js';
import ytdl from '@distube/ytdl-core';

// 오디오 플레이어 싱글톤 관리
const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
    }
});

player.on(AudioPlayerStatus.Playing, () => {
    console.log('오디오 플레이어: 재생 시작');
});

player.on('error', error => {
    console.error(`오디오 플레이어 오류: ${error.message}`);
});

/**
 * 유튜브 URL 표준화 (단축 URL 변환)
 */
const normalizeYoutubeUrl = (url: string): string => {
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'youtu.be') {
            const videoId = urlObj.pathname.substring(1);
            const searchParams = urlObj.search;
            return `https://www.youtube.com/watch?v=${videoId}${searchParams ? '&' + searchParams.substring(1) : ''}`;
        }
        return url;
    } catch (e) {
        return url;
    }
};

/**
 * 음악 재생 명령어 핸들러
 */
export const handlePlayCommand = async (message: Message, args: string[]): Promise<void> => {
    let rawUrl = args[0];

    if (!rawUrl) {
        await message.reply('유튜브 링크를 입력해주세요! (예: !재생 <URL>)');
        return;
    }

    const url = normalizeYoutubeUrl(rawUrl);
    
    // ytdl을 이용한 URL 유효성 검사
    if (!ytdl.validateURL(url)) {
        await message.reply('유효한 유튜브 링크가 아닙니다.');
        return;
    }

    const member = message.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        await message.reply('먼저 음성 채널에 들어가 있어야 합니다!');
        return;
    }

    let connection: VoiceConnection | undefined;

    try {
        // 음성 채널 연결
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('음성 채널 연결 완료!');
        });

        // 스트림 생성 (@distube/ytdl-core 사용)
        const stream = ytdl(url, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25, // 버퍼링 방지
        });

        const resource = createAudioResource(stream, {
            inputType: StreamType.Arbitrary,
        });

        player.play(resource);
        connection.subscribe(player);

        // 비디오 정보 가져오기 (비동기)
        ytdl.getBasicInfo(url).then(info => {
            message.reply(`🎵 **재생 시작:** ${info.videoDetails.title}`);
        }).catch(() => {
            message.reply(`🎵 **재생 시작:** ${url}`);
        });

    } catch (error: any) {
        console.error('음악 재생 중 오류 발생:', error);
        if (connection) connection.destroy();
        await message.reply('음악을 재생하는 중 오류가 발생했습니다.');
    }
};

/**
 * 음악 정지 명령어 핸들러
 */
export const handleStopCommand = async (message: Message): Promise<void> => {
    const connection = getVoiceConnection(message.guildId!);
    if (connection) {
        player.stop();
        connection.destroy();
        await message.reply('음악을 정지하고 채널에서 나갑니다.');
    } else {
        await message.reply('현재 재생 중인 음악이 없습니다.');
    }
};
