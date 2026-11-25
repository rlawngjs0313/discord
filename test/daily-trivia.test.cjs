const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runDailyTrivia, seoulDay } = require('../dist/domains/bot/daily-trivia');

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
