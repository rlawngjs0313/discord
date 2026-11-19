import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Tx } from '../../database/database';

export const replyLifetime = 14 * 60 * 1000;
export const tokenLifetime = 15 * 60 * 1000;

export function tokenCipher(key: Buffer) {
    if (key.length !== 32) throw new Error('DISCORD_RESPONSE_KEY must decode to 32 bytes.');
    return {
        seal(token: string) {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
        },
        open(payload: Uint8Array) {
            const bytes = Buffer.from(payload);
            const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
            decipher.setAuthTag(bytes.subarray(12, 28));
            return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
        },
    };
}

export type TokenCipher = ReturnType<typeof tokenCipher>;

export async function storeReply(tx: Tx, reply: {
    responseId?: string;
    interactionId: string;
    ownerId: string;
    commandKind: string;
    encryptedToken: Uint8Array;
    createdAt: Date;
    interactionAt: number;
    postId?: string;
    accountIds?: string[];
    recordIds?: string[];
}) {
    const accounts = [...new Set(reply.accountIds)].map(accountUserId => ({ accountUserId }));
    const records = [...new Set(reply.recordIds)].map(recordId => ({ recordId }));
    return tx.privateResponse.create({
        data: {
            responseId: reply.responseId,
            interactionId: reply.interactionId,
            ownerId: reply.ownerId,
            postId: records.length ? reply.postId : undefined,
            scopePostId: reply.postId,
            commandKind: reply.commandKind,
            encryptedToken: new Uint8Array(reply.encryptedToken),
            createdAt: reply.createdAt,
            scheduledDeleteAt: new Date(reply.createdAt.getTime() + replyLifetime),
            tokenExpiresAt: new Date(reply.interactionAt + tokenLifetime),
            accounts: accounts.length ? { createMany: { data: accounts } } : undefined,
            records: records.length ? { createMany: { data: records } } : undefined,
        },
        select: { responseId: true, createdAt: true },
    });
}

export async function invalidateAccounts(tx: Tx, accountUserId: string) {
    await tx.privateResponse.updateMany({
        where: {
            state: 'active', tokenExpiresAt: { gt: new Date() },
            accounts: { some: { accountUserId } },
        },
        data: { state: 'invalidated' },
    });
}

export async function invalidateSettlement(tx: Tx, recordId: string, postId: string, ownerIds: string[]) {
    await tx.privateResponse.updateMany({
        where: {
            state: 'active', tokenExpiresAt: { gt: new Date() },
            OR: [
                { records: { some: { recordId } } },
                { scopePostId: postId, ownerId: { in: ownerIds }, commandKind: { in: ['confirm', 'detail'] } },
            ],
        },
        data: { state: 'invalidated' },
    });
}
