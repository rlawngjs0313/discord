import {
    ActionRowBuilder, ApplicationIntegrationType, ButtonBuilder, ButtonStyle, ChannelType,
    ComponentType, InteractionContextType, LabelBuilder, ModalBuilder, REST, Routes, SlashCommandBuilder,
    StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder, type ButtonInteraction, type Interaction,
} from 'discord.js';
import type { Database, Tx } from '../../database/database';
import { deleteAccount, saveAccount } from '../account/accounts';
import { accountBankName, bankOptions, normalizeAccount } from '../account/bank';
import type { TokenCipher } from '../replies/store';
import { InputError, parseWon, won } from '../settlement/amount';
import {
    cancelSettlement, createSettlement, editSettlement, getDetail, getTransfers,
    loadOwnedRecord, type Post,
} from '../settlement/settlements';
import { privateReplies, type ReplyInteraction, type ReplyView } from './private-reply';

const commandBuilders = [
    new SlashCommandBuilder().setName('정산').setDescription('이 포럼 포스트에 정산 기록을 추가해요.'),
    new SlashCommandBuilder().setName('정산확인').setDescription('이 포스트에서 내가 보낼 돈을 상대별로 확인해요.'),
    new SlashCommandBuilder().setName('정산세부').setDescription('이 포스트에서 나와 관련된 정산을 한 건씩 확인해요.'),
    new SlashCommandBuilder().setName('계좌등록').setDescription('정산에 사용할 내 계좌를 등록하거나 바꿔요.'),
    new SlashCommandBuilder().setName('계좌삭제').setDescription('정산에 등록한 내 계좌를 삭제해요.'),
];

export async function registerCommands(token: string, applicationId: string, guildId?: string) {
    const rest = new REST().setToken(token);
    const body = commandBuilders.map(command => {
        if (guildId) return command.toJSON();
        return {
            ...command.toJSON(), contexts: [InteractionContextType.Guild],
            integration_types: [ApplicationIntegrationType.GuildInstall],
        };
    });
    await rest.put(guildId ? Routes.applicationGuildCommands(applicationId, guildId)
        : Routes.applicationCommands(applicationId), { body });
}

async function forumPost(interaction: ReplyInteraction): Promise<Post> {
    const channel = interaction.channel ?? (interaction.channelId
        ? await interaction.client.channels.fetch(interaction.channelId) : null);
    if (interaction.guildId && channel?.type === ChannelType.PublicThread && channel.parentId
        && channel.guildId === interaction.guildId) {
        const parent = channel.parent ?? await interaction.client.channels.fetch(channel.parentId);
        if (parent?.type === ChannelType.GuildForum) {
            return { postId: channel.id, guildId: channel.guildId, forumId: parent.id };
        }
    }
    throw new InputError('포럼의 포스트를 열고 그 안에서 명령을 실행해 주세요.');
}

