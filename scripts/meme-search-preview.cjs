require('dotenv/config');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function resultCard({ id, title, imageUrl, preview }) {
    const label = escapeHtml(title);
    const image = preview
        ? `<img src="data:${preview.mimeType};base64,${preview.data}" alt="${label}">`
        : '<span class="missing">썸네일을 가져오지 못했어요.</span>';
    return `<a class="result" href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer">
        <div class="preview">${image}</div>
        <div class="caption">#${id} · ${label} <span aria-hidden="true">↗</span></div>
    </a>`;
}

function previewPage(query, candidates) {
    return `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brave 이미지 검색</title>
<style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 75rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    h1 { margin: .25rem 0 1.5rem; font-size: clamp(1.5rem, 3vw, 2rem); overflow-wrap: anywhere; }
    .source { margin: 0; font-size: .9rem; }
    .results { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 1rem; }
    .result { color: inherit; text-decoration: none; border: 1px solid GrayText; border-radius: .6rem; overflow: hidden; }
    .result:hover .caption, .result:focus-visible .caption { text-decoration: underline; }
    .preview { height: 14rem; display: grid; place-items: center; background: light-dark(#f0f0f0, #292929); }
    img { width: 100%; height: 14rem; object-fit: contain; }
    .caption, .missing { padding: .7rem; overflow-wrap: anywhere; }
</style>
<body>
    <p class="source">Brave 이미지 검색 · ${candidates.length}개</p>
    <h1>${escapeHtml(query)}</h1>
    ${candidates.length ? `<div class="results">${candidates.map(resultCard).join('')}</div>` : '<p>검색 결과가 없어요.</p>'}
</body>
</html>`;
}

async function main() {
    const query = process.argv.slice(2).join(' ').trim();
    if (!query) throw new Error('사용법: npm run meme:search -- "검색어"');
    const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
    if (!key) throw new Error('.env에 BRAVE_SEARCH_API_KEY를 설정해 주세요.');

    const { createBraveMemeSearch } = require('../dist/domains/meme/brave');
    const candidates = await createBraveMemeSearch(key)(query);
    const directory = mkdtempSync(join(tmpdir(), 'discord-meme-search-'));
    const file = join(directory, 'preview.html');
    writeFileSync(file, previewPage(query, candidates));
    console.log(file);

    if (process.platform === 'darwin' && spawnSync('open', [file], { stdio: 'ignore' }).status !== 0) {
        console.error('브라우저에서 위 파일을 직접 열어 주세요.');
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
