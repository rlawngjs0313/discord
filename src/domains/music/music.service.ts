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
import { 
    Message, 
    GuildMember, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType,
    ButtonInteraction
} from 'discord.js';
import play from 'play-dl';
import fs from 'fs-extra';
import path from 'path';

// 오디오 플레이어 관리
const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
    }
});

// 유튜브 쿠키 설정 경로
const COOKIE_PATH = path.join(process.cwd(), 'youtube-cookies.json');

/**
 * play-dl 인증 설정 (쿠키 주입)
 */
const setupYoutubeAuth = async () => {
    try {
        if (fs.existsSync(COOKIE_PATH)) {
            const cookies = fs.readJSONSync(COOKIE_PATH);
            console.log(`유튜브 쿠키 파일을 찾았습니다. (${cookies.length}개의 쿠키)`);
            
            // JSON 쿠키 배열을 문자열 형식으로 변환
            const cookieString = cookies
                .map((c: any) => `${c.name}=${c.value}`)
                .join('; ');
            
            await play.setToken({
                youtube: {
                    cookie: cookieString
                }
            });
            console.log('play-dl 유튜브 인증 설정 완료');
        } else {
            console.warn('유튜브 쿠키 파일이 없어 인증 없이 시도합니다.');
        }
    } catch (error) {
        console.error('유튜브 인증 설정 중 오류 발생:', error);
    }
};

// 초기 실행 시 인증 설정
setupYoutubeAuth();

/**
 * 유튜브 URL 표준화
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
 * 음악 플레이어 컨트롤러 버튼 생성
 */
const createControllerButtons = (isPaused: boolean = false) => {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('music_pause_resume')
            .setLabel(isPaused ? '▶️ 재생' : '⏸ 일시정지')
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('music_stop')
            .setLabel('⏹ 정지')
            .setStyle(ButtonStyle.Danger)
    );
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

    let connection: VoiceConnection | undefined;

    try {
        // 1. 음성 채널 연결
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        // 2. 비디오 정보 가져오기
        console.log(`비디오 정보 조회 중: ${url}`);
        const videoInfo = await play.video_info(url);
        const { title, thumbnails, channel, durationRaw } = videoInfo.video_details;
        const thumbnail = thumbnails[thumbnails.length - 1]?.url || '';
        
        console.log(`비디오 정보 획득 완료: ${title}`);

        // 3. 스트림 생성 및 재생 (videoInfo를 직접 전달하여 중복 요청 방지)
        console.log('스트림 생성 시도...');
        const stream = await play.stream_from_info(videoInfo, {
            quality: 2
        });

        if (!stream || !stream.stream) {
            throw new Error('유효한 오디오 스트림을 생성할 수 없습니다.');
        }

        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
        });

        player.play(resource);
        connection.subscribe(player);

        // 4. 임베드 UI 전송
        const embed = new EmbedBuilder()
            .setTitle(title || '제목 없음')
            .setURL(url)
            .setAuthor({ name: channel?.name || 'YouTube' })
            .setThumbnail(thumbnail)
            .addFields(
                { name: '길이', value: durationRaw || '알 수 없음', inline: true },
                { name: '요청자', value: message.author.username, inline: true }
            )
            .setColor(0xff0000)
            .setTimestamp();

        const row = createControllerButtons();
        
        const channelObj = message.channel as any;
        const response = await channelObj.send({
            embeds: [embed],
            components: [row]
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 3600000 
        });

        collector.on('collect', async (interaction: ButtonInteraction) => {
            if (interaction.customId === 'music_pause_resume') {
                if (player.state.status === AudioPlayerStatus.Paused) {
                    player.unpause();
                    await interaction.update({ components: [createControllerButtons(false)] });
                } else {
                    player.pause();
                    await interaction.update({ components: [createControllerButtons(true)] });
                }
            } else if (interaction.customId === 'music_stop') {
                player.stop();
                connection?.destroy();
                await interaction.update({ content: '⏹ 음악 재생을 종료했습니다.', embeds: [], components: [] });
                collector.stop();
            }
        });

    } catch (error: any) {
        console.error('음악 재생 중 상세 오류:', error);
        if (connection) connection.destroy();
        
        let errorMsg = '음악을 재생하는 중 오류가 발생했습니다.';
        if (error.message.includes('Sign in') || error.message.includes('403') || error.message.includes('format')) {
            errorMsg = '❌ **유튜브 재생 불가:** 유튜브의 차단 정책이나 유효하지 않은 쿠키 때문에 재생이 막혔습니다. 쿠키를 새로고침한 뒤 다시 시도해 주세요.';
        }
        
        await message.reply(errorMsg);
    }
};

/**
 * 단순 정지 명령어
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
