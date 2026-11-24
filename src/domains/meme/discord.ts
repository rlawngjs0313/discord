import {
    ChannelType, MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction,
} from 'discord.js';
import { memes, type MemeId } from './catalog';
import { buildMemeContext, recentUserMessages } from './context';
import type { MemeSelector } from './gemini';

export const memeCommandName = '밈';

const noMeme = '최근 대화에 어울리는 밈을 찾지 못했어요.';
const historyError = '이 채널의 메시지 기록을 읽을 수 없어요.';
const analysisError = '대화에 어울리는 밈을 고르는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
const publishError = '밈을 답장으로 올리지 못했어요. 잠시 후 다시 시도해 주세요.';
const imageLimit = 8 * 1024 * 1024;

async function memeFile(id: MemeId) {
    const meme = memes[id];
    const response = await fetch(meme.image, { signal: AbortSignal.timeout(5_000), redirect: 'error' });
    const length = Number(response.headers.get('content-length'));
    if (!response.ok || length > imageLimit || !/^image\/(jpeg|png|gif)(;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel();
        throw new Error('Meme image unavailable');
    }
    const attachment = Buffer.from(await response.arrayBuffer());
    if (!attachment.length || attachment.length > imageLimit) throw new Error('Invalid meme image size');
    return { attachment, name: `${id}.${meme.image.split('.').at(-1)}`, description: meme.name };
}

export async function replyWithMeme(interaction: ChatInputCommandInteraction, select?: MemeSelector) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!select) return await interaction.editReply('이 서버에서 밈 답장 기능을 사용할 수 없어요.');

    const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId).catch(() => null);
    if (!interaction.inGuild() || !channel || !(channel.type === ChannelType.GuildText || channel.isThread())) {
        return await interaction.editReply('서버의 텍스트 채널이나 스레드에서 실행해 주세요.');
    }
    if (!interaction.appPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
        || !interaction.memberPermissions?.has(PermissionFlagsBits.ReadMessageHistory)) {
        return await interaction.editReply(historyError);
    }
    const sendPermission = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    if (!interaction.appPermissions.has([sendPermission, PermissionFlagsBits.AttachFiles])) {
        return await interaction.editReply('이 채널에 밈을 답장으로 올릴 권한이 없어요.');
    }

    const history = await recentUserMessages(channel.messages, interaction.id).catch(() => null);
    if (!history) return await interaction.editReply(historyError);
    const { messages, pasted } = history;
    const target = messages.at(-1);

    let id: MemeId | null;
    try {
        const { transcript, images, unavailableImages } = await buildMemeContext(history);
        console.info('Discord meme history', JSON.stringify({
            interactionId: interaction.id, channelId: interaction.channelId,
            messageIds: messages.map(message => message.id), transcript,
            ...(pasted && { pastedMessageCount: pasted.length }),
            images: images.map(image => image.label), unavailableImages,
        }));
        if (!target) return await interaction.editReply(noMeme);
        id = await select(transcript, images);
    } catch {
        console.error('Discord meme selection failed.');
        return await interaction.editReply(analysisError);
    }
    if (id === null) return await interaction.editReply(noMeme);

    try {
        await target.reply({
            files: [await memeFile(id)],
            failIfNotExists: true,
            allowedMentions: { parse: [], repliedUser: false },
            flags: MessageFlags.SuppressNotifications,
        });
    } catch {
        console.error('Discord meme reply publishing failed.');
        return await interaction.editReply(publishError);
    }
    await interaction.deleteReply();
}
