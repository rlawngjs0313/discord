const { test } = require('node:test');
const assert = require('node:assert/strict');
const { REST } = require('discord.js');
const { parseWon, splitWon, InputError } = require('../dist/domains/settlement/amount');
const { normalizeAccount } = require('../dist/domains/account/bank');
const { tokenCipher } = require('../dist/domains/replies/store');
const { registerCommands, settlementModal } = require('../dist/domains/bot/commands');

test('normalizes won and rejects invalid input', () => {
    for (const value of ['45350', '45,350', '45,350원']) assert.equal(parseWon(value), 45_350n);
    for (const value of ['0', '-1', '3.1', '45,35원', '1원2원', '1000000000000000']) {
        assert.throws(() => parseWon(value), InputError);
    }
});

test('assigns the remainder to distinct participants, including the creator', () => {
    const shares = splitWon(45_350n, ['creator', 'b', 'c', 'd', 'creator'], maximum => maximum - 2);
    assert.equal(shares.reduce((sum, item) => sum + item.shareWon, 0n), 45_350n);
    assert.equal(shares.filter(item => item.shareWon === 11_338n).length, 2);
    assert.equal(shares.find(item => item.userId === 'creator').shareWon, 11_338n);
    assert.deepEqual(splitWon(1n, ['a', 'b'], () => 0).map(s => s.shareWon), [1n, 0n]);
});

test('formats supported bank accounts and validates the holder', () => {
    assert.deepEqual(normalizeAccount('092', '1000 1234-5678', ' 홍길동 '), {
        bankCode: '092', formattedAccountNumber: '1000-1234-5678', accountHolder: '홍길동',
    });
    assert.equal(normalizeAccount('004', '12340312345678', '홍길동').formattedAccountNumber, '123403-12-345678');
    assert.equal(normalizeAccount('003', '12345678914123', '홍길동').formattedAccountNumber, '123-456789-14-123');
    assert.equal(normalizeAccount('032', '1041234567890', '홍길동').formattedAccountNumber, '104-1234-5678-90');
    assert.throws(() => normalizeAccount('092', '12x', '홍길동'), InputError);
    assert.throws(() => normalizeAccount('092', '123', '홍\n길동'), InputError);
    assert.throws(() => normalizeAccount('000', '123', '홍길동'), InputError);
});

test('renders a Discord user select beside the amount input', () => {
    const json = settlementModal('create:actor:post').toJSON();
    assert.equal(json.components[0].type, 18);
    assert.equal(json.components[0].label, '대상');
    assert.equal(json.components[0].component.type, 5);
    assert.equal(json.components[0].component.placeholder, '선택');
    assert.equal(json.components[0].component.max_values, 25);
    assert.equal(json.components[1].component.type, 4);
    assert.equal(json.components[1].component.placeholder, '예: 10,000원');
});

test('registers the account command without a bank option', async t => {
    const put = t.mock.method(REST.prototype, 'put', async () => []);
    await registerCommands('test-token', '123', '456');
    assert.equal(put.mock.calls.length, 1);
    const [, payload] = put.mock.calls[0].arguments;
    const accountCommand = payload.body.find(command => command.name === '계좌등록');
    assert.ok(accountCommand);
    assert.deepEqual(accountCommand.options, []);
});

test('encrypts tokens using distinct nonces and rejects tampering', () => {
    const cipher = tokenCipher(Buffer.alloc(32, 7));
    const sealed = cipher.seal('test-interaction-token');
    assert.notDeepEqual(sealed, cipher.seal('test-interaction-token'));
    assert.equal(cipher.open(sealed), 'test-interaction-token');
    sealed[sealed.length - 1] ^= 1;
    assert.throws(() => cipher.open(sealed));
});
