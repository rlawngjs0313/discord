import { randomUUID } from 'node:crypto';
import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type InteractionEditReplyOptions, type ModalSubmitInteraction } from 'discord.js';
import type { Database, Tx } from '../../database/database';
import { InputError } from '../settlement/amount';
import { storeReply, type TokenCipher } from '../replies/store';

export type ReplyInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
export type ReplyView = Pick<InteractionEditReplyOptions, 'content' | 'components'> & {
    kind?: 'confirm' | 'detail';
    postId?: string;
    accountIds?: string[];
    recordIds?: string[];
};

type ReplyOptions = { visibility?: 'public' | 'private'; retryComponents?: ReplyView['components'] };

export function interactionReplies(db: Database, cipher: TokenCipher) {
    return async (interaction: ReplyInteraction, prepare: (tx: Tx, responseId: string) => Promise<ReplyView> | ReplyView,
        { visibility = 'private', retryComponents }: ReplyOptions = {}) => {
        await interaction.deferReply({ flags: visibility === 'private' ? MessageFlags.Ephemeral : undefined });
        const createdAt = new Date();
        const responseId = randomUUID();
        const stage = (build: typeof prepare) => db.transaction(async tx => {
            const view = await build(tx, responseId);
            if (visibility === 'public') return { view, row: null };
            const row = await storeReply(tx, {
                responseId,
                interactionId: interaction.id, interactionAt: interaction.createdTimestamp,
                ownerId: interaction.user.id, commandKind: view.kind ?? 'notice',
                encryptedToken: cipher.seal(interaction.token), createdAt, postId: view.postId,
                accountIds: view.accountIds, recordIds: view.recordIds,
            });
            return { view, row };
        });

        let result;
        try {
            result = await stage(prepare);
        } catch (error) {
            if (!(error instanceof InputError)) console.error('Discord reply transaction failed.');
            if (visibility === 'public') {
                await interaction.deleteReply().catch(() => undefined);
                return;
            }
            const content = error instanceof InputError ? error.message : '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
            try {
                result = await stage(() => ({ content, components: error instanceof InputError ? retryComponents : undefined }));
            } catch {
                // A failed registration must never publish an untracked payment result.
                await interaction.editReply({ content: '정산 정보를 열 수 없어요. 잠시 후 다시 시도해 주세요.' }).catch(() => undefined);
                return;
            }
        }

        const { view, row } = result;
        if (row) {
            const active = await db.prisma.privateResponse.findFirst({
                where: { responseId: row.responseId, state: 'active', tokenExpiresAt: { gt: new Date() } },
                select: { responseId: true },
            });
            if (!active) return;
        }
        await interaction.editReply({ content: view.content, components: view.components, allowedMentions: { parse: [] } });

        if (row && view.kind && view.postId) {
            await db.prisma.privateResponse.updateMany({
                where: {
                    scopePostId: view.postId, ownerId: interaction.user.id, commandKind: view.kind,
                    state: 'active', tokenExpiresAt: { gt: new Date() },
                    OR: [
                        { createdAt: { lt: row.createdAt } },
                        { createdAt: row.createdAt, interactionId: { lt: interaction.id } },
                    ],
                },
                data: { state: 'invalidated' },
            });
        }
    };
}
