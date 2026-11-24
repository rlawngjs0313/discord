const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ChannelType, Collection, MessageFlags, MessageType, PermissionFlagsBits, PermissionsBitField, REST } = require('discord.js');
const { commandHandler, registerCommands } = require('../dist/domains/bot/commands');
const { createGeminiMemeSelector } = require('../dist/domains/meme/gemini');
const { parsePastedMessages } = require('../dist/domains/meme/pasted');

const modelResponse = (memeId) => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [
    { text: '{"memeId":"other"}', thought: true }, { text: JSON.stringify({ memeId }) },
] } }] });

test('registers the meme command only when enabled', async t => {
    const put = t.mock.method(REST.prototype, 'put', async () => []);
    await registerCommands('test-token', '123', '456');
    await registerCommands('test-token', '123', '456', true);
    assert.equal(put.mock.calls[0].arguments[1].body.some(command => command.name === '밈'), false);
    assert.equal(put.mock.calls[1].arguments[1].body.some(command => command.name === '밈'), true);
});

test('sends dialogue and labeled images together with a structured selection schema', async t => {
    const request = t.mock.method(global, 'fetch', async () => modelResponse('toast'));
    const conversation = '<민서>: 과제 끝났다! <사진1>\n<준>: <이모티콘1>';
    const images = [
        { label: '사진1', mimeType: 'image/png', data: 'AA==' },
        { label: '이모티콘1', name: 'celebrate', mimeType: 'image/webp', data: 'AQ==' },
    ];
    assert.equal(await createGeminiMemeSelector('test-key')(conversation, images), 'toast');
    assert.equal(request.mock.calls.length, 1);
    const [url, options] = request.mock.calls[0].arguments;
    assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(options.body);
    const [part, ...media] = body.contents[0].parts;
    const input = JSON.parse(part.text);
    assert.equal(input.conversation, conversation);
    assert.deepEqual(Object.keys(input.candidates[0]), ['id', 'name', 'description']);
    assert.deepEqual(media, [
        { text: '사진1' }, { inlineData: { mimeType: 'image/png', data: 'AA==' } },
        { text: '이모티콘1 (celebrate)' }, { inlineData: { mimeType: 'image/webp', data: 'AQ==' } },
    ]);
    assert.ok(body.generationConfig.responseJsonSchema.properties.memeId.anyOf[0].enum.includes('toast'));
});

test('accepts null, handles blocked prompts, and rejects unknown selections', async t => {
    const replies = [modelResponse(null), Response.json({ promptFeedback: { blockReason: 'SAFETY' } }), modelResponse('__proto__')];
    t.mock.method(global, 'fetch', async () => replies.shift());
    const select = createGeminiMemeSelector('test-key');
    assert.equal(await select(''), null);
    assert.equal(await select(''), null);
    await assert.rejects(() => select(''), /unknown meme ID/);
});

function message(t, id, content, options = {}) {
    return {
        id, content, type: MessageType.Default, author: { id: '101', bot: false, displayName: '민서' },
        attachments: new Collection(),
        reply: t.mock.fn(async () => {}), ...options,
    };
}

function command(t, messages, { readHistory = true, canReadHistory = true } = {}) {
    const guildPermission = readHistory ? [PermissionFlagsBits.ReadMessageHistory] : [];
    const fetch = t.mock.fn(async ({ before, limit }) => new Collection(messages
        .filter(m => BigInt(m.id) < BigInt(before))
        .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1)
        .slice(0, limit).map(m => [m.id, m])));
    return {
        id: '500', channelId: '200', user: { id: '501' }, commandName: '밈', isChatInputCommand: () => true, inGuild: () => true,
        appPermissions: new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads,
            PermissionFlagsBits.AttachFiles, ...guildPermission]),
        memberPermissions: new PermissionsBitField(canReadHistory ? [PermissionFlagsBits.ReadMessageHistory] : []),
        channel: { type: ChannelType.PublicThread, isThread: () => true, messages: { fetch }, send: t.mock.fn(async () => {}) },
        deferReply: t.mock.fn(async () => {}),
        editReply: t.mock.fn(async () => {}),
        deleteReply: t.mock.fn(async () => {}),
    };
}

test('posts a single silent attachment as a standalone message in the current thread', async t => {
    t.mock.method(console, 'info', () => {});
    const first = message(t, '400', '과제 끝났어 https://example.com/private');
    const target = message(t, '403', '이제 쉬자 <@101>', {
        type: MessageType.Reply, author: { id: '102', displayName: '계정 표시 이름' }, member: { displayName: '준' },
    });
    const bot = message(t, '410', '봇의 답장', { author: { id: '103', bot: true } });
    const hook = message(t, '409', '웹훅 메시지', { webhookId: '104' });
    const noText = message(t, '408', '  ');
    const system = message(t, '407', '채널 이름을 변경함', { type: MessageType.ChannelNameChange });
    const interaction = command(t, [system, target, bot, first, noText, hook]);
    const select = t.mock.fn(async () => 'toast');
    const download = t.mock.method(global, 'fetch', async () => new Response(Buffer.from([1, 2, 3]), {
        headers: { 'Content-Type': 'image/jpeg' },
    }));

    await commandHandler(undefined, undefined, select)(interaction);
    assert.deepEqual(interaction.deferReply.mock.calls[0].arguments, [{ flags: MessageFlags.Ephemeral }]);
    assert.deepEqual(interaction.channel.messages.fetch.mock.calls[0].arguments, [{ before: '500', limit: 10, cache: false }]);
    assert.deepEqual(select.mock.calls[0].arguments, ['<민서>: 과제 끝났어 [링크]\n<준>: 이제 쉬자 [멘션]', []]);
    assert.equal(download.mock.calls.length, 1);
    assert.equal(first.reply.mock.calls.length, 0);
    assert.equal(target.reply.mock.calls.length, 0);
    assert.equal(interaction.channel.send.mock.calls.length, 1);
    assert.deepEqual(interaction.channel.send.mock.calls[0].arguments[0], {
        files: [{ attachment: Buffer.from([1, 2, 3]), name: 'toast.jpg', description: 'Leonardo DiCaprio Cheers' }],
        allowedMentions: { parse: [] }, flags: MessageFlags.SuppressNotifications,
    });
    assert.equal(interaction.deleteReply.mock.calls.length, 1);
    assert.equal(interaction.editReply.mock.calls.length, 0);
});

