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
import ytdl from '@distube/ytdl-core';

// 오디오 플레이어 관리
const player = createAudioPlayer({
    behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
    }
});

// 유튜브 요청을 위한 최적화된 옵션 (쿠키 없이 마지막 시도)
const YTDL_REQUEST_OPTIONS = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    }
};

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
        // 1. 음성 채널 연결
        connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        // 2. 비디오 정보 가져오기 (가장 완화된 필터 사용)
        const videoInfo = await ytdl.getInfo(url, { 
            requestOptions: YTDL_REQUEST_OPTIONS,
            // @ts-ignore (일부 옵션이 타입 정의에 없을 수 있음)
            lang: 'ko',
        });
        
        const { title, thumbnails, ownerChannelName, lengthSeconds } = videoInfo.videoDetails;
        const thumbnail = thumbnails[thumbnails.length - 1]?.url || '';

        // 3. 스트림 생성 및 재생
        const stream = ytdl.downloadFromInfo(videoInfo, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 25,
            requestOptions: YTDL_REQUEST_OPTIONS,
        });

        const resource = createAudioResource(stream, {
            inputType: StreamType.Arbitrary,
        });

        player.play(resource);
        connection.subscribe(player);

        // 4. 임베드 UI 전송
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setURL(url)
            .setAuthor({ name: ownerChannelName || 'YouTube' })
            .setThumbnail(thumbnail)
            .addFields(
                { name: '길이', value: `${Math.floor(parseInt(lengthSeconds) / 60)}분 ${parseInt(lengthSeconds) % 60}초`, inline: true },
                { name: '요청자', value: message.author.username, inline: true }
            )
            .setColor(0xff0000)
            .setTimestamp();

        const row = createControllerButtons();
        
        const channel = message.channel as any;
        const response = await channel.send({
            embeds: [embed],
            components: [row]
        });

        // 5. 버튼 이벤트 수집기 설정
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
        console.error('음악 재생 중 오류 발생:', error);
        if (connection) connection.destroy();
        
        let errorMsg = '음악을 재생하는 중 오류가 발생했습니다.';
        if (error.message.includes('formats') || error.message.includes('Sign in')) {
            errorMsg = '❌ **유튜브 차단 발생:** 쿠키(Cookies) 설정 없이 재생이 불가능한 영상입니다.\n확실한 재생을 위해 쿠키 등록 방식을 권장합니다.';
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
