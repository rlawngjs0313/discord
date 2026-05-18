import { 
    LavalinkManager, 
    LavalinkNodeOptions
} from 'lavalink-client';
import { 
    Message, 
    GuildMember, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType,
    ButtonInteraction,
    Client
} from 'discord.js';
import config from '../../config';

let lavalink: LavalinkManager;

/**
 * Lavalink 매니저 초기화
 */
export const initLavalink = (client: Client) => {
    // config.lavalink.nodes를 LavalinkNodeOptions 형식에 맞게 매핑
    const nodes: LavalinkNodeOptions[] = config.lavalink.nodes.map(node => ({
        host: node.host,
        port: node.port,
        authorization: node.password,
        secure: node.secure
    }));

    lavalink = new LavalinkManager({
        nodes: nodes,
        sendToShard: (guildId, payload) => {
            const guild = client.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        },
        client: {
            id: config.discord.clientId!,
            username: client.user?.username || 'Discord Bot',
        }
    });

    lavalink.nodeManager.on('connect', (node) => {
        console.log(`[Music] Lavalink 노드 연결 완료: ${node.options.host}`);
    });

    lavalink.nodeManager.on('error', (node, error) => {
        console.error(`[Music] Lavalink 노드(${node.options.host}) 에러:`, error.message);
    });

    return lavalink;
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
 * 컨트롤러 버튼 생성
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
 * 음악 재생 명령어 핸들러 (Lavalink 버전)
 */
export const handlePlayCommand = async (message: Message, args: string[]): Promise<void> => {
    const rawUrl = args[0];
    if (!rawUrl) {
        await message.reply('유튜브 링크를 입력해주세요!');
        return;
    }

    const url = normalizeYoutubeUrl(rawUrl);
    const member = message.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
        await message.reply('먼저 음성 채널에 들어가 있어야 합니다!');
        return;
    }

    try {
        // 1. 플레이어 생성 또는 가져오기
        let player = lavalink.players.get(message.guildId!);
        if (!player) {
            player = lavalink.createPlayer({
                guildId: message.guildId!,
                voiceChannelId: voiceChannel.id,
                textChannelId: message.channelId,
                selfDeaf: true,
            });
        }

        // 2. 음성 채널 연결
        if (!player.connected) await player.connect();

        // 3. 트랙 검색
        const res = await player.search({ query: url }, message.author);

        if (res.loadType === 'error') {
            throw new Error('검색 중 오류가 발생했습니다.');
        }
        if (res.loadType === 'empty') {
            await message.reply('결과를 찾을 수 없습니다.');
            return;
        }

        const track = res.tracks[0];
        if (!track) return;

        // 4. 재생
        await player.queue.add(track);
        if (!player.playing && !player.paused) await player.play();

        // 5. 임베드 UI 전송
        const duration = track.info.duration || 0;
        const embed = new EmbedBuilder()
            .setTitle(track.info.title || '제목 없음')
            .setURL(track.info.uri || null)
            .setAuthor({ name: track.info.author || 'YouTube' })
            .setThumbnail(track.info.artworkUrl || null)
            .addFields(
                { name: '길이', value: new Date(duration).toISOString().substr(14, 5), inline: true },
                { name: '요청자', value: message.author.username, inline: true }
            )
            .setColor(0x5865F2)
            .setTimestamp();

        const response = await (message.channel as any).send({
            embeds: [embed],
            components: [createControllerButtons()]
        });

        // 6. 인터랙션 콜렉터
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 3600000 
        });

        collector.on('collect', async (interaction: ButtonInteraction) => {
            const p = lavalink.players.get(interaction.guildId!);
            if (!p) return;

            if (interaction.customId === 'music_pause_resume') {
                if (p.paused) {
                    await p.resume();
                    await interaction.update({ components: [createControllerButtons(false)] });
                } else {
                    await p.pause();
                    await interaction.update({ components: [createControllerButtons(true)] });
                }
            } else if (interaction.customId === 'music_stop') {
                await p.destroy();
                await interaction.update({ content: '⏹ 음악 재생을 종료했습니다.', embeds: [], components: [] });
                collector.stop();
            }
        });

    } catch (error: any) {
        console.error('[Music] Lavalink 재생 에러:', error);
        await message.reply('음악 재생 중 오류가 발생했습니다.');
    }
};

export const handleStopCommand = async (message: Message): Promise<void> => {
    const player = lavalink.players.get(message.guildId!);
    if (player) {
        await player.destroy();
        await message.reply('음악을 정지했습니다.');
    } else {
        await message.reply('재생 중인 음악이 없습니다.');
    }
};
