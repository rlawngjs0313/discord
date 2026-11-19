import { randomUUID } from 'node:crypto';
import type { Tx } from '../../database/database';
import type { Prisma } from '../../generated/prisma/client';
import { invalidateSettlement } from '../replies/store';
import { InputError, splitWon } from './amount';

export type Post = { postId: string; guildId: string; forumId: string };
export type Owner = { postId: string; recordId: string; creatorId: string };
export type SettlementInput = { totalWon: bigint; userIds: string[] };

const recentFirst = [{ createdAt: 'desc' }, { recordId: 'desc' }] satisfies Prisma.SettlementRecordOrderByWithRelationInput[];
const unavailable = () => new InputError('기록을 변경할 수 없어요. /정산세부에서 최신 기록을 다시 열어 주세요.');

export async function createSettlement(tx: Tx, post: Post, creatorId: string, interactionId: string, input: SettlementInput) {
    await tx.settlementPost.createMany({ data: [post], skipDuplicates: true });
    const recordId = randomUUID();
    const created = await tx.settlementRecord.createMany({
        data: [{ recordId, postId: post.postId, creatorId, createInteractionId: interactionId, totalWon: input.totalWon }],
        skipDuplicates: true,
    });
    if (created.count === 0) {
        return tx.settlementRecord.findFirstOrThrow({
            where: { postId: post.postId, creatorId, createInteractionId: interactionId },
            include: { shares: true },
        });
    }
    const shares = splitWon(input.totalWon, input.userIds);
    await tx.settlementShare.createMany({ data: shares.map(share => ({ ...share, recordId })) });
    return { recordId, shares, totalWon: input.totalWon };
}

export function loadOwnedRecord(db: Pick<Tx, 'settlementRecord'>, owner: Owner) {
    return db.settlementRecord.findFirst({
        where: { ...owner, cancelledAt: null },
        include: { shares: true },
    });
}

export async function editSettlement(tx: Tx, owner: Owner, version: number, input: SettlementInput) {
    const existing = await loadOwnedRecord(tx, owner);
    if (!existing || existing.version !== version) throw unavailable();
    const before = new Set(existing.shares.map(share => share.userId));
    if (existing.totalWon === input.totalWon && before.size === input.userIds.length
        && input.userIds.every(user => before.has(user))) return { ...existing, changed: false };

    const changed = await tx.settlementRecord.updateMany({
        where: { ...owner, version, cancelledAt: null },
        data: { totalWon: input.totalWon, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw unavailable();
    const shares = splitWon(input.totalWon, input.userIds);
    await tx.settlementShare.deleteMany({ where: { recordId: owner.recordId } });
    await tx.settlementShare.createMany({ data: shares.map(share => ({ ...share, recordId: owner.recordId })) });
    await invalidateSettlement(tx, owner.recordId, owner.postId, [...new Set([...before, ...input.userIds])]);
    return { recordId: owner.recordId, totalWon: input.totalWon, shares, changed: true };
}

export async function cancelSettlement(tx: Tx, owner: Owner, version: number) {
    const changed = await tx.settlementRecord.updateMany({
        where: { ...owner, version, cancelledAt: null },
        data: { cancelledAt: new Date(), version: { increment: 1 } },
    });
    if (changed.count !== 1) throw unavailable();
    const participants = await tx.settlementShare.findMany({
        where: { recordId: owner.recordId }, select: { userId: true },
    });
    await invalidateSettlement(tx, owner.recordId, owner.postId, participants.map(share => share.userId));
}

export async function getTransfers(tx: Tx, postId: string, userId: string) {
    const shares = await tx.settlementShare.findMany({
        where: { userId, shareWon: { gt: 0n }, record: { postId, cancelledAt: null, creatorId: { not: userId } } },
        select: { recordId: true, shareWon: true, record: { select: { creatorId: true } } },
    });
    const totals = new Map<string, { amount: bigint; recordIds: string[] }>();
    for (const share of shares) {
        const recipient = share.record.creatorId;
        const item = totals.get(recipient) ?? { amount: 0n, recordIds: [] };
        item.amount += share.shareWon;
        item.recordIds.push(share.recordId);
        totals.set(recipient, item);
    }
    const recipients = [...totals.keys()].sort();
    const accounts = recipients.length
        ? await tx.userBankAccount.findMany({ where: { userId: { in: recipients } } })
        : [];
    const byUser = new Map(accounts.map(account => [account.userId, account]));
    return recipients.map(recipientId => ({
        recipientId, ...totals.get(recipientId)!, account: byUser.get(recipientId),
    }));
}

export async function getDetail(tx: Tx, postId: string, userId: string, requestedPage: number) {
    const where = { postId, cancelledAt: null, shares: { some: { userId } } };
    const count = await tx.settlementRecord.count({ where });
    const page = Math.max(1, Math.min(requestedPage, count));
    const record = count === 0 ? null : await tx.settlementRecord.findFirst({
        where,
        skip: page - 1,
        orderBy: recentFirst,
        include: {
            shares: { where: { OR: [{ userId }, { record: { creatorId: userId } }] }, orderBy: { userId: 'asc' } },
        },
    });
    return { page, count, record };
}
