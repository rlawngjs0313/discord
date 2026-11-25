const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ChannelType, Collection, MessageFlags, MessageType, PermissionFlagsBits, PermissionsBitField, REST } = require('discord.js');
const { commandHandler, registerCommands } = require('../dist/domains/bot/commands');
const { createGeminiMemeModel } = require('../dist/domains/meme/gemini');
const { createBraveMemeSearch } = require('../dist/domains/meme/brave');
const { createMemeSelector } = require('../dist/domains/meme/selector');
const { isPublicAddress, publicImageUrl } = require('../dist/domains/meme/media');
const { parsePastedMessages } = require('../dist/domains/meme/pasted');

const modelResponse = (value) => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [
    { text: '{"query":"unrelated"}', thought: true }, { text: JSON.stringify(value) },
] } }] });
const noSelection = { query: null, messageNumbers: [], resultId: null, file: null };
const imageSelection = (name, description) => ({
    query: 'test reaction meme', messageNumbers: [1, 2], resultId: '1',
    file: { name, description, attachment: Buffer.from([1, 2, 3]) },
});
const turn = (number, speaker, text, imageLabels = []) => ({ number, speaker, text, imageLabels });
const sampleConversation = { turns: [turn(1, '민서', '이제 어떡하지ㅋㅋ')] };
const concept = { topic: '과제 끝난 상황', visualReference: '축하하는 건배 GIF' };
const planSearch = (...messageNumbers) => ({
    query: 'reaction meme', fallbackQuery: null, concept, messageNumbers: new Set(messageNumbers),
});

test('registers the meme command only when enabled', async t => {
    const put = t.mock.method(REST.prototype, 'put', async () => []);
    await registerCommands('test-token', '123', '456');
    await registerCommands('test-token', '123', '456', true);
    assert.equal(put.mock.calls[0].arguments[1].body.some(command => command.name === '밈'), false);
    assert.equal(put.mock.calls[1].arguments[1].body.some(command => command.name === '밈'), true);
});

test('ranks candidates using only the latest conversation flow and its images', async t => {
    const responses = [modelResponse({
        messageNumbers: [4, 2, 4], ...concept, query: 'celebration reaction gif', fallbackQuery: '퇴근 해방 짤',
    }), modelResponse({ imageEvidence: '잔을 부딪치며 축하하는 장면', resultId: '1' })];
    const request = t.mock.method(global, 'fetch', async () => responses.shift());
    const conversation = { turns: [
        turn(1, '준', '버스가 또 안 오네 <사진1>', ['사진1']),
        turn(2, '민서', '과제 끝났다! <사진2>', ['사진2']),
        turn(3, '준', '지난주에도 그 버스 지각했는데'),
        { ...turn(4, '준', '드디어 <이모티콘1>', ['이모티콘1']), replyTo: 2 },
    ] };
    const images = [
        { label: '사진1', mimeType: 'image/png', data: 'AA==' },
        { label: '사진2', mimeType: 'image/png', data: 'Aw==' },
        { label: '이모티콘1', name: 'celebrate', mimeType: 'image/webp', data: 'AQ==' },
    ];
    const candidate = { id: '1', title: 'Celebration GIF', imageUrl: 'https://example.com/cheers.gif',
        preview: { label: '검색 후보 1', mimeType: 'image/jpeg', data: 'Ag==' } };
    const search = t.mock.fn(async () => [candidate]);
    const download = t.mock.fn(async () => ({ bytes: Buffer.from('GIF89a'), mimeType: 'image/gif', extension: 'gif' }));
    const select = createMemeSelector(createGeminiMemeModel('test-key'), search, download);
    assert.deepEqual(await select(conversation, images), {
        query: 'celebration reaction gif', messageNumbers: [2, 4], concept, kind: 'primary', resultId: '1',
        file: { attachment: Buffer.from('GIF89a'), name: 'meme.gif', description: candidate.title },
    });
    assert.deepEqual(search.mock.calls.map(call => call.arguments), [['celebration reaction gif']]);
    assert.equal(download.mock.calls[0].arguments[0], candidate.imageUrl);
    assert.equal(request.mock.calls.length, 2);
    const [url, options] = request.mock.calls[0].arguments;
    assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(options.body);
    const [part, ...media] = body.contents[0].parts;
    const input = JSON.parse(part.text);
    assert.deepEqual(input.conversation, conversation);
    assert.deepEqual(media, [
        { text: '사진1' }, { inlineData: { mimeType: 'image/png', data: 'AA==' } },
        { text: '사진2' }, { inlineData: { mimeType: 'image/png', data: 'Aw==' } },
        { text: '이모티콘1 (celebrate)' }, { inlineData: { mimeType: 'image/webp', data: 'AQ==' } },
    ]);
    assert.deepEqual(body.generationConfig.responseJsonSchema.required, ['messageNumbers', 'topic', 'visualReference', 'query', 'fallbackQuery']);
    const selectionBody = JSON.parse(request.mock.calls[1].arguments[1].body);
    const [selectionInput, ...selectionMedia] = selectionBody.contents[0].parts;
    assert.deepEqual(JSON.parse(selectionInput.text), {
        conversation: { turns: [conversation.turns[1], conversation.turns[3]] },
        concept, kind: 'primary',
        candidates: [{ id: '1', title: candidate.title }],
    });
    assert.deepEqual(selectionMedia, [
        { text: '사진2' }, { inlineData: { mimeType: 'image/png', data: 'Aw==' } },
        { text: '이모티콘1 (celebrate)' }, { inlineData: { mimeType: 'image/webp', data: 'AQ==' } },
        { text: '검색 후보 1' }, { inlineData: { mimeType: 'image/jpeg', data: 'Ag==' } },
    ]);
    assert.deepEqual(selectionBody.generationConfig.responseJsonSchema.properties.resultId.anyOf[0].enum, ['1']);
});

