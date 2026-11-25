import type { MemeSearchKind } from './gemini';

type MemeStage = 'discord_context' | 'gemini_search_plan' | 'brave_image_search' | 'gemini_candidate_selection' | 'image_download';
type ProviderErrorReason = 'http_status' | 'incomplete_response' | 'invalid_query' | 'invalid_message_numbers'
    | 'invalid_concept' | 'invalid_result_id' | 'invalid_search_results';

export class MemeProviderError extends Error {
    constructor(
        readonly reason: ProviderErrorReason, message: string,
        readonly details: { httpStatus?: number; finishReason?: string } = {},
    ) {
        super(message);
        this.name = 'MemeProviderError';
    }
}

class MemeStageError extends Error {
    constructor(
        readonly stage: MemeStage, readonly elapsedMs: number, cause: unknown, readonly kind?: MemeSearchKind,
    ) {
        super(cause instanceof Error ? cause.message : 'Unexpected error', { cause });
    }
}

export async function runMemeStage<T>(stage: MemeStage, run: () => Promise<T>, kind?: MemeSearchKind): Promise<T> {
    const start = performance.now();
    try {
        return await run();
    } catch (cause) {
        throw new MemeStageError(stage, Math.round(performance.now() - start), cause, kind);
    }
}

function safeCode(value: unknown) {
    return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(value) ? value : undefined;
}

export function memeFailureDetails(error: unknown) {
    const failure = error instanceof MemeStageError ? error : undefined;
    const cause = failure ? failure.cause : error;
    const stage = { stage: failure?.stage ?? 'meme_selection', kind: failure?.kind, elapsedMs: failure?.elapsedMs };
    if (cause instanceof MemeProviderError) {
        return { ...stage, errorName: cause.name, reason: cause.reason,
            httpStatus: cause.details.httpStatus, finishReason: safeCode(cause.details.finishReason) };
    }

    const nested = cause instanceof Error ? cause.cause : undefined;
    const code = nested && typeof nested === 'object' && 'code' in nested ? safeCode(nested.code) : undefined;
    if (cause instanceof Error) {
        if (cause.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
            return { ...stage, errorName: cause.name === 'TimeoutError' ? 'TimeoutError' : 'Error', reason: 'timeout', code };
        }
        if (cause.name === 'AbortError') return { ...stage, errorName: 'AbortError', reason: 'aborted', code };
        if (cause instanceof SyntaxError) return { ...stage, errorName: 'SyntaxError', reason: 'invalid_json' };
        if (cause instanceof TypeError) {
            return { ...stage, errorName: 'TypeError', reason: cause.message === 'fetch failed' ? 'network_error' : 'unexpected', code };
        }
    }
    return { ...stage, errorName: cause instanceof Error ? 'Error' : 'NonError', reason: 'unexpected', code };
}
