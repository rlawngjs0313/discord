const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ChannelType, MessageFlags, MessageType, PermissionFlagsBits, PermissionsBitField, REST } = require('discord.js');
const { commandHandler, registerCommands } = require('../dist/domains/bot/commands');
const { createGeminiMemeSelector } = require('../dist/domains/meme/gemini');

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

test('sends a single Gemini request with dialogue, candidate descriptions and a structured selection schema', async t => {
    const request = t.mock.method(global, 'fetch', async () => modelResponse('toast'));
    const conversation = [{ speaker: 'A', text: '과제 끝났다!' }];
    assert.equal(await createGeminiMemeSelector('test-key')(conversation), 'toast');
    assert.equal(request.mock.calls.length, 1);
    const [url, options] = request.mock.calls[0].arguments;
    assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(input.conversation, conversation);
    assert.deepEqual(Object.keys(input.candidates[0]), ['id', 'name', 'description']);
    assert.ok(body.generationConfig.responseJsonSchema.properties.memeId.anyOf[0].enum.includes('toast'));
});

test('accepts null, handles blocked prompts, and rejects unknown selections', async t => {
    const replies = [modelResponse(null), Response.json({ promptFeedback: { blockReason: 'SAFETY' } }), modelResponse('__proto__')];
    t.mock.method(global, 'fetch', async () => replies.shift());
    const select = createGeminiMemeSelector('test-key');
    assert.equal(await select([]), null);
    assert.equal(await select([]), null);
    await assert.rejects(() => select([]), /unknown meme ID/);
});

function message(t, id, content, options = {}) {
    return {
        id, content, type: MessageType.Default, author: { id: '101', bot: false },
        reply: t.mock.fn(async () => {}), ...options,
    };
}

function command(t, messages, { readHistory = true, canReadHistory = true } = {}) {
    const history = new Map(messages.map(m => [m.id, m]));
    const guildPermission = readHistory ? [PermissionFlagsBits.ReadMessageHistory] : [];
    return {
        id: '500', user: { id: '501' }, commandName: '밈', isChatInputCommand: () => true, inGuild: () => true,
        appPermissions: new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads,
            PermissionFlagsBits.AttachFiles, ...guildPermission]),
        memberPermissions: new PermissionsBitField(canReadHistory ? [PermissionFlagsBits.ReadMessageHistory] : []),
        channel: { type: ChannelType.PublicThread, isThread: () => true, messages: { fetch: t.mock.fn(async () => history) } },
        deferReply: t.mock.fn(async () => {}),
        editReply: t.mock.fn(async () => {}),
        deleteReply: t.mock.fn(async () => {}),
    };
}

test('replies to the latest eligible message in a thread with a single, silent attachment', async t => {
    const first = message(t, '400', '과제 끝났어 https://example.com/private');
    const target = message(t, '403', '이제 쉬자 <@101>', { type: MessageType.Reply, author: { id: '102' } });
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
    assert.deepEqual(select.mock.calls[0].arguments[0], [
        { speaker: 'A', text: '과제 끝났어 [링크]' }, { speaker: 'B', text: '이제 쉬자 [멘션]' },
    ]);
    assert.equal(download.mock.calls.length, 1);
    assert.equal(first.reply.mock.calls.length, 0);
    assert.deepEqual(target.reply.mock.calls[0].arguments[0], {
        files: [{ attachment: Buffer.from([1, 2, 3]), name: 'toast.jpg', description: 'Leonardo DiCaprio Cheers' }],
        failIfNotExists: true, allowedMentions: { parse: [], repliedUser: false }, flags: MessageFlags.SuppressNotifications,
    });
    assert.equal(interaction.deleteReply.mock.calls.length, 1);
    assert.equal(interaction.editReply.mock.calls.length, 0);
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
    const target = message(t, '403', '확인했습니다.');
    const interaction = command(t, [target]);
    await commandHandler(undefined, undefined, async () => null)(interaction);
    assert.equal(target.reply.mock.calls.length, 0);
    assert.match(interaction.editReply.mock.calls[0].arguments[0], /어울리는 밈을 찾지 못했어요/);
});