test('accepts null, handles blocked prompts, and rejects unknown selections', async t => {
    const replies = [modelResponse({ messageNumbers: [], query: null }), Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
        modelResponse({ resultId: '__proto__' })];
    t.mock.method(global, 'fetch', async () => replies.shift());
    const model = createGeminiMemeModel('test-key');
    const search = t.mock.fn(async () => []);
    const select = createMemeSelector(model, search);
    assert.deepEqual(await select({ turns: [] }), noSelection);
    assert.deepEqual(await select(sampleConversation), noSelection);
    assert.deepEqual(await select(sampleConversation), noSelection);
    assert.equal(search.mock.calls.length, 0);
    await assert.rejects(() => model.choose(sampleConversation, [], [{ id: '1', title: 'Meme', imageUrl: '' }]), /invalid resultId/);
});

test('stops before searching if the plan omits the latest turn or names an unknown turn', async t => {
    const replies = [[1], [2, 99]].map(messageNumbers => modelResponse({ messageNumbers, query: 'reaction meme' }));
    t.mock.method(global, 'fetch', async () => replies.shift());
    const search = t.mock.fn(async () => []);
    const select = createMemeSelector(createGeminiMemeModel('test-key'), search);
    const conversation = { turns: [turn(1, '민서', '버스가 늦어'), turn(2, '준', '나 합격했다!')] };
    for (let i = 0; i < 2; i++) await assert.rejects(() => select(conversation), /invalid message numbers/);
    assert.equal(search.mock.calls.length, 0);
});

test('maps Brave results to unique public image URLs and matching thumbnails', async t => {
    const original = 'https://example.com/original.gif';
    const preview = 'https://imgs.search.brave.com/a.jpg';
    const request = t.mock.method(global, 'fetch', async () => Response.json({ results: [
        { title: 'Private address', properties: { url: 'https://127.0.0.1/not-an-image' } },
        { title: 'Reaction meme', properties: { url: original }, thumbnail: { src: preview } },
        { title: 'Duplicate', properties: { url: original } },
    ] }));
    const download = t.mock.fn(async () => ({ bytes: Buffer.from([0]), mimeType: 'image/jpeg', extension: 'jpg' }));
    assert.deepEqual(await createBraveMemeSearch('test-brave-key', download)('폭탄 돌리기 밈'), [{
        id: '1', title: 'Reaction meme', imageUrl: original, preview: { label: '검색 후보 1', mimeType: 'image/jpeg', data: 'AA==' },
    }]);
    assert.equal(download.mock.calls[0].arguments[0], preview);
    const [url, options] = request.mock.calls[0].arguments;
    assert.equal(url.origin + url.pathname, 'https://api.search.brave.com/res/v1/images/search');
    assert.equal(url.searchParams.get('q'), '폭탄 돌리기 밈');
    assert.equal(url.searchParams.get('search_lang'), 'ko');
    assert.equal(url.searchParams.get('safesearch'), 'strict');
    assert.equal(options.headers['X-Subscription-Token'], 'test-brave-key');
});

