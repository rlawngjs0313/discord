import type { MemeConversation } from './context';
import type { MemeConcept, MemeImage, MemeSearchKind, createGeminiMemeModel } from './gemini';
import { downloadPublicImage } from './media';

type MemeFile = { attachment: Buffer; name: string; description: string };
type MemeSelection = {
    query: string | null; messageNumbers: number[]; resultId: string | null; file: MemeFile | null;
    concept?: MemeConcept; kind?: MemeSearchKind; candidates?: MemeCandidate[];
};
export type MemeCandidate = { id: string; title: string; imageUrl: string; preview?: MemeImage };
export type MemeSearch = (query: string) => Promise<MemeCandidate[]>;
export type MemeSelector = (
    conversation: MemeConversation, images?: readonly MemeImage[], mode?: 'publish' | 'preview',
) => Promise<MemeSelection>;

export function createMemeSelector(
    model: ReturnType<typeof createGeminiMemeModel>, search: MemeSearch, download = downloadPublicImage,
): MemeSelector {
    return async (conversation, images = [], mode = 'publish') => {
        const plan = await model.planSearch(conversation, images);
        if (!plan) return { query: null, messageNumbers: [], resultId: null, file: null };
        const { query, fallbackQuery, concept } = plan;
        const turns = conversation.turns.filter(turn => plan.messageNumbers.has(turn.number));
        const messageNumbers = turns.map(turn => turn.number);
        const flow = { ...conversation, turns };
        const imageLabels = new Set([...(flow.sharedImageLabels ?? []), ...turns.flatMap(turn => turn.imageLabels)]);
        const flowImages = images.filter(image => imageLabels.has(image.label));

        async function findFile(searchTerm: string, kind: MemeSearchKind): Promise<MemeSelection> {
            const candidates = await search(searchTerm);
            const details = { query: searchTerm, messageNumbers, concept, kind };
            const resultId = candidates.length ? await model.choose(flow, flowImages, candidates, concept, kind) : null;
            if (mode === 'preview') return { ...details, candidates, resultId, file: null };
            const selected = candidates.find(candidate => candidate.id === resultId);
            if (!selected) return { ...details, resultId: null, file: null };

            const media = await download(selected.imageUrl, 8 * 1024 * 1024, AbortSignal.timeout(5_000));
            return { ...details, resultId, file: media ? {
                attachment: media.bytes, name: `meme.${media.extension}`, description: selected.title,
            } : null };
        }

        const primary = await findFile(query, 'primary');
        const found = mode === 'preview' ? primary.resultId !== null : Boolean(primary.file);
        return found || !fallbackQuery ? primary : findFile(fallbackQuery, 'community');
    };
}