test('pages past bots until ten user messages are found and logs the chosen history in order', async t => {
    const log = t.mock.method(console, 'info', () => {});
    const humans = Array.from({ length: 11 }, (_, i) => message(t, String(400 + i), `대화 ${i}`));
    const bots = Array.from({ length: 3 }, (_, i) => message(t, String(411 + i), '봇', { author: { bot: true } }));
    const interaction = command(t, [...humans, ...bots]);
    const select = t.mock.fn(async () => null);
    await commandHandler(undefined, undefined, select)(interaction);
    assert.deepEqual(interaction.channel.messages.fetch.mock.calls.map(call => call.arguments[0]), [
        { before: '500', limit: 10, cache: false }, { before: '404', limit: 10, cache: false },
    ]);
    const transcript = humans.slice(1).map(m => `<민서>: ${m.content}`).join('\n');
    assert.equal(select.mock.calls[0].arguments[0], transcript);
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
    const select = t.mock.fn(async () => 'laughing-leo');
    const download = t.mock.method(global, 'fetch', async url => new Response(Buffer.from([1]), {
        headers: { 'Content-Type': url.includes('/emojis/') ? 'image/webp' : 'image/png' },
    }));

    await commandHandler(undefined, undefined, select)(interaction);

    const transcript = [
        '<민서 민간인>: 맛집 이름만 말할 듯하다가 조용해졌어\n<이모티콘1>',
        '<지호 민간인>: :cry\\~1: :clap:',
        '<준 민간인>: 나도몰라',
        '<지호 민간인>: 뼈해장국은 비선호해서',
        '<준 민간인>: 사동아닌가',
        '<지호 민간인>: 맛집을 모르겠노',
        '<준 민간인>: 옆 동네 친구는 알거같은데',
        '<민서 민간인>: 알려주는 척 하면서 아는 사람이 없네ㅋㅋ',
        '<지호 민간인>: 폭탄 돌리기ㅋㅋ',
    ].join('\n');
    assert.deepEqual(select.mock.calls[0].arguments, [transcript, [
        { label: '이모티콘1', name: 'emoji_2', mimeType: 'image/webp', data: 'AQ==' },
    ]]);
    assert.equal(emojisFetch.mock.calls.length, 1);
    assert.equal(download.mock.calls[0].arguments[0], `https://cdn.discordapp.com/emojis/${emojiId}.webp?size=128`);
    assert.equal(older.reply.mock.calls.length, 0);
    assert.equal(pasted.reply.mock.calls.length, 0);
    assert.equal(interaction.channel.send.mock.calls[0].arguments[0].files[0].name, 'laughing-leo.png');
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
    const select = t.mock.fn(async () => null);
    await commandHandler(undefined, undefined, select)(command(t, [pasted]));
    assert.equal(select.mock.calls[0].arguments[0], turns.slice(2).map((_, i) => `<화자${i + 2}>: 본문${i + 2}`).join('\n'));
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
        if (url === 'https://i.imgflip.com/39t1o.jpg') {
            return new Response(Buffer.from([2]), { headers: { 'Content-Type': 'image/jpeg' } });
        }
        return new Response(Buffer.from([1]), { headers: { 'Content-Type': 'image/webp' } });
    });
    const select = t.mock.fn(async () => 'toast');
    await commandHandler(undefined, undefined, select)(interaction);

    const transcript = '<민서의 닉네임>: 버스 안 와 <이모티콘1> <이모티콘1>\n<민서의 닉네임>: <사진1> <사진2>';
    assert.deepEqual(select.mock.calls[0].arguments, [transcript, [
        { label: '사진1', name: undefined, mimeType: 'image/png', data: 'AA==' },
        { label: '이모티콘1', name: 'waiting', mimeType: 'image/webp', data: 'AQ==' },
    ]]);
    assert.equal(download.mock.calls.filter(call => call.arguments[0].includes('/emojis/')).length, 1);
    assert.equal(download.mock.calls[2].arguments[0], 'https://cdn.discordapp.com/emojis/216154654256398347.webp?size=128');
    assert.equal(text.reply.mock.calls.length, 0);
    assert.equal(photoOnly.reply.mock.calls.length, 0);
    assert.equal(interaction.channel.send.mock.calls[0].arguments[0].files[0].name, 'toast.jpg');
    assert.deepEqual(memberFetch.mock.calls.map(call => call.arguments[0]), [{ user: '101', cache: false }]);
    assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[1]), {
        interactionId: '500', channelId: '200', messageIds: ['402', '403'], transcript,
        images: ['사진1', '이모티콘1'], unavailableImages: ['사진2'],
    });
});

test('checks history access before any read or model call', async t => {
    const select = t.mock.fn(async () => null);
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
    await commandHandler(undefined, undefined, async () => null)(interaction);
    assert.equal(target.reply.mock.calls.length, 0);
    assert.equal(interaction.channel.send.mock.calls.length, 0);
    assert.match(interaction.editReply.mock.calls[0].arguments[0], /어울리는 밈을 찾지 못했어요/);
});
