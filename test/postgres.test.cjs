const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { runOnce } = require('graphile-worker');
const {
    ApplicationCommandType, ButtonInteraction, ChannelType, ChatInputCommandInteraction, Client, ComponentType,
    GatewayIntentBits, InteractionResponseType, InteractionType, MessageFlags, ModalSubmitInteraction, Routes,
} = require('discord.js');
const { createDatabase } = require('../dist/database/database');
const { getTransfers, getDetail, createSettlement, editSettlement, cancelSettlement } = require('../dist/domains/settlement/settlements');
const { saveAccount, deleteAccount } = require('../dist/domains/account/accounts');
const { storeReply, replyLifetime, tokenCipher } = require('../dist/domains/replies/store');
const { replyTasks } = require('../dist/domains/replies/worker');
const { commandHandler } = require('../dist/domains/bot/commands');

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) {
    test('PostgreSQL integration', { skip: 'Set TEST_DATABASE_URL for the disposable PostgreSQL database.' }, () => {});
} else {
    const url = new URL(connectionString);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname.endsWith('_test'),
        'Integration tests require a loopback database ending in _test.');
    const queries = [];
    const db = createDatabase(connectionString, 10, query => queries.push(query));
    const sql = new Pool({ connectionString, max: 1 });
    const cipher = tokenCipher(Buffer.alloc(32, 3));
    after(async () => {
        await db.close();
        await sql.end();
    });

    let serial = 0n;
    const id = () => String(BigInt(Date.now()) * 1_000_000n + ++serial);
    const post = () => ({ postId: id(), forumId: id(), guildId: id() });
    const recipientAccount = {
        bankCode: '092', formattedAccountNumber: '1000-1234-5678', accountHolder: '테스트',
    };
    const add = (scope, creator, participant, totalWon) => db.transaction(tx => createSettlement(
        tx, scope, creator, id(), { totalWon, userIds: [creator, participant] },
    ));
    const tracked = (tx, scope, user, options = {}) => {
        const createdAt = options.createdAt ?? new Date();
        return storeReply(tx, {
            ownerId: user, interactionId: options.interactionId ?? id(), interactionAt: createdAt.getTime(), createdAt,
            commandKind: 'confirm', postId: scope, encryptedToken: cipher.seal('fixture-token'), ...options,
        });
    };
    const job = async replyId => (await sql.query(
        'SELECT key, run_at FROM graphile_worker.jobs WHERE key = $1', ['private-reply:' + replyId],
    )).rows[0];
    const state = async responseId => db.prisma.privateResponse.findUniqueOrThrow({ where: { responseId } });

    test('post-scoped totals, detail filtering, account updates, and settlement ownership', async () => {
        const scope = post();
        const elsewhere = post();
        const alice = id(), bob = id(), carol = id();
        const first = await add(scope, bob, alice, 6_000n);
        await add(scope, bob, alice, 4_000n);
        await add(scope, alice, carol, 8_000n);
        const unrelated = await add(scope, bob, carol, 2_000n);
        await add(elsewhere, bob, alice, 20_000n);

        const rows = await db.transaction(tx => getTransfers(tx, scope.postId, alice));
        assert.deepEqual(rows.map(({ recipientId, amount, account }) => ({ recipientId, amount, account })),
            [{ recipientId: bob, amount: 5_000n, account: undefined }]);

        const last = await db.transaction(tx => getDetail(tx, scope.postId, alice, 99));
        assert.equal(last.count, 3);
        assert.equal(last.page, 3);
        assert.equal(last.record.recordId, first.recordId);
        assert.deepEqual(last.record.shares.map(share => share.userId), [alice]);
        const newest = await db.transaction(tx => getDetail(tx, scope.postId, alice, 1));
        assert.equal(newest.record.creatorId, alice);
        assert.equal(newest.record.shares.length, 2);

        const old = await db.transaction(tx => tracked(tx, scope.postId, alice, { accountIds: [bob], recordIds: [first.recordId] }));
        const other = await db.transaction(tx => tracked(tx, scope.postId, carol, { recordIds: [unrelated.recordId] }));
        assert.equal((await job(old.responseId)).run_at.getTime(), old.createdAt.getTime() + replyLifetime);

        await assert.rejects(db.transaction(async tx => {
            const rolledBack = await tracked(tx, scope.postId, alice, { accountIds: [bob] });
            assert.ok(rolledBack.responseId);
            await saveAccount(tx, bob, recipientAccount);
            throw new Error('intentional rollback');
        }), /rollback/);
        assert.equal((await state(old.responseId)).state, 'active');
        assert.equal((await job(old.responseId)).run_at.getTime(), old.createdAt.getTime() + replyLifetime);
        assert.equal(await db.prisma.userBankAccount.findUnique({ where: { userId: bob } }), null);

        await db.transaction(tx => saveAccount(tx, bob, recipientAccount));
        assert.equal((await state(old.responseId)).state, 'invalidated');
        assert.ok((await job(old.responseId)).run_at.getTime() < old.createdAt.getTime() + replyLifetime);
        assert.equal((await state(other.responseId)).state, 'active');
        const crossPost = await db.transaction(tx => getTransfers(tx, elsewhere.postId, alice));
        assert.equal(crossPost[0].account.accountHolder, '테스트');
        await db.transaction(tx => deleteAccount(tx, bob));
        assert.equal((await db.transaction(tx => getTransfers(tx, scope.postId, alice)))[0].account, undefined);

        const owner = { postId: scope.postId, recordId: first.recordId, creatorId: bob };
        await assert.rejects(db.transaction(tx => cancelSettlement(tx, { ...owner, creatorId: alice }, 1)));
        const unchanged = await db.transaction(tx => editSettlement(tx, owner, 1, { totalWon: 6_000n, userIds: [alice, bob] }));
        assert.equal(unchanged.changed, false);
        assert.equal(unchanged.version, 1);
        const changed = await db.transaction(tx => editSettlement(tx, owner, 1, { totalWon: 8_000n, userIds: [bob, carol] }));
        assert.equal(changed.changed, true);
        await assert.rejects(db.transaction(tx => cancelSettlement(tx, owner, 1)));
        await db.transaction(tx => cancelSettlement(tx, owner, 2));
        assert.equal((await db.transaction(tx => getTransfers(tx, scope.postId, alice)))[0].amount, 2_000n);
    });

    test('serializable retry prevents a missed invalidation on initial account registration', async () => {
        const scope = post(), sender = id(), receiver = id();
        await add(scope, receiver, sender, 10_000n);
        let pause;
        const allowInsert = new Promise(resolve => { pause = resolve; });
        let reached;
        const readMissingAccount = new Promise(resolve => { reached = resolve; });
        let attempts = 0;

        const lookup = db.transaction(async tx => {
            const payments = await getTransfers(tx, scope.postId, sender);
            if (++attempts === 1) {
                assert.equal(payments[0].account, undefined);
                reached();
                await allowInsert;
            }
            const row = await tracked(tx, scope.postId, sender, { accountIds: [receiver] });
            return { row, account: payments[0].account };
        });
        await readMissingAccount;
        try { await db.transaction(tx => saveAccount(tx, receiver, recipientAccount)); }
        finally { pause(); }
        const current = await lookup;
        assert.ok(attempts > 1);
        assert.equal(current.account.formattedAccountNumber, recipientAccount.formattedAccountNumber);
        assert.equal((await state(current.row.responseId)).state, 'active');
    });

    test('live Graphile Worker consumes immediate deletes and expires old tokens', async () => {
        const alice = id(), bob = id();
        await db.transaction(tx => saveAccount(tx, bob, recipientAccount));
        const immediate = await db.transaction(tx => tracked(tx, undefined, alice, { accountIds: [bob] }));
        const normal = await db.transaction(tx => tracked(tx, undefined, alice, {
            createdAt: new Date(Date.now() - replyLifetime - 1_000), encryptedToken: cipher.seal('normal-expiry-token'),
        }));
        const expired = await db.transaction(tx => tracked(tx, undefined, alice, { createdAt: new Date(Date.now() - 16 * 60_000) }));
        await db.transaction(tx => deleteAccount(tx, bob));

        const urls = [];
        await runOnce({
            connectionString,
            taskList: replyTasks(db, cipher, '123', async (url, options) => {
                assert.equal(options.method, 'DELETE');
                urls.push(url);
                return new Response(null, { status: 204 });
            }),
            concurrency: 1,
            noHandleSignals: true,
        });
        assert.ok(urls.some(url => url.endsWith('/fixture-token/messages/@original')));
        assert.ok(urls.some(url => url.endsWith('/normal-expiry-token/messages/@original')));
        assert.equal((await state(normal.responseId)).state, 'deleted');
        assert.equal((await state(immediate.responseId)).state, 'deleted');
        assert.equal((await state(immediate.responseId)).encryptedToken, null);
        assert.equal((await state(expired.responseId)).state, 'expired');
        assert.equal((await state(expired.responseId)).encryptedToken, null);
        assert.equal(await job(immediate.responseId), undefined);
    });

    test('Discord command handler uses ephemeral modal results on a forum and masks unrelated records', async t => {
        const handle = commandHandler(db, cipher);
        const author = id(), reader = id(), scope = post();
        const opening = { type: ChannelType.PublicThread, id: scope.postId, guildId: scope.guildId,
            parentId: scope.forumId, parent: { type: ChannelType.GuildForum, id: scope.forumId } };
        function fake(actor, type, input) {
            return {
                id: id(), user: { id: actor }, channel: opening, guildId: scope.guildId,
                token: 'fixture-token', createdTimestamp: Date.now(),
                inGuild() { return true; },
                isAutocomplete() { return false; },
                isChatInputCommand() { return type === 'command'; },
                isButton() { return type === 'button'; },
                isModalSubmit() { return type === 'modal'; },
                showModal(modal) { this.modal = modal.toJSON(); },
                async deferReply(options) { this.deferred = true; assert.equal(options.flags, MessageFlags.Ephemeral); },
                async editReply(options) { this.response = options; },
                ...input,
            };
        }
        const start = fake(author, 'command', { commandName: '정산' });
        await handle(start);
        assert.equal(start.modal.components[0].component.type, ComponentType.UserSelect);

        const submitted = fake(author, 'modal', {
            customId: start.modal.custom_id,
            fields: {
                getField() { return { type: ComponentType.UserSelect }; },
                getSelectedUsers() { return new Map([[reader, { id: reader, bot: false }]]); },
                getSelectedMembers() { return new Map([[reader, {}]]); },
                getTextInputValue() { return '10,000원'; },
            },
        });
        const reportQueries = (label, start) => {
            const statements = queries.slice(start).filter(query => !/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION)\b/i.test(query));
            assert.ok(!statements.some(query => /pg_advisory|FOR\s+UPDATE|FOR\s+SHARE/i.test(query)));
            t.diagnostic(label + ' Prisma 업무 SQL: ' + statements.length);
        };
        let from = queries.length;
        await handle(submitted);
        reportQueries('/정산', from);
        assert.match(submitted.response.content, /10,000원/);
        assert.match(submitted.response.content, new RegExp(reader + '> → <@' + author + '>: 5,000원'));
        assert.deepEqual(submitted.response.allowedMentions, { parse: [] });

        const check = fake(reader, 'command', { commandName: '정산확인' });
        from = queries.length;
        await handle(check);
        reportQueries('/정산확인', from);
        assert.match(check.response.content, /5,000원/);
        assert.ok(!check.response.content.includes('```'));
        const register = fake(author, 'command', { commandName: '계좌등록' });
        await handle(register);
        assert.deepEqual(register.modal.components.map(field => field.label), ['은행명', '계좌번호', '예금주명']);
        const bankList = register.modal.components[0].component;
        assert.ok(bankList.type === ComponentType.StringSelect && bankList.required && bankList.min_values === 1 && bankList.max_values === 1);
        assert.deepEqual(bankList.options.map(option => option.label), [
            'KB국민은행', '토스뱅크', '신한은행', '카카오뱅크', 'NH농협은행', '우리은행', '하나은행', '케이뱅크', 'IBK기업은행',
            '경남은행', '광주은행', '부산은행', '수협은행', '전북은행', '제주은행', '한국씨티은행', 'iM뱅크', 'KDB산업은행', 'SC제일은행',
        ]);
        const accountFields = (values, number = '1000-9876-5432') => ({
            fields: new Map([['bank-code', { type: ComponentType.StringSelect, values }]]),
            getTextInputValue: key => key === 'number' ? number : '테스트 예금주',
        });
        const invalidBank = fake(author, 'modal', { customId: register.modal.custom_id, fields: accountFields([]) });
        await handle(invalidBank);
        assert.match(invalidBank.response.content, /은행 하나를 선택/);
        const retryButton = invalidBank.response.components[0].components[0];
        assert.equal(retryButton.data.label, '다시 입력');
        const retry = fake(author, 'button', { customId: retryButton.data.custom_id });
        await handle(retry);
        assert.deepEqual(retry.modal.components, register.modal.components);
        const excluded = fake(author, 'modal', { customId: retry.modal.custom_id, fields: accountFields(['271']) });
        await handle(excluded);
        assert.match(excluded.response.content, /목록에서 은행을 선택/);
        const invalidNumber = fake(author, 'modal', {
            customId: retry.modal.custom_id, fields: accountFields(['092'], '계좌번호가 아님'),
        });
        await handle(invalidNumber);
        assert.match(invalidNumber.response.content, /16자리/);
        const bank = fake(author, 'modal', {
            customId: retry.modal.custom_id, fields: accountFields(['092']),
        });
        await handle(bank);
        assert.match(bank.response.content, /계좌를 등록/);
        assert.equal((await db.prisma.privateResponse.findUniqueOrThrow({ where: { interactionId: check.id } })).state,
            'invalidated');
        const checkWithBank = fake(reader, 'command', { commandName: '정산확인' });
        from = queries.length;
        await handle(checkWithBank);
        reportQueries('/정산확인(계좌 있음)', from);
        assert.ok(checkWithBank.response.content.includes('```\n토스뱅크 1000-9876-5432 테스트 예금주\n```'));
        const detail = fake(reader, 'command', { commandName: '정산세부' });
        from = queries.length;
        await handle(detail);
        reportQueries('/정산세부', from);
        assert.match(detail.response.content, /5,000원/);
        assert.ok(!detail.response.components[0].components.some(b => b.data.label === '수정'));
        const ownerDetail = fake(author, 'command', { commandName: '정산세부' });
        await handle(ownerDetail);
        const editButton = ownerDetail.response.components[0].components.find(b => b.data.label === '수정');
        assert.ok(editButton);
        const unauthorized = fake(reader, 'button', { customId: editButton.data.custom_id });
        await handle(unauthorized);
        assert.match(unauthorized.response.content, /실행한 사람만/);
        const ownerEdit = fake(author, 'button', { customId: editButton.data.custom_id });
        await handle(ownerEdit);
        assert.equal(ownerEdit.modal.components[1].component.value, '10000');
        assert.deepEqual(ownerEdit.modal.components[0].component.default_values, [{ id: reader, type: 'user' }]);
        const unrelated = fake(id(), 'command', { commandName: '정산세부' });
        await handle(unrelated);
        assert.match(unrelated.response.content, /관련된 정산 기록이 없어요/);
        const outside = fake(reader, 'command', { commandName: '정산확인', channel: { type: ChannelType.GuildText } });
        await handle(outside);
        assert.match(outside.response.content, /포럼의 포스트/);
    });

    test('Discord SDK handles forum modal submissions and edits detail pages in place', async t => {
        const handle = commandHandler(db, cipher);
        const scope = post();
        const client = new Client({ intents: [GatewayIntentBits.Guilds] });
        t.after(() => client.destroy());
        const applicationId = id();
        const creator = { id: id(), username: 'creator', discriminator: '0' };
        const reader = { id: id(), username: 'reader', discriminator: '0' };
        const thread = {
            type: ChannelType.PublicThread, id: scope.postId, guildId: scope.guildId,
            parentId: scope.forumId, parent: { type: ChannelType.GuildForum, id: scope.forumId },
            messages: { cache: new Map(), _add: message => message },
        };
        client.channels.cache.set(thread.id, thread);

        const rest = [];
        client.rest.post = async (route, options) => rest.push({ method: 'POST', route, ...options });
        client.rest.patch = async (route, options) => {
            rest.push({ method: 'PATCH', route, ...options });
            return { id: id(), channel_id: scope.postId, ...options.body };
        };

        const envelope = (type, user, data) => {
            const snowflake = ((BigInt(Date.now()) - 1420070400000n) << 22n) + ++serial;
            return {
                id: String(snowflake), application_id: applicationId, guild_id: scope.guildId,
                channel: { id: scope.postId, type: ChannelType.PublicThread },
                member: { user, roles: [], permissions: '0' }, token: 'test-token-' + snowflake,
                type, data, version: 1, locale: 'ko', guild_locale: 'ko', app_permissions: '0',
                entitlements: [], authorizing_integration_owners: { 0: scope.guildId }, context: 0,
            };
        };

        const slash = new ChatInputCommandInteraction(client, envelope(InteractionType.ApplicationCommand, creator, {
            id: id(), name: '정산', type: ApplicationCommandType.ChatInput, options: [],
        }));
        await handle(slash);
        const [open] = rest;
        assert.equal(open.route, Routes.interactionCallback(slash.id, slash.token));
        assert.equal(open.body.type, InteractionResponseType.Modal);

        const submit = new ModalSubmitInteraction(client, envelope(InteractionType.ModalSubmit, creator, {
            custom_id: open.body.data.custom_id,
            components: [
                { type: ComponentType.Label, component: { type: ComponentType.UserSelect, custom_id: 'users', values: [reader.id] } },
                { type: ComponentType.Label, component: { type: ComponentType.TextInput, custom_id: 'total', value: '10,000원' } },
            ],
            resolved: { users: { [reader.id]: reader }, members: { [reader.id]: { roles: [], permissions: '0' } } },
        }));
        await handle(submit);
        assert.equal(rest.length, 3);
        const [, defer, result] = rest;
        assert.equal(defer.route, Routes.interactionCallback(submit.id, submit.token));
        assert.equal(defer.body.type, InteractionResponseType.DeferredChannelMessageWithSource);
        assert.equal(defer.body.data.flags, MessageFlags.Ephemeral);
        assert.equal(result.method, 'PATCH');
        assert.equal(result.route, Routes.webhookMessage(applicationId, submit.token, '@original'));
        assert.deepEqual(result.body.allowed_mentions, { parse: [] });
        assert.ok(result.body.content.includes('<@' + reader.id + '> → <@' + creator.id + '>: 5,000원'));

        const earlier = await db.prisma.privateResponse.findUniqueOrThrow({ where: { interactionId: submit.id } });
        assert.equal(earlier.tokenExpiresAt.getTime(), submit.createdTimestamp + 15 * 60_000);
        assert.equal(cipher.open(earlier.encryptedToken), submit.token);
        assert.equal((await job(earlier.responseId)).run_at.getTime(), earlier.createdAt.getTime() + 60_000);

        const newest = await add(scope, creator.id, reader.id, 20_000n);
        const oldest = await db.prisma.settlementRecord.findFirstOrThrow({ where: { createInteractionId: submit.id } });
        const detail = new ChatInputCommandInteraction(client, envelope(InteractionType.ApplicationCommand, reader, {
            id: id(), name: '정산세부', type: ApplicationCommandType.ChatInput, options: [],
        }));
        await handle(detail);
        const firstPage = rest.at(-1).body;
        assert.match(firstPage.content, /^정산 1\/2[\s\S]*10,000원/);
        const reply = await db.prisma.privateResponse.findUniqueOrThrow({ where: { interactionId: detail.id } });
        const scheduled = await job(reply.responseId);
        assert.equal(scheduled.run_at.getTime(), reply.createdAt.getTime() + replyLifetime);
        const linkedRecords = async () => (await db.prisma.privateResponseRecord.findMany({
            where: { responseId: reply.responseId }, select: { recordId: true },
        })).map(link => link.recordId);
        assert.deepEqual(await linkedRecords(), [newest.recordId]);

        const messageId = id();
        const press = async (label, body) => {
            const button = body.components[0].components.find(component => component.label === label);
            assert.ok(button && !button.disabled);
            const start = rest.length;
            const click = new ButtonInteraction(client, {
                ...envelope(InteractionType.MessageComponent, reader, {
                    component_type: ComponentType.Button, custom_id: button.custom_id,
                }),
                message: { id: messageId, channel_id: scope.postId, flags: MessageFlags.Ephemeral, ...body },
            });
            await handle(click);
            assert.equal(rest.length, start + 2);
            const [ack, patch] = rest.slice(start);
            assert.equal(ack.route, Routes.interactionCallback(click.id, click.token));
            assert.equal(ack.body.type, InteractionResponseType.DeferredMessageUpdate);
            assert.equal(patch.method, 'PATCH');
            assert.equal(patch.route, Routes.webhookMessage(applicationId, click.token, '@original'));
            assert.equal(await db.prisma.privateResponse.count({ where: { interactionId: click.id } }), 0);
            return patch.body;
        };
        const secondPage = await press('다음', firstPage);
        assert.match(secondPage.content, /^정산 2\/2[\s\S]*5,000원/);
        assert.deepEqual(await linkedRecords(), [oldest.recordId]);
        const back = await press('이전', secondPage);
        assert.equal(back.content, firstPage.content);
        assert.deepEqual(await linkedRecords(), [newest.recordId]);
        assert.deepEqual(await state(reply.responseId), reply);
        assert.deepEqual(await job(reply.responseId), scheduled);
    });
}
