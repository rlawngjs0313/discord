import { run, type TaskList } from 'graphile-worker';
import type { Database } from '../../database/database';
import type { TokenCipher } from './store';

const active = ['active', 'invalidated'];

export function replyTasks(
    db: Database, cipher: TokenCipher, applicationId: string,
    deleteOriginal = fetch,
): TaskList {
    const finish = async (responseId: string, state: 'deleted' | 'expired') => {
        await db.prisma.privateResponse.updateMany({
            where: { responseId, state: { in: active } },
            data: { encryptedToken: null, state },
        });
    };

    return {
        async delete_private_response(payload, helpers) {
            const id = (payload as { response_id?: unknown } | null)?.response_id;
            if (typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id)) return;
            const row = await db.prisma.privateResponse.findUnique({
                where: { responseId: id },
                select: { state: true, encryptedToken: true, tokenExpiresAt: true },
            });
            if (!row?.encryptedToken || !active.includes(row.state)) return;
            const deadline = row.tokenExpiresAt.getTime();
            const remaining = deadline - Date.now();
            if (remaining <= 0) return finish(id, 'expired');

            let result: Response;
            try {
                const token = cipher.open(row.encryptedToken);
                result = await deleteOriginal(
                    'https://discord.com/api/v10/webhooks/' + applicationId + '/' + encodeURIComponent(token) + '/messages/@original',
                    { method: 'DELETE', signal: AbortSignal.timeout(Math.min(5_000, remaining)) },
                );
            } catch {
                throw new Error('Private Discord reply deletion failed.');
            }
            if (result.ok || result.status === 404) return finish(id, 'deleted');
            if (result.status === 401) return finish(id, 'expired');
            if (result.status === 429) {
                const data = await result.json().catch(() => ({})) as { retry_after?: unknown };
                const seconds = data.retry_after;
                const delay = typeof seconds === 'number' && Number.isFinite(seconds)
                    ? Math.max(1_000, Math.ceil(seconds * 1_000)) : 1_000;
                const retryAt = Date.now() + delay;
                if (retryAt < deadline) {
                    await helpers.addJob('delete_private_response', { response_id: id }, {
                        runAt: new Date(retryAt), jobKey: 'private-reply-retry:' + id, maxAttempts: 8,
                    });
                }
                return;
            }
            throw new Error('Private Discord reply deletion failed with status ' + result.status + '.');
        },

        async purge_private_responses() {
            const now = new Date();
            await db.prisma.privateResponse.updateMany({
                where: { tokenExpiresAt: { lte: now }, state: { in: active } },
                data: { encryptedToken: null, state: 'expired' },
            });
            await db.prisma.privateResponse.deleteMany({
                where: { tokenExpiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
            });
        },
    };
}

export function startWorker(connectionString: string, db: Database, cipher: TokenCipher, applicationId: string) {
    return run({
        connectionString,
        taskList: replyTasks(db, cipher, applicationId),
        crontab: '* * * * * purge_private_responses',
        concurrency: 2,
        pollInterval: 1_000,
        noHandleSignals: true,
    });
}