test('skips result ranking for an empty search and reports an unavailable original', async t => {
    const candidate = { id: '2', title: 'Reaction meme', imageUrl: 'https://example.com/reaction.gif' };
    const choose = t.mock.fn(async () => '2');
    const searchResults = [[], [candidate]];
    const search = t.mock.fn(async () => searchResults.shift());
    const download = t.mock.fn(async () => null);
    const select = createMemeSelector({ planSearch: async () => planSearch(1), choose }, search, download);
    const selection = { query: 'reaction meme', messageNumbers: [1], concept, kind: 'primary', file: null };
    assert.deepEqual(await select(sampleConversation), { ...selection, resultId: null });
    assert.equal(choose.mock.calls.length, 0);
    assert.equal(download.mock.calls.length, 0);
    assert.deepEqual(await select(sampleConversation), { ...selection, resultId: '2' });
    assert.equal(download.mock.calls[0].arguments[0], candidate.imageUrl);
});

test('screens out local and special-use image addresses', () => {
    assert.equal(isPublicAddress('8.8.8.8'), true);
    assert.equal(isPublicAddress('2606:4700::1111'), true);
    for (const address of ['127.0.0.1', '169.254.169.254', '10.0.0.8', '192.168.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1']) {
        assert.equal(isPublicAddress(address), false);
    }
    assert.equal(publicImageUrl('https://[::1]/image.gif'), null);
    assert.equal(publicImageUrl('https://example.com:8443/image.gif'), null);
    assert.equal(publicImageUrl('http://example.com/image.gif'), null);
});

function message(t, id, content, options = {}) {
    return {
        id, content, type: MessageType.Default, author: { id: '101', bot: false, displayName: '민서' },
        attachments: new Collection(),
        reply: t.mock.fn(async () => {}), ...options,
    };
}

function command(t, messages, { readHistory = true, canReadHistory = true, canPublish = true } = {}) {
    const guildPermission = readHistory ? [PermissionFlagsBits.ReadMessageHistory] : [];
    const publishPermissions = canPublish ? [PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.AttachFiles] : [];
    const fetch = t.mock.fn(async ({ before, limit }) => new Collection(messages
        .filter(m => BigInt(m.id) < BigInt(before))
        .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1)
        .slice(0, limit).map(m => [m.id, m])));
    return {
        id: '500', channelId: '200', user: { id: '501' }, commandName: '밈', isChatInputCommand: () => true, inGuild: () => true,
        appPermissions: new PermissionsBitField([PermissionFlagsBits.ViewChannel, ...publishPermissions, ...guildPermission]),
        memberPermissions: new PermissionsBitField(canReadHistory ? [PermissionFlagsBits.ReadMessageHistory] : []),
        channel: { type: ChannelType.PublicThread, isThread: () => true, messages: { fetch }, send: t.mock.fn(async () => {}) },
        deferReply: t.mock.fn(async () => {}),
        editReply: t.mock.fn(async () => {}),
        deleteReply: t.mock.fn(async () => {}),
    };
}

test('posts a single silent attachment as a standalone message in the current thread', async t => {
    const log = t.mock.method(console, 'info', () => {});
    const first = message(t, '400', '과제 끝났어 https://example.com/private');
    const target = message(t, '403', '이제 쉬자 <@101>', {
        type: MessageType.Reply, author: { id: '102', displayName: '계정 표시 이름' }, member: { displayName: '준' },
        reference: { messageId: '400' },
    });
    const bot = message(t, '410', '봇의 답장', { author: { id: '103', bot: true } });
    const hook = message(t, '409', '웹훅 메시지', { webhookId: '104' });
    const noText = message(t, '408', '  ');
    const system = message(t, '407', '채널 이름을 변경함', { type: MessageType.ChannelNameChange });
    const interaction = command(t, [system, target, bot, first, noText, hook]);
    const select = t.mock.fn(async () => imageSelection('meme.jpg', 'Leonardo DiCaprio Cheers'));

    await commandHandler(undefined, undefined, select)(interaction);
    assert.deepEqual(interaction.deferReply.mock.calls[0].arguments, [{ flags: MessageFlags.Ephemeral }]);
    assert.deepEqual(interaction.channel.messages.fetch.mock.calls[0].arguments, [{ before: '500', limit: 10, cache: false }]);
    assert.deepEqual(select.mock.calls[0].arguments, [{ turns: [
        turn(1, '민서', '과제 끝났어 [링크]'), { ...turn(2, '준', '이제 쉬자 [멘션]'), replyTo: 1 },
    ] }, []]);
    assert.equal(first.reply.mock.calls.length, 0);
    assert.equal(target.reply.mock.calls.length, 0);
    assert.equal(interaction.channel.send.mock.calls.length, 1);
    assert.deepEqual(interaction.channel.send.mock.calls[0].arguments[0], {
        files: [{ attachment: Buffer.from([1, 2, 3]), name: 'meme.jpg', description: 'Leonardo DiCaprio Cheers' }],
        allowedMentions: { parse: [] }, flags: MessageFlags.SuppressNotifications,
    });
    assert.equal(interaction.deleteReply.mock.calls.length, 1);
    assert.equal(interaction.editReply.mock.calls.length, 0);
    assert.equal(log.mock.calls[1].arguments[0], 'Discord meme search');
    assert.deepEqual(JSON.parse(log.mock.calls[1].arguments[1]), {
        interactionId: '500', query: 'test reaction meme', messageNumbers: [1, 2], resultId: '1', downloaded: true,
    });
});

