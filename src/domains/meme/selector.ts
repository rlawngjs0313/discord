import type { MemeImage, createGeminiMemeModel } from './gemini';
import { downloadPublicImage } from './media';

type MemeFile = { attachment: Buffer; name: string; description: string };
type MemeSelection = { query: string | null; resultId: string | null; file: MemeFile | null };
export type MemeCandidate = { id: string; title: string; imageUrl: string; preview?: MemeImage };
export type MemeSearch = (query: string) => Promise<MemeCandidate[]>;
export type MemeSelector = (transcript: string, images?: readonly MemeImage[]) => Promise<MemeSelection>;

export function createMemeSelector(
    model: ReturnType<typeof createGeminiMemeModel>, search: MemeSearch, download = downloadPublicImage,
): MemeSelector {
    return async (transcript, images = []) => {
        const query = await model.query(transcript, images);
        if (!query) return { query: null, resultId: null, file: null };
        const candidates = await search(query);
        const resultId = candidates.length ? await model.choose(transcript, images, candidates) : null;
        const selected = candidates.find(candidate => candidate.id === resultId);
        if (!selected) return { query, resultId: null, file: null };

        const media = await download(selected.imageUrl, 8 * 1024 * 1024, AbortSignal.timeout(5_000));
        return { query, resultId, file: media ? {
            attachment: media.bytes, name: `meme.${media.extension}`, description: selected.title,
        } : null };
    };
}
