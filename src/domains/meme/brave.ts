import { MemeProviderError } from './errors';
import { downloadPublicImage, publicImageUrl } from './media';
import type { MemeSearch } from './selector';

type BraveResult = { title?: string | null; thumbnail?: { src?: string | null }; properties?: { url?: string | null } };
const resultsPerSearch = 5;
const maxThumbnailBytes = 192 * 1024;

export function createBraveMemeSearch(apiKey: string, download = downloadPublicImage): MemeSearch {
    return async query => {
        const url = new URL('https://api.search.brave.com/res/v1/images/search');
        url.search = new URLSearchParams({
            q: query, count: String(resultsPerSearch), safesearch: 'strict', country: 'ALL',
            search_lang: /[가-힣]/.test(query) ? 'ko' : 'en',
        }).toString();
        const response = await fetch(url, {
            headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
            signal: AbortSignal.timeout(6_000), redirect: 'error',
        });
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            throw new MemeProviderError('http_status', `Brave HTTP ${response.status}`, { httpStatus: response.status });
        }

        const body = await response.json() as { results?: BraveResult[] } | null;
        const results = body?.results;
        if (!Array.isArray(results)) {
            throw new MemeProviderError('invalid_search_results', 'Brave returned an invalid results array');
        }
        const seen = new Set<string>();
        const candidates = results.flatMap(result => {
            const image = result.properties?.url;
            if (!image || seen.has(image) || !publicImageUrl(image)) return [];
            seen.add(image);
            return [{ id: String(seen.size), title: result.title?.trim().slice(0, 200) || '검색 이미지', imageUrl: image,
                thumbnail: result.thumbnail?.src }];
        }).slice(0, resultsPerSearch);

        const thumbnailTimeout = AbortSignal.timeout(4_000);
        return Promise.all(candidates.map(async ({ thumbnail, ...candidate }) => {
            const media = thumbnail ? await download(thumbnail, maxThumbnailBytes, thumbnailTimeout) : null;
            const preview = media && media.mimeType !== 'image/gif'
                ? { label: `검색 후보 ${candidate.id}`, mimeType: media.mimeType, data: media.bytes.toString('base64') }
                : undefined;
            return { ...candidate, preview };
        }));
    };
}
