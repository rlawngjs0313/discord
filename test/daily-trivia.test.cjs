const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createGeminiTrivia, runDailyTrivia, seoulDay } = require('../dist/domains/bot/daily-trivia');
const { Prisma } = require('../dist/generated/prisma/client');

test('daily trivia uses the Korean calendar date and changes at Korean midnight', () => {
    const before = seoulDay(Date.parse('2026-11-30T14:59:59.999Z'));
    assert.equal(before.date.toISOString(), '2026-11-30T00:00:00.000Z');
    assert.equal(before.nextMidnight, Date.parse('2026-11-30T15:00:00.000Z'));
    const after = seoulDay(before.nextMidnight);
    assert.equal(after.date.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(after.nextMidnight, Date.parse('2026-12-01T15:00:00.000Z'));
});

test('daily trivia skips a result that arrives after Korean midnight', async t => {
    const midnight = Date.parse('2026-11-30T15:00:00.000Z');
    t.mock.timers.enable({ apis: ['Date'], now: midnight - 1 });
    const controller = new AbortController();
    const dates = [];
    const activities = [];
    await runDailyTrivia(async date => {
        dates.push(date.toISOString().slice(0, 10));
        if (dates.length === 1) {
            t.mock.timers.setTime(midnight);
            return '어제의 상식';
        }
        return '오늘의 상식';
    }, activity => {
        activities.push(activity);
        controller.abort();
    }, controller.signal);
    assert.deepEqual(dates, ['2026-11-30', '2026-12-01']);
    assert.deepEqual(activities, ['오늘의 토막상식 · 오늘의 상식']);
});

test('daily trivia logs how to recover from a missing migration without printing Prisma details', async t => {
    const controller = new AbortController();
    const warn = t.mock.method(console, 'warn', () => controller.abort());
    await runDailyTrivia(async () => {
        throw new Prisma.PrismaClientKnownRequestError('private database details', {
            code: 'P2021', clientVersion: 'test',
        });
    }, () => assert.fail('Should not publish'), controller.signal);
    assert.deepEqual(warn.mock.calls[0].arguments, [
        'Could not update the daily trivia presence. The daily trivia table is missing. Run npm run db:deploy. Retrying within one hour.',
    ]);
});

test('Gemini trivia selects a full short sentence from one response', async t => {
    const facts = [
        '문어의 몸에는 피를 순환시키는 심장이 3개 있다.',
        '문어는 심장이 3개다!',
        '벌은\n춤으로 알린다.',
        '금성은 자전이 느리다.',
    ];
    const request = t.mock.method(global, 'fetch', async () => Response.json({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ facts }) }] } }],
    }));
    const generate = createGeminiTrivia('test-key');
    const selected = await generate('2026-11-25', ['문어는 심장이 3개다.'], new AbortController().signal);
    assert.equal(selected, facts[3]);
    assert.equal(request.mock.callCount(), 1);
});
