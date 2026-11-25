import { setTimeout as delay } from 'node:timers/promises';
import type { Database } from '../../database/database';
import { Prisma } from '../../generated/prisma/client';
import { defaultGeminiModel, generateGeminiContent, type GeminiResponse } from '../../providers/gemini';

const retryDelayMs = 60 * 60 * 1_000;
const dayMs = 24 * retryDelayMs;
const seoulOffsetMs = 9 * retryDelayMs;
const maxFactLength = 65;
const dailyTriviaLock = 60387125;

export function seoulDay(now: number) {
    // Korea Standard Time is UTC+09:00. Store the local calendar date as a PostgreSQL DATE.
    const utcMidnight = Math.floor((now + seoulOffsetMs) / dayMs) * dayMs;
    return { date: new Date(utcMidnight), nextMidnight: utcMidnight + dayMs - seoulOffsetMs };
}

type GenerateTrivia = (date: string, recent: string[], signal: AbortSignal) => Promise<string>;

class TriviaGenerationError extends Error {}

export function createGeminiTrivia(apiKey: string, model = defaultGeminiModel): GenerateTrivia {
    return async (date, recent, signal) => {
        const response = await generateGeminiContent(apiKey, model, {
            systemInstruction: { parts: [{ text: [
                '디스코드 봇 프로필에 표시할 토막상식 하나를 작성한다.',
                '자연, 우주, 역사, 과학, 언어 또는 일상에서 흥미롭고 널리 검증된 사실을 고른다. 확실한 사실만 쓴다.',
                '구체적인 대상의 구조, 성질, 수치나 기록을 설명한다. 속설, 별명, 비유, 모호한 비교는 피한다.',
                '최근에 표시한 내용과 소재가 겹치지 않게 고른다.',
                `한국어 한 문장으로 공백과 문장 부호를 포함해 ${maxFactLength}자 이내로 쓴다. 제목, 목록 기호, 링크, 멘션은 쓰지 않는다.`,
            ].join('\n') }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify({ date, recent }) }] }],
            generationConfig: { maxOutputTokens: 256 },
        }, AbortSignal.any([signal, AbortSignal.timeout(8_000)]));
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            throw new TriviaGenerationError(`Gemini returned HTTP ${response.status}.`);
        }
        const result = await response.json() as GeminiResponse;
        const candidate = result.candidates?.[0];
        if (result.promptFeedback?.blockReason || candidate?.finishReason !== 'STOP') {
            throw new TriviaGenerationError('Gemini did not return a complete trivia fact.');
        }
        return candidate.content?.parts?.filter(part => !part.thought).map(part => part.text).join('') ?? '';
    };
}

function triviaText(value: string, recent: string[]) {
    const text = value.trim();
    if (!/[가-힣]/.test(text) || text.length > maxFactLength || /[\p{C}\u2028\u2029<>@`*_#]|https?:\/\//iu.test(text)
        || text.startsWith('오늘의 토막상식')) {
        throw new TriviaGenerationError('Gemini returned invalid trivia text.');
    }
    const comparable = (fact: string) => fact.normalize('NFKC').toLowerCase().replace(/[\p{P}\s]/gu, '');
    if (recent.some(fact => comparable(fact) === comparable(text))) {
        throw new TriviaGenerationError('Gemini repeated a recent trivia fact.');
    }
    return text;
}

export async function loadDailyTrivia(db: Database, date: Date, generate: GenerateTrivia, signal: AbortSignal) {
    const where = { date };
    const existing = await db.prisma.dailyTrivia.findUnique({ where });
    if (existing) return existing.fact;

    return db.prisma.$transaction(async tx => {
        // A second bot starting against this database reuses the result after the first transaction commits.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${dailyTriviaLock}::bigint)::text`;
        const existing = await tx.dailyTrivia.findUnique({ where });
        if (existing) return existing.fact;
        signal.throwIfAborted();
        const rows = await tx.dailyTrivia.findMany({
            where: { date: { lt: date } }, orderBy: { date: 'desc' }, take: 7, select: { fact: true },
        });
        const recent = rows.map(row => row.fact);
        let generated: string;
        try {
            generated = await generate(date.toISOString().slice(0, 10), recent, signal);
        } catch (error) {
            if (error instanceof TriviaGenerationError) throw error;
            const message = error instanceof Error && error.name === 'TimeoutError'
                ? 'Gemini request timed out.'
                : 'Gemini request or response handling failed.';
            throw new TriviaGenerationError(message, { cause: error });
        }
        const fact = triviaText(generated, recent);
        signal.throwIfAborted();
        await tx.dailyTrivia.create({ data: { date, fact } });
        return fact;
    }, { isolationLevel: 'ReadCommitted', timeout: 20_000 });
}

function loadFailureMessage(error: unknown) {
    if (error instanceof TriviaGenerationError) return error.message;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2021') return 'The daily trivia table is missing. Run npm run db:deploy.';
        return `PostgreSQL failed while loading daily trivia (${error.code}).`;
    }
    return 'Could not load daily trivia.';
}

export async function runDailyTrivia(
    load: (date: Date, signal: AbortSignal) => Promise<string>,
    publish: (activity: string) => void,
    signal: AbortSignal,
) {
    while (!signal.aborted) {
        const { date, nextMidnight } = seoulDay(Date.now());
        let retry = false;
        let publishing = false;
        try {
            const fact = await load(date, signal);
            if (signal.aborted) return;
            if (Date.now() >= nextMidnight) continue;
            publishing = true;
            publish(`오늘의 토막상식 · ${fact}`);
        } catch (error) {
            if (signal.aborted) return;
            const detail = publishing ? 'Could not publish the Discord activity.' : loadFailureMessage(error);
            console.warn(`Could not update the daily trivia presence. ${detail} Retrying within one hour.`);
            retry = true;
        }
        const untilMidnight = Math.max(0, nextMidnight - Date.now());
        try {
            await delay(retry ? Math.min(untilMidnight, retryDelayMs) : untilMidnight, undefined, { signal });
        } catch (error) {
            if (!signal.aborted) throw error;
        }
    }
}
