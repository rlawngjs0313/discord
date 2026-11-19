import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

export function createDatabase(connectionString: string, max = 10, onQuery?: (sql: string) => void) {
    const pool = new Pool({
        connectionString, max, connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000, statement_timeout: 10_000,
    });
    pool.on('error', () => console.error('PostgreSQL idle connection failed.'));
    const prisma = new PrismaClient({
        adapter: new PrismaPg(pool, { disposeExternalPool: false }),
        log: onQuery ? [{ emit: 'event', level: 'query' }] : [],
    });
    if (onQuery) prisma.$on('query', event => onQuery(event.query));

    return {
        prisma,
        async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
            for (let attempt = 0; ; attempt++) {
                try {
                    return await prisma.$transaction(work, {
                        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                        maxWait: 5_000,
                        timeout: 10_000,
                    });
                } catch (error) {
                    if (!(error instanceof Prisma.PrismaClientKnownRequestError)
                        || error.code !== 'P2034' || attempt >= 3) throw error;
                    await delay(15 * 2 ** attempt + Math.floor(Math.random() * 20));
                }
            }
        },
        async close() {
            try { await prisma.$disconnect(); }
            finally { await pool.end(); }
        },
    };
}

export type Database = ReturnType<typeof createDatabase>;
