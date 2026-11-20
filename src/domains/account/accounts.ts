import type { Tx } from '../../database/database';
import { invalidateAccounts } from '../replies/store';
import type { normalizeAccount } from './bank';

export async function saveAccount(tx: Tx, userId: string, account: ReturnType<typeof normalizeAccount>) {
    const existing = await tx.userBankAccount.findUnique({ where: { userId } });
    if (existing?.bankCode === account.bankCode
        && existing.formattedAccountNumber === account.formattedAccountNumber
        && existing.accountHolder === account.accountHolder) return false;
    await tx.userBankAccount.upsert({
        where: { userId },
        create: { userId, ...account },
        update: { ...account, version: { increment: 1 } },
    });
    await invalidateAccounts(tx, userId);
    return true;
}

export async function deleteAccount(tx: Tx, userId: string) {
    const result = await tx.userBankAccount.deleteMany({ where: { userId } });
    if (result.count) await invalidateAccounts(tx, userId);
}
