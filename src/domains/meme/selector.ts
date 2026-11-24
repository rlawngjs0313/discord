import type { MemeConversation } from './context';
import type { MemeImage, createGeminiMemeModel } from './gemini';
import { downloadPublicImage } from './media';

type MemeFile = { attachment: Buffer; name: string; description: string };
type MemeSelection = { query: string | null; messageNumbers: number[]; resultId: string | null; file: MemeFile | null };
export type MemeCandidate = { id: string; title: string; imageUrl: string; preview?: MemeImage };
export type MemeSearch = (query: string) => Promise<MemeCandidate[]>;
export type MemeSearchResults = { query: string; messageNumbers: readonly number[]; candidates: readonly MemeCandidate[] };
export type MemeSelector = (
    conversation: MemeConversation, images?: readonly MemeImage[], onSearch?: (results: MemeSearchResults) => void,
) => Promise<MemeSelection>;

export function createMemeSelector(
    model: ReturnType<typeof createGeminiMemeModel>, search: MemeSearch, download = downloadPublicImage,
): MemeSelector {
    return async (conversation, images = [], onSearch) => {
        const plan = await model.planSearch(conversation, images);
        if (!plan) return { query: null, messageNumbers: [], resultId: null, file: null };
        const { query } = plan;
        const turns = conversation.turns.filter(turn => plan.messageNumbers.has(turn.number));
        const messageNumbers = turns.map(turn => turn.number);
        const candidates = await search(query);
        onSearch?.({ query, messageNumbers, candidates });
        const flow = { ...conversation, turns };
        const imageLabels = new Set([...(flow.sharedImageLabels ?? []), ...turns.flatMap(turn => turn.imageLabels)]);
        const flowImages = images.filter(image => imageLabels.has(image.label));
        const resultId = candidates.length ? await model.choose(flow, flowImages, candidates) : null;
        const selected = candidates.find(candidate => candidate.id === resultId);
        if (!selected) return { query, messageNumbers, resultId: null, file: null };

        const media = await download(selected.imageUrl, 8 * 1024 * 1024, AbortSignal.timeout(5_000));
        return { query, messageNumbers, resultId, file: media ? {
            attachment: media.bytes, name: `meme.${media.extension}`, description: selected.title,
        } : null };
    };
}