test('previews five candidates and the selected number privately without downloading or publishing', async t => {
    t.mock.method(console, 'info', () => {});
    const interaction = command(t, [message(t, '403', '이제 어떡하지ㅋㅋ')], { canPublish: false });
    const candidates = Array.from({ length: 5 }, (_, i) => ({
        id: String(i + 1), title: `당황하는 표정 ${i + 1}`, imageUrl: `https://example.com/${i + 1}.gif`,
        preview: { label: `검색 후보 ${i + 1}`, mimeType: 'image/jpeg', data: 'AQID' },
    }));
    const choose = t.mock.fn(async () => '2');
    const model = { planSearch: async () => ({ ...planSearch(1), query: '당황하는 짤', fallbackQuery: '뒤로 숨는 짤' }), choose };
    const search = t.mock.fn(async () => candidates);
    const download = t.mock.fn(async () => ({ bytes: Buffer.from('GIF89a'), extension: 'gif' }));
    const select = createMemeSelector(model, search, download);

    await commandHandler(undefined, undefined, select, true)(interaction);

    assert.deepEqual(interaction.deferReply.mock.calls[0].arguments, [{ flags: MessageFlags.Ephemeral }]);
    assert.equal(interaction.deleteReply.mock.calls.length, 0);
    assert.equal(interaction.editReply.mock.calls.length, 1);
    const [preview] = interaction.editReply.mock.calls[0].arguments;
    assert.match(preview.content, /당황하는 짤\n#1 · 당황하는 표정 1/);
    assert.match(preview.content, /Gemini 선택 #2/);
    assert.deepEqual(preview.files, candidates.map(({ id, title }) => ({
        attachment: Buffer.from([1, 2, 3]), name: `candidate-${id}.jpg`, description: `#${id} · ${title}`,
    })));
    assert.equal(interaction.channel.send.mock.calls.length, 0);
    assert.deepEqual(search.mock.calls.map(call => call.arguments[0]), ['당황하는 짤']);
    assert.equal(choose.mock.calls.length, 1);
    assert.equal(download.mock.calls.length, 0);
});

test('keeps the private search results when Gemini finds none of the candidates suitable', async t => {
    t.mock.method(console, 'info', () => {});
    const interaction = command(t, [message(t, '403', '이제 어떡하지ㅋㅋ')]);
    const model = { planSearch: async () => ({ ...planSearch(1), query: '당황하는 짤' }), choose: async () => null };
    const select = createMemeSelector(model, async () => [{
        id: '1', title: '관계없는 이미지', imageUrl: 'https://example.com/image.png',
    }]);

    await commandHandler(undefined, undefined, select, true)(interaction);

    assert.equal(interaction.channel.send.mock.calls.length, 0);
    assert.equal(interaction.deleteReply.mock.calls.length, 0);
    const [preview] = interaction.editReply.mock.calls[0].arguments;
    assert.match(preview.content, /관계없는 이미지/);
    assert.match(preview.content, /썸네일 없음/);
    assert.match(preview.content, /어울리는 후보를 고르지 못했어요/);
});

for (const previewOnly of [false, true]) {
    test(`tries a community meme in ${previewOnly ? 'preview' : 'publish'} mode when the first search is rejected`, async t => {
        t.mock.method(console, 'info', () => {});
        const interaction = command(t, [
            message(t, '402', '누가 지하철에서 방귀 뀜'), message(t, '403', '어이없네'),
        ]);
        const subject = { topic: '지하철에서 갑자기 방귀 냄새가 남', visualReference: '신지드가 독구름을 남기는 장면' };
        const replies = [
            modelResponse({ messageNumbers: [1, 2], ...subject, query: 'Singed poison trail GIF', fallbackQuery: '방독면 쓰는 짤' }),
            modelResponse({ imageEvidence: '', resultId: '1' }),
            modelResponse({ imageEvidence: '냄새를 피하려고 급히 방독면을 쓰는 장면', resultId: '1' }),
        ];
        const request = t.mock.method(global, 'fetch', async () => replies.shift());
        const preview = { label: '검색 후보 1', mimeType: 'image/jpeg', data: 'AQID' };
        const primary = { id: '1', title: '신지드 초상화', imageUrl: 'https://example.com/portrait.jpg', preview };
        const community = { id: '1', title: '방독면 급하게 쓰는 짤', imageUrl: 'https://example.com/mask.jpg', preview };
        const search = t.mock.fn(async query => query === 'Singed poison trail GIF' ? [primary] : [community]);
        const download = t.mock.fn(async () => ({ bytes: Buffer.from([1, 2, 3]), extension: 'jpg' }));
        const select = createMemeSelector(createGeminiMemeModel('test-key'), search, download);

        await commandHandler(undefined, undefined, select, previewOnly)(interaction);

        assert.deepEqual(search.mock.calls.map(call => call.arguments[0]), ['Singed poison trail GIF', '방독면 쓰는 짤']);
        const fallbackInput = JSON.parse(JSON.parse(request.mock.calls[2].arguments[1].body).contents[0].parts[0].text);
        assert.deepEqual(fallbackInput.concept, subject);
        assert.equal(fallbackInput.kind, 'community');
        if (previewOnly) {
            const [reply] = interaction.editReply.mock.calls[0].arguments;
            assert.match(reply.content, /검색어\*\* · 방독면 쓰는 짤/);
            assert.match(reply.content, /Gemini 선택 #1/);
            assert.doesNotMatch(reply.content, /신지드 초상화/);
            assert.deepEqual(reply.files.map(file => file.description), [`#1 · ${community.title}`]);
            assert.equal(download.mock.calls.length, 0);
            assert.equal(interaction.channel.send.mock.calls.length, 0);
        } else {
            assert.deepEqual(download.mock.calls.map(call => call.arguments[0]), [community.imageUrl]);
            assert.equal(interaction.channel.send.mock.calls.length, 1);
            assert.equal(interaction.channel.send.mock.calls[0].arguments[0].files[0].description, community.title);
        }
    });
}

test('pages past bots until ten user messages are found and logs the chosen history in order', async t => {
    const log = t.mock.method(console, 'info', () => {});
    const humans = Array.from({ length: 11 }, (_, i) => message(t, String(400 + i), `대화 ${i}`));
    const bots = Array.from({ length: 3 }, (_, i) => message(t, String(411 + i), '봇', { author: { bot: true } }));
    const interaction = command(t, [...humans, ...bots]);
    const select = t.mock.fn(async () => noSelection);
    await commandHandler(undefined, undefined, select)(interaction);
    assert.deepEqual(interaction.channel.messages.fetch.mock.calls.map(call => call.arguments[0]), [
        { before: '500', limit: 10, cache: false }, { before: '404', limit: 10, cache: false },
    ]);
    const transcript = humans.slice(1).map((m, i) => `#${i + 1} <민서>: ${m.content}`).join('\n');
    assert.deepEqual(select.mock.calls[0].arguments[0], { turns: humans.slice(1).map((m, i) => turn(i + 1, '민서', m.content)) });
    assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[1]), {
        interactionId: '500', channelId: '200', messageIds: humans.slice(1).map(m => m.id), transcript,
        images: [], unavailableImages: [],
    });
});

test('splits a copied transcript by speaker, resolves local emoji names, and posts a standalone meme', async t => {
    const log = t.mock.method(console, 'info', () => {});
    const older = message(t, '401', '채널의 이전 대화');
    const emojiId = '216154654256398347';
    const emojisFetch = t.mock.fn(async () => new Collection([
        [emojiId, { id: emojiId, name: 'emoji_2' }],
        ['2', { id: '2', name: 'clap' }], ['3', { id: '3', name: 'clap' }],
    ]));
    const pasted = message(t, '402', [
        '민서 민간인  — 어제 17:11\\',
        '맛집 이름만 말할 듯하다가 조용해졌어\\',
        ':emoji_2:\\',
        '지호 민간인 — 어제 17:11\\',
        ':cry\\~1: :clap:\\',
        '준 민간인 — 어제 17:12\\',
        '나도몰라\\',
        '지호 민간인 — 어제 17:12\\',
        '뼈해장국은 비선호해서\\',
        '준 민간인 — 어제 17:12\\',
        '사동아닌가\\',
        '지호 민간인 — 어제 17:12\\',
        '맛집을 모르겠노\\',
        '준 민간인 — 어제 17:12\\',
        '옆 동네 친구는 알거같은데\\',
        '민서 민간인  — 어제 17:12\\',
        '알려주는 척 하면서 아는 사람이 없네ㅋㅋ\\',
        '지호 민간인 — 어제 17:13\\',
        '폭탄 돌리기ㅋㅋ',
    ].join('\n'), { guild: { emojis: { fetch: emojisFetch } } });
    const botReply = message(t, '403', '봇 메시지', { author: { bot: true } });
    const interaction = command(t, [older, pasted, botReply]);
    const select = t.mock.fn(async () => imageSelection('meme.png', 'Laughing Leo'));
    const download = t.mock.method(global, 'fetch', async url => new Response(Buffer.from([1]), {
        headers: { 'Content-Type': url.includes('/emojis/') ? 'image/webp' : 'image/png' },
    }));

    await commandHandler(undefined, undefined, select)(interaction);

    const turns = [
        turn(1, '민서 민간인', '맛집 이름만 말할 듯하다가 조용해졌어\n<이모티콘1>', ['이모티콘1']),
        turn(2, '지호 민간인', ':cry\\~1: :clap:'),
        turn(3, '준 민간인', '나도몰라'),
        turn(4, '지호 민간인', '뼈해장국은 비선호해서'),
        turn(5, '준 민간인', '사동아닌가'),
        turn(6, '지호 민간인', '맛집을 모르겠노'),
        turn(7, '준 민간인', '옆 동네 친구는 알거같은데'),
        turn(8, '민서 민간인', '알려주는 척 하면서 아는 사람이 없네ㅋㅋ'),
        turn(9, '지호 민간인', '폭탄 돌리기ㅋㅋ'),
    ];
    const transcript = turns.map(({ number, speaker, text }) => `#${number} <${speaker}>: ${text}`).join('\n');
    assert.deepEqual(select.mock.calls[0].arguments, [{ turns }, [
        { label: '이모티콘1', name: 'emoji_2', mimeType: 'image/webp', data: 'AQ==' },
    ]]);
    assert.equal(emojisFetch.mock.calls.length, 1);
    assert.equal(download.mock.calls[0].arguments[0], `https://cdn.discordapp.com/emojis/${emojiId}.webp?size=128`);
    assert.equal(older.reply.mock.calls.length, 0);
    assert.equal(pasted.reply.mock.calls.length, 0);
    assert.equal(interaction.channel.send.mock.calls[0].arguments[0].files[0].name, 'meme.png');
    assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[1]), {
        interactionId: '500', channelId: '200', messageIds: ['402'], transcript,
        pastedMessageCount: 9, images: ['이모티콘1'], unavailableImages: [],
    });
});

