import {
    ChannelType, MessageFlags, PermissionFlagsBits, escapeMarkdown, type ChatInputCommandInteraction,
    type InteractionEditReplyOptions,
} from 'discord.js';
import { buildMemeContext, recentUserMessages } from './context';
import type { MemeCandidate, MemeSelector } from './selector';

export const memeCommandName = '밈';

const noMeme = '최근 대화에 어울리는 밈을 찾지 못했어요.';
const historyError = '이 채널의 메시지 기록을 읽을 수 없어요.';
const analysisError = '대화에 어울리는 밈을 고르는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
const publishError = '밈을 보내지 못했어요. 잠시 후 다시 시도해 주세요.';

function searchPreview(query: string, candidates: readonly MemeCandidate[], resultId: string | null): InteractionEditReplyOptions {
    const lines = candidates.map(({ id, title, preview }) =>
        `#${id} · ${escapeMarkdown(title.replace(/\s+/g, ' ').slice(0, 120)) || '검색 이미지'}${preview ? '' : ' (썸네일 없음)'}`);
    const files = candidates.flatMap(({ id, title, preview }) => {
        if (!preview) return [];
        const extension = preview.mimeType === 'image/jpeg' ? 'jpg' : preview.mimeType.split('/')[1];
        return [{
            attachment: Buffer.from(preview.data, 'base64'),
            name: `candidate-${id}.${extension}`,
            description: `#${id} · ${title}`,
        }];
    });
    return {
        content: [
            `**검색어** · ${escapeMarkdown(query)}`,
            ...(lines.length ? lines : ['검색 후보 없음']),
            resultId ? `**Gemini 선택 #${resultId}**` : '어울리는 후보를 고르지 못했어요.',
        ].join('\n'),
        files, allowedMentions: { parse: [] },
    };
}

export async function sendMeme(interaction: ChatInputCommandInteraction, select?: MemeSelector, previewOnly = false) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!select) return await interaction.editReply('이 봇에 밈 검색용 API 키가 설정되어 있는지 확인해 주세요.');

    const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
    if (!interaction.inGuild() || !channel || !(channel.type === ChannelType.GuildText || channel.isThread())) {
        return await interaction.editReply('서버의 텍스트 채널이나 스레드에서 실행해 주세요.');
    }
    if (!interaction.appPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
        || !interaction.memberPermissions?.has(PermissionFlagsBits.ReadMessageHistory)) {
        return await interaction.editReply(historyError);
    }
    const sendPermission = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    if (!previewOnly && !interaction.appPermissions.has([sendPermission, PermissionFlagsBits.AttachFiles])) {
        return await interaction.editReply('이 채널에 밈을 보낼 권한이 없어요.');
    }

    const history = await recentUserMessages(channel.messages, interaction.id).catch(() => null);
    if (!history) return await interaction.editReply(historyError);
    const { messages, pasted } = history;

    let selection: Awaited<ReturnType<MemeSelector>>;
    try {
        const { conversation, transcript, images, unavailableImages } = await buildMemeContext(history);
        console.info('Discord meme history', JSON.stringify({
            interactionId: interaction.id, channelId: interaction.channelId,
            messageIds: messages.map(message => message.id), transcript,
            ...(pasted && { pastedMessageCount: pasted.length }),
            images: images.map(image => image.label), unavailableImages,
        }));
        if (!messages.length) return await interaction.editReply(noMeme);
        selection = previewOnly ? await select(conversation, images, 'preview') : await select(conversation, images);
    } catch (error) {
        const status = error instanceof Error && /^(Brave|Gemini) HTTP \d{3}$/.test(error.message) ? error.message : undefined;
        console.error('Discord meme selection failed.', status ?? 'Unexpected error');
        return await interaction.editReply(analysisError);
    }
    console.info('Discord meme search', JSON.stringify({
        interactionId: interaction.id, query: selection.query, messageNumbers: selection.messageNumbers,
        ...(selection.concept && { concept: selection.concept, kind: selection.kind }),
        ...(previewOnly && { mode: 'preview', candidateCount: selection.candidates?.length ?? 0 }),
        resultId: selection.resultId, downloaded: Boolean(selection.file),
    }));
    if (previewOnly) {
        if (!selection.query) return await interaction.editReply(noMeme);
        const preview = searchPreview(selection.query, selection.candidates ?? [], selection.resultId);
        try {
            return await interaction.editReply(preview);
        } catch {
            console.error('Discord meme search preview failed.');
            return await interaction.editReply({ content: preview.content + '\n이미지 미리보기를 첨부하지 못했어요.', allowedMentions: { parse: [] } });
        }
    }
    if (selection.resultId === null) return await interaction.editReply(noMeme);
    if (!selection.file) return await interaction.editReply(publishError);

    try {
        await channel.send({
            files: [selection.file],
            allowedMentions: { parse: [] },
            flags: MessageFlags.SuppressNotifications,
        });
    } catch {
        console.error('Discord meme publishing failed.');
        return await interaction.editReply(publishError);
    }
    await interaction.deleteReply();
}
