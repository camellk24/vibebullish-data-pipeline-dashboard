'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isUnmatured60dBucket } = require('./ae-buckets.js');

test('60d-only buckets with nothing resolved are unmatured', () => {
    assert.equal(isUnmatured60dBucket('horizon', '60d', 0), true);
    assert.equal(isUnmatured60dBucket('predicate', 'buy_now', 0), true);
    assert.equal(isUnmatured60dBucket('predicate', 'sell_now', undefined), true);
});

test('once anything resolves, the bucket renders its real grades', () => {
    assert.equal(isUnmatured60dBucket('horizon', '60d', 1), false);
    assert.equal(isUnmatured60dBucket('predicate', 'sell_now', 229315), false);
});

test('mixed-horizon buckets never get the note, even when empty', () => {
    assert.equal(isUnmatured60dBucket('predicate', 'none', 0), false);
    assert.equal(isUnmatured60dBucket('horizon', '20d', 0), false);
    assert.equal(isUnmatured60dBucket('trigger', 'scheduled_batch', 0), false);
    assert.equal(isUnmatured60dBucket('trigger', '60d', 0), false);
});