test('uses the last ten copied turns and leaves ordinary multiline messages intact', async t => {
    t.mock.method(console, 'info', () => {});
    assert.equal(parsePastedMessages('할 일 목록\n민서 — 어제 17:11\n과제 끝\n준 — 오늘 09:12\n쉬자'), null);
    assert.equal(parsePastedMessages('민서 — 어제 17:11\n과제 끝\n준 — 오늘 09:12'), null);

    const turns = Array.from({ length: 12 }, (_, i) => `화자${i} — 2026. 11. 24. 오후 5:11\r\n본문${i}`);
    const pasted = message(t, '402', ['```text', ...turns, '```'].join('\r\n'));
    const select = t.mock.fn(async () => noSelection);
    await commandHandler(undefined, undefined, select)(command(t, [pasted]));
    assert.deepEqual(select.mock.calls[0].arguments[0], {
        turns: turns.slice(2).map((_, i) => turn(i + 1, `화자${i + 2}`, `본문${i + 2}`)),
    });
});

test('includes a photo-only message, reuses a custom emoji image and logs missing media', async t => {
    const log = t.mock.method(console, 'info', () => {});
    const emoji = '<a:waiting:216154654256398347>';
    const photoUrl = 'https://cdn.discordapp.com/attachments/200/1/photo.png?ex=signed';
    const missingUrl = 'https://cdn.discordapp.com/attachments/200/2/missing.jpg?ex=signed';
    const attachments = new Collection([
        ['1', { name: 'photo.png', url: photoUrl, contentType: 'image/png', size: 1 }],
        ['2', { name: 'missing.jpg', url: missingUrl, contentType: 'image/jpeg', size: 1 }],
    ]);
    const memberFetch = t.mock.fn(async () => ({ displayName: '민서의 닉네임' }));
    const guild = { members: { fetch: memberFetch } };
    const text = message(t, '402', `버스 안 와 ${emoji} ${emoji}`, { guild });
    const photoOnly = message(t, '403', '', { attachments, guild });
    const interaction = command(t, [text, photoOnly]);
    const download = t.mock.method(global, 'fetch', async url => {
        if (url === missingUrl) return new Response(null, { status: 404 });
        if (url === photoUrl) return new Response(Buffer.from([0]), { headers: { 'Content-Type': 'image/png' } });
        return new Response(Buffer.from([1]), { headers: { 'Content-Type': 'image/webp' } });
    });
    const select = t.mock.fn(async () => imageSelection('meme.jpg', 'Leonardo DiCaprio Cheers'));
    await commandHandler(undefined, undefined, select)(interaction);

    const transcript = '#1 <민서의 닉네임>: 버스 안 와 <이모티콘1> <이모티콘1>\n#2 <민서의 닉네임>: <사진1> <사진2>';
    assert.deepEqual(select.mock.calls[0].arguments, [{ turns: [
        turn(1, '민서의 닉네임', '버스 안 와 <이모티콘1> <이모티콘1>', ['이모티콘1']),
        turn(2, '민서의 닉네임', '<사진1> <사진2>', ['사진1', '사진2']),
    ] }, [
        { label: '사진1', name: undefined, mimeType: 'image/png', data: 'AA==' },
        { label: '이모티콘1', name: 'waiting', mimeType: 'image/webp', data: 'AQ==' },
    ]]);
    assert.equal(download.mock.calls.filter(call => call.arguments[0].includes('/emojis/')).length, 1);
    assert.equal(download.mock.calls[2].arguments[0], 'https://cdn.discordapp.com/emojis/216154654256398347.webp?size=128');
    assert.equal(text.reply.mock.calls.length, 0);
    assert.equal(photoOnly.reply.mock.calls.length, 0);
    assert.equal(interaction.channel.send.mock.calls[0].arguments[0].files[0].name, 'meme.jpg');
    assert.deepEqual(memberFetch.mock.calls.map(call => call.arguments[0]), [{ user: '101', cache: false }]);
    assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[1]), {
        interactionId: '500', channelId: '200', messageIds: ['402', '403'], transcript,
        images: ['사진1', '이모티콘1'], unavailableImages: ['사진2'],
    });
});

test('checks history access before any read or model call', async t => {
    const select = t.mock.fn(async () => noSelection);
    for (const options of [{ readHistory: false }, { canReadHistory: false }]) {
        const interaction = command(t, [], options);
        await commandHandler(undefined, undefined, select)(interaction);
        assert.equal(interaction.channel.messages.fetch.mock.calls.length, 0);
        assert.match(interaction.editReply.mock.calls[0].arguments[0], /기록을 읽을 수 없어요/);
    }
    assert.equal(select.mock.calls.length, 0);
});

test('keeps no-match feedback private', async t => {
    t.mock.method(console, 'info', () => {});
    const target = message(t, '403', '확인했습니다.');
    const interaction = command(t, [target]);
    await commandHandler(undefined, undefined, async () => noSelection)(interaction);
    assert.equal(target.reply.mock.calls.length, 0);
    assert.equal(interaction.channel.send.mock.calls.length, 0);
    assert.match(interaction.editReply.mock.calls[0].arguments[0], /어울리는 밈을 찾지 못했어요/);
});
