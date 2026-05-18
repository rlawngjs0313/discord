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
 * 음악 재생 명령어 핸들러
 * @param message 디스코드 메시지
 * @param args 명령어 인자 (URL)
 */
export const handlePlayCommand = async (message: Message, args: string[]): Promise<void> => {
    const url = args[0];

    if (!url) {
        await message.reply('유튜브 링크를 입력해주세요! (예: !재생 <URL>)');
        return;
    }

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

        // 유튜브 정보 가져오기 및 스트림 생성
        const videoInfo = await play.video_info(url);
        const stream = await play.stream_from_info(videoInfo);
        
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type
        });

        player.play(resource);
        connection.subscribe(player);

        await message.reply(`🎵 **재생 시작:** ${videoInfo.video_details.title}`);
    } catch (error) {
        console.error('음악 재생 중 오류 발생:', error);
        
        // 재생 실패 시 연결 해제
        if (connection) {
            connection.destroy();
        }
        
        await message.reply('음악을 재생하는 중 오류가 발생했습니다. 링크가 올바른지 다시 확인해주세요.');
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