const button = (customId: string, label: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const row = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
const notice = (content: string, ...buttons: ButtonBuilder[]): ReplyView =>
    ({ content, components: buttons.length ? [row(...buttons)] : [] });

function textLabel(id: string, label: string, max: number, value?: string, placeholder?: string) {
    const input = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max);
    if (value !== undefined) input.setValue(value);
    if (placeholder) input.setPlaceholder(placeholder);
    return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

export function settlementModal(id: string, existing?: { totalWon: bigint; userIds: string[] }) {
    const users = new UserSelectMenuBuilder().setCustomId('users').setPlaceholder('선택')
        .setRequired(true).setMinValues(1).setMaxValues(25);
    if (existing?.userIds.length) users.setDefaultUsers(existing.userIds);
    return new ModalBuilder().setCustomId(id).setTitle(existing ? '정산 수정' : '정산 등록')
        .addLabelComponents(new LabelBuilder().setLabel('대상').setUserSelectMenuComponent(users),
            textLabel('total', '총액', 24, existing?.totalWon.toString(), '예: 10,000원'));
}

function bankModal(actor: string) {
    const bank = new StringSelectMenuBuilder().setCustomId('bank-code').setPlaceholder('선택')
        .setRequired(true).setMinValues(1).setMaxValues(1).addOptions(bankOptions);
    return new ModalBuilder().setCustomId('bank:' + actor).setTitle('계좌 등록')
        .addLabelComponents(new LabelBuilder().setLabel('은행명').setStringSelectMenuComponent(bank),
            textLabel('number', '계좌번호', 36), textLabel('holder', '예금주명', 40));
}

function splitPages(lines: string[]) {
    const pages: string[] = [];
    let page = '';
    for (const line of lines) {
        if (page && page.length + line.length + 2 > 1_850) {
            pages.push(page);
            page = '';
        }
        page += (page ? '\n\n' : '') + line;
    }
    if (page) pages.push(page);
    return pages;
}

function nav(key: string, page: number, count: number) {
    return [button(key + ':' + Math.max(1, page - 1), '이전').setDisabled(page <= 1),
        button(key + ':' + (page + 1), '다음').setDisabled(page >= count)];
}

const transfers = (creator: string, shares: { userId: string; shareWon: bigint }[]) =>
    shares.filter(s => s.userId !== creator && s.shareWon > 0n)
        .map(s => '<@' + s.userId + '> → <@' + creator + '>: ' + won(s.shareWon));

const idPattern = /^\d{17,20}$/;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const codeSafe = (s: string) => s.replaceAll('`', 'ˋ');

export function commandHandler(db: Database, cipher: TokenCipher) {
    const send = privateReplies(db, cipher);
    const editingDetail = new Set<string>();

    async function confirm(i: ReplyInteraction, post: Post, requestedPage: number) {
        await send(i, async tx => {
            const rows = await getTransfers(tx, post.postId, i.user.id);
            const items = rows.map(item => {
                let line = '<@' + i.user.id + '> → <@' + item.recipientId + '>: ' + won(item.amount);
                if (item.account) {
                    const account = item.account;
                    line += '\n```\n' + accountBankName(account.bankCode) + ' ' + account.formattedAccountNumber
                        + ' ' + codeSafe(account.accountHolder) + '\n```';
                }
                return line;
            });
            const pages = splitPages(items);
            const page = Math.max(1, Math.min(pages.length, requestedPage));
            return {
                kind: 'confirm', postId: post.postId,
                content: '보낼 금액' + (pages.length > 1 ? ' · ' + page + '/' + pages.length : '')
                    + '\n' + (pages[page - 1] ?? '보낼 금액이 없어요.')
                    + '\n\n최신 금액과 계좌는 /정산확인으로 다시 확인하세요.',
                components: pages.length > 1 ? [row(...nav('confirm:' + i.user.id + ':' + post.postId, page, pages.length))] : [],
                accountIds: rows.map(item => item.recipientId),
                recordIds: rows.flatMap(item => item.recordIds),
            };
        });
    }

    async function detailView(tx: Tx, postId: string, actor: string, responseId: string, requestedPage: number): Promise<ReplyView> {
        const { page, count, record } = await getDetail(tx, postId, actor, requestedPage);
        if (!record) return { ...notice('이 포스트에 나와 관련된 정산 기록이 없어요.'), kind: 'detail', postId };
        const owned = record.creatorId === actor;
        const key = ':' + actor + ':' + postId + ':' + record.recordId + ':' + record.version;
        const controls = nav('detail:' + actor + ':' + responseId, page, count);
        if (owned) controls.push(button('edit' + key, '수정'), button('cancel' + key, '취소', ButtonStyle.Danger));
        return {
            kind: 'detail', postId, recordIds: [record.recordId], components: [row(...controls)],
            content: '정산 ' + page + '/' + count + ' · <t:' + Math.floor(record.createdAt.getTime() / 1000) + ':f>'
                + (owned ? ' · 총 ' + won(record.totalWon) : '')
                + '\n' + (transfers(record.creatorId, record.shares).join('\n') || '보낼 금액이 없어요.'),
        };
    }

    async function flipDetail(i: ButtonInteraction, postId: string, responseId: string, page: number) {
        if (editingDetail.has(responseId)) return await i.deferUpdate();
        editingDetail.add(responseId);
        try {
            await i.deferUpdate();
            const activeDetail = () => ({
                responseId, ownerId: i.user.id, scopePostId: postId, commandKind: 'detail', state: 'active',
                scheduledDeleteAt: { gt: new Date() }, tokenExpiresAt: { gt: new Date() },
            });
            const view = await db.transaction(async tx => {
                const active = await tx.privateResponse.findFirst({ where: activeDetail(), select: { responseId: true } });
                if (!active) return;
                const next = await detailView(tx, postId, i.user.id, responseId, page);
                const recordIds = next.recordIds ?? [];
                await tx.privateResponseRecord.deleteMany({ where: recordIds.length
                    ? { responseId, recordId: { notIn: recordIds } } : { responseId } });
                if (recordIds.length) {
                    await tx.privateResponseRecord.createMany({
                        data: recordIds.map(recordId => ({ responseId, recordId })), skipDuplicates: true,
                    });
                }
                return next;
            });
            if (!view || !await db.prisma.privateResponse.findFirst({ where: activeDetail(), select: { responseId: true } })) return;
            await i.editReply({ content: view.content, components: view.components, allowedMentions: { parse: [] } });
        } finally {
            editingDetail.delete(responseId);
        }
    }

    return async (i: Interaction) => {
        if (!i.isChatInputCommand() && !i.isButton() && !i.isModalSubmit()) return;
        const actor = i.user.id;

        try {
            if (i.isChatInputCommand()) {
                if (!i.inGuild()) throw new InputError('서버에서 명령을 실행해 주세요.');
                if (i.commandName === '계좌등록') return await i.showModal(bankModal(actor));
                if (i.commandName === '계좌삭제') {
                    return await send(i, () => notice('등록한 계좌를 삭제할까요?', button('bank-delete:' + actor, '계좌 삭제', ButtonStyle.Danger)));
                }
                if (!['정산', '정산확인', '정산세부'].includes(i.commandName)) return;
                const post = await forumPost(i);
                if (i.commandName === '정산') return await i.showModal(settlementModal('create:' + actor + ':' + post.postId));
                if (i.commandName === '정산확인') return await confirm(i, post, 1);
                return await send(i, (tx, responseId) => detailView(tx, post.postId, actor, responseId, 1));
            }

            const [action, ownerId, scope, recordId, versionText] = i.customId.split(':');
            if (ownerId !== actor || !i.inGuild()) throw new InputError('이 요청은 처음 명령을 실행한 사람만 사용할 수 있어요.');

            if (action === 'bank' && i.isModalSubmit()) {
                return await send(i, async tx => {
                    if (scope) throw new InputError('새 계좌 등록 양식을 다시 열어 주세요.');
                    const bank = i.fields.fields.get('bank-code');
                    const values = bank?.type === ComponentType.StringSelect ? bank.values ?? [] : [];
                    const [code] = values;
                    if (values.length !== 1 || !code) throw new InputError('목록에서 은행 하나를 선택해 주세요.');
                    const account = normalizeAccount(code, i.fields.getTextInputValue('number'), i.fields.getTextInputValue('holder'));
                    await saveAccount(tx, actor, account);
                    return notice('정산 계좌를 등록했어요.');
                }, [row(button('bank-retry:' + actor, '다시 입력'))]);
            }
            if (action === 'bank-retry' && i.isButton()) return await i.showModal(bankModal(actor));
            if (action === 'bank-delete' && i.isButton()) {
                return await send(i, async tx => {
                    await deleteAccount(tx, actor);
                    return notice('등록한 계좌를 삭제했어요.');
                });
            }

            const post = await forumPost(i);
            if (i.isButton() && action === 'detail') {
                const page = Number(recordId);
                if (!scope || !uuidPattern.test(scope) || !Number.isSafeInteger(page) || page < 1) {
                    throw new InputError('/정산세부로 다시 열어 주세요.');
                }
                return await flipDetail(i, post.postId, scope, page);
            }
            if (scope !== post.postId || !idPattern.test(scope)) throw new InputError('원래 정산 포스트에서 다시 실행해 주세요.');
            if (i.isButton() && action === 'confirm') {
                const page = Number(recordId);
                if (!Number.isSafeInteger(page) || page < 1) throw new InputError('첫 페이지부터 다시 열어 주세요.');
                return await confirm(i, post, page);
            }

            if (action === 'retry' && i.isButton()) return await i.showModal(settlementModal('create:' + actor + ':' + scope));
            const owner = { postId: post.postId, recordId: recordId ?? '', creatorId: actor };
            const version = Number(versionText);
            const isRecord = uuidPattern.test(owner.recordId) && Number.isSafeInteger(version) && version > 0;
            const key = ':' + actor + ':' + scope + ':' + owner.recordId + ':' + version;
            if (i.isButton() && isRecord && (action === 'edit' || action === 'cancel')) {
                const record = await loadOwnedRecord(db.prisma, owner);
                if (record?.version !== version) throw new InputError('정산 기록이 바뀌었어요. /정산세부에서 다시 열어 주세요.');
                if (action === 'edit') return await i.showModal(settlementModal('save' + key, {
                    totalWon: record.totalWon, userIds: record.shares.map(s => s.userId).filter(id => id !== actor),
                }));
                return await send(i, () => ({
                    ...notice('이 정산 기록을 취소할까요?', button('cancel-ok' + key, '정산 취소', ButtonStyle.Danger)),
                    postId: post.postId, recordIds: [record.recordId],
                }));
            }
            if (i.isButton() && isRecord && action === 'cancel-ok') {
                return await send(i, async tx => {
                    await cancelSettlement(tx, owner, version);
                    return notice('정산 기록을 취소했어요.');
                });
            }
            if (i.isModalSubmit() && (action === 'create' || (action === 'save' && isRecord))) {
                const retry = action === 'create' ? 'retry:' + actor + ':' + scope : 'edit' + key;
                return await send(i, async tx => {
                    if (i.fields.getField('users')?.type !== ComponentType.UserSelect) throw new InputError('사용자를 선택해 주세요.');
                    const selected = i.fields.getSelectedUsers('users', true);
                    const members = i.fields.getSelectedMembers('users');
                    const ids = [...selected.values()].filter(user => user.id !== actor);
                    if (ids.length < 1 || ids.length > 25 || ids.some(user => user.bot || !members?.has(user.id))) {
                        throw new InputError('현재 서버에 있는 사람을 한 명 이상 선택해 주세요.');
                    }
                    const input = { totalWon: parseWon(i.fields.getTextInputValue('total')), userIds: [actor, ...ids.map(user => user.id)] };
                    const record = action === 'create' ? await createSettlement(tx, post, actor, i.id, input)
                        : await editSettlement(tx, owner, version, input);
                    return {
                        postId: post.postId, recordIds: [record.recordId],
                        content: (action === 'create' ? '정산 등록' : '정산 수정') + ' · 총 ' + won(record.totalWon)
                            + '\n' + (transfers(actor, record.shares).join('\n') || '받을 금액이 없어요.'),
                    };
                }, [row(button(retry, '다시 입력'))]);
            }
            throw new InputError('이 화면에서는 처리할 수 없어요. 명령을 다시 실행해 주세요.');
        } catch (error) {
            if (!(error instanceof InputError)) console.error('Discord interaction failed.');
            if (!i.deferred && !i.replied) {
                await send(i, () => notice(error instanceof InputError ? error.message : '처리하지 못했어요. 다시 시도해 주세요.'))
                    .catch(() => undefined);
            }
        }
    };
}
