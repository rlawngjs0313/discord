import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    VoiceConnectionStatus,
    getVoiceConnection,
    NoSubscriberBehavior,
    VoiceConnection
} from '@discordjs/voice';
import { Message, GuildMember } from 'discord.js';
import play from 'play-dl';

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
 * @param url 입력된 URL
 * @returns 표준화된 URL
 */
const normalizeYoutubeUrl = (url: string): string => {
    try {
        const urlObj = new URL(url);
        // youtu.be 단축 URL인 경우
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
 * @param message 디스코드 메시지
 * @param args 명령어 인자 (URL)
 */
export const handlePlayCommand = async (message: Message, args: string[]): Promise<void> => {
    let rawUrl = args[0];

    if (!rawUrl) {
        await message.reply('유튜브 링크를 입력해주세요! (예: !재생 <URL>)');
        return;
    }

    // URL 표준화 처리
    const url = normalizeYoutubeUrl(rawUrl);
    console.log(`URL 표준화: ${rawUrl} -> ${url}`);

    // URL 유효성 검사
    const validation = await play.validate(url);
    if (!validation || (validation !== 'yt_video' && validation !== 'yt_playlist')) {
        await message.reply('유효한 유튜브 링크가 아닙니다.');
        return;
    }

    const member = message.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        await message.reply('먼저 음성 채널에 들어가 있어야 합니다!');
        return;
    }

    // 권한 확인
    const permissions = voiceChannel.permissionsFor(message.client.user!);
    if (!permissions || !permissions.has('Connect') || !permissions.has('Speak')) {
        await message.reply('음성 채널에 연결하거나 말할 권한이 없습니다!');
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

        connection.on('error', error => {
            console.error(`음성 연결 오류: ${error.message}`);
            if (connection) {
                connection.destroy();
                connection = undefined;
            }
        });

        // 유튜브 정보 가져오기 (로그용)
        const videoInfo = await play.video_info(url);
        console.log(`재생 시도 중: ${videoInfo.video_details.title}`);

        // 스트림 생성 (가장 안정적인 play.stream 사용)
        const stream = await play.stream(url, {
            quality: 2, // 높은 품질 우선
            discordPlayerCompatibility: true // 디스코드 호환성 모드 활성화
        });
        
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type
        });

        player.play(resource);
        connection.subscribe(player);

        await message.reply(`🎵 **재생 시작:** ${videoInfo.video_details.title}`);
    } catch (error: any) {
        console.error('음악 재생 중 오류 발생:', error);
        
        // 재생 실패 시 연결 해제
        if (connection) {
            connection.destroy();
        }
        
        const errorMsg = error.message.includes('Sign in') 
            ? '유튜브에서 봇을 차단했습니다. 쿠키 설정이 필요할 수 있습니다.' 
            : '음악을 재생하는 중 오류가 발생했습니다. 링크가 올바른지 다시 확인해주세요.';
            
        await message.reply(errorMsg);
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
