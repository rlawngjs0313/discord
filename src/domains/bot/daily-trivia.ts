import { setTimeout as delay } from 'node:timers/promises';
import type { Database } from '../../database/database';
import { Prisma } from '../../generated/prisma/client';
import { defaultGeminiModel, generateGeminiContent, type GeminiResponse } from '../../providers/gemini';

const retryDelayMs = 60 * 60 * 1_000;
const dayMs = 24 * retryDelayMs;
const seoulOffsetMs = 9 * retryDelayMs;
const dailyTriviaLock = 60387125;
const activityPrefix = '오늘의 토막상식 · ';
// Approximate the rendered width in half-width characters, including the prefix.
const maxActivityWidth = 42;

export function seoulDay(now: number) {
    // Korea Standard Time is UTC+09:00. Store the local calendar date as a PostgreSQL DATE.
    const utcMidnight = Math.floor((now + seoulOffsetMs) / dayMs) * dayMs;
    return { date: new Date(utcMidnight), nextMidnight: utcMidnight + dayMs - seoulOffsetMs };
}

type GenerateTrivia = (date: string, recent: string[], signal: AbortSignal, existingFact?: string) => Promise<string>;

class TriviaGenerationError extends Error {}

export function createGeminiTrivia(apiKey: string, model = defaultGeminiModel): GenerateTrivia {
    return async (date, recent, signal, existingFact) => {
        const response = await generateGeminiContent(apiKey, model, {
            systemInstruction: { parts: [{ text: [
                existingFact
                    ? 'existingFact의 대상과 사실을 그대로 유지하며, 그 안의 핵심 정보 하나를 각각 짧게 표현한 후보 4개를 쓴다. 모든 후보에 기존 문장의 대상을 넣는다.'
                    : '자연, 우주, 역사, 과학, 언어, 일상에서 널리 검증된 사실 4개를 고른다. recent의 내용과 겹치지 않는 소재를 쓴다.',
                '아주 좁은 화면에 표시하므로 짧은 표제처럼 적는다. 대상, 특징, 수치나 단위만 남겨도 된다.',
                '각 후보는 한글 8자 안팎, 공백과 숫자를 포함한 전체 13자 이내의 한 줄이다. 마침표, 줄바꿈, 링크, 멘션은 쓰지 않는다.',
                '길이와 문체 예시: "문어 심장은 3개", "화성 위성은 2개", "꿀벌은 춤으로 소통". 사실은 대상과 핵심이 드러나게 끝까지 적는다.',
            ].join('\n') }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify({ date, recent, existingFact }) }] }],
            generationConfig: {
                maxOutputTokens: 256,
                responseMimeType: 'application/json',
                responseJsonSchema: {
                    type: 'object', required: ['facts'],
                    properties: { facts: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 } },
                },
            },
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
        const output = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text).join('') ?? '';
        const resultFacts: unknown = JSON.parse(output)?.facts;
        if (Array.isArray(resultFacts)) {
            for (const value of resultFacts) {
                if (typeof value !== 'string') continue;
                const fact = value.trim();
                if (fitsActivity(fact) && !wasRecentlyShown(fact, recent)) return fact;
            }
        }
        throw new TriviaGenerationError('Gemini did not return a short single-line trivia fact.');
    };
}

function fitsActivity(fact: string) {
    const width = [...`${activityPrefix}${fact}`].reduce((total, char) => total + (/^[ -~]$/.test(char) ? 1 : 2), 0);
    return width <= maxActivityWidth && /[가-힣]/.test(fact)
        && !/[\p{C}\u2028\u2029<>@`*_#]|https?:\/\//iu.test(fact) && !fact.startsWith('오늘의 토막상식');
}

function wasRecentlyShown(fact: string, recent: string[]) {
    const comparable = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\p{P}\s]/gu, '');
    return recent.some(previous => comparable(previous) === comparable(fact));
}

function triviaText(value: string, recent: string[]) {
    const text = value.trim();
    if (!fitsActivity(text)) {
        throw new TriviaGenerationError('Gemini did not return a short single-line trivia fact.');
    }
    if (wasRecentlyShown(text, recent)) {
        throw new TriviaGenerationError('Gemini repeated a recent trivia fact.');
    }
    return text;
}

export async function loadDailyTrivia(db: Database, date: Date, generate: GenerateTrivia, signal: AbortSignal) {
    const where = { date };
    const existing = await db.prisma.dailyTrivia.findUnique({ where });
    if (existing && fitsActivity(existing.fact)) return existing.fact;

    return db.prisma.$transaction(async tx => {
        // A second bot starting against this database reuses the result after the first transaction commits.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${dailyTriviaLock}::bigint)::text`;
        const existing = await tx.dailyTrivia.findUnique({ where });
        if (existing && fitsActivity(existing.fact)) return existing.fact;
        signal.throwIfAborted();
        const rows = await tx.dailyTrivia.findMany({
            where: { date: { lt: date } }, orderBy: { date: 'desc' }, take: 7, select: { fact: true },
        });
        const recent = rows.map(row => row.fact);
        let generated: string;
        try {
            generated = await generate(date.toISOString().slice(0, 10), recent, signal, existing?.fact);
        } catch (error) {
            if (error instanceof TriviaGenerationError) throw error;
            const message = error instanceof Error && error.name === 'TimeoutError'
                ? 'Gemini request timed out.'
                : 'Gemini request or response handling failed.';
            throw new TriviaGenerationError(message, { cause: error });
        }
        const fact = triviaText(generated, recent);
        signal.throwIfAborted();
        await tx.dailyTrivia.upsert({ where, create: { date, fact }, update: { fact } });
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
            publish(`${activityPrefix}${fact}`);
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
