import { randomInt } from 'node:crypto';

export class InputError extends Error {}

export function parseWon(value: string): bigint {
    const trimmed = value.trim();
    if (!/^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)원?$/.test(trimmed)) {
        throw new InputError('총액을 원 단위 정수로 입력해 주세요. 예: 10,000원');
    }
    const digits = trimmed.replaceAll(',', '').replace(/원$/, '');
    if (digits.length > 15 || BigInt(digits) === 0n) {
        throw new InputError('총액은 1원 이상, 15자리 이내로 입력해 주세요. 예: 10,000원');
    }
    return BigInt(digits);
}

export function splitWon(totalWon: bigint, participantIds: readonly string[], draw: (max: number) => number = randomInt) {
    const users = [...new Set(participantIds)].sort();
    if (totalWon < 1n || users.length < 2) throw new InputError('참여자를 한 명 이상 선택해 주세요.');
    const count = BigInt(users.length);
    const base = totalWon / count;
    const remainder = Number(totalWon % count);
    for (let index = 0; index < remainder; index++) {
        const chosen = index + draw(users.length - index);
        [users[index], users[chosen]] = [users[chosen]!, users[index]!];
    }
    return users.map((userId, index) => ({ userId, shareWon: base + (index < remainder ? 1n : 0n) }));
}

export const won = (amount: bigint) => amount.toLocaleString('ko-KR') + '원';
