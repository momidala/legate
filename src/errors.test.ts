import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeApiError, apiError, isNotFound } from './errors.js';

// legate-dxw: verify the typed error representation that replaced the fragile
// `throw new Error(JSON.stringify(error))` + JSON string-matching pattern.

test('404-by-status: isNotFound() true and status/errorName populated', () => {
  const err = apiError({ status: 404, data: { message: 'gone' } });
  assert.ok(err instanceof OpenCodeApiError);
  assert.ok(err instanceof Error);
  assert.equal(err.status, 404);
  assert.equal(err.errorName, undefined);
  assert.equal(err.isNotFound(), true);
  assert.equal(isNotFound({ status: 404 }), true);
});

test('NotFoundError-by-name: isNotFound() true via name', () => {
  const err = apiError({ name: 'NotFoundError' });
  assert.equal(err.errorName, 'NotFoundError');
  assert.equal(err.status, undefined);
  assert.equal(err.isNotFound(), true);
  assert.equal(isNotFound({ name: 'NotFoundError' }), true);
});

test('non-404 statuses are not treated as not-found', () => {
  for (const status of [400, 403, 500, 502]) {
    const err = apiError({ status });
    assert.equal(err.status, status);
    assert.equal(err.isNotFound(), false, `status ${status} must not be not-found`);
    assert.equal(isNotFound({ status }), false);
  }
});

test('status "404" as a string is NOT a match (strict equality preserved)', () => {
  const err = apiError({ status: '404' });
  assert.equal(err.status, undefined); // only numbers are captured
  assert.equal(err.isNotFound(), false);
  assert.equal(isNotFound({ status: '404' }), false);
});

test('non-object / null / undefined raw values are never not-found', () => {
  for (const raw of [null, undefined, 'a string', 42, true]) {
    const err = apiError(raw);
    assert.equal(err.status, undefined);
    assert.equal(err.errorName, undefined);
    assert.equal(err.isNotFound(), false);
    assert.equal(isNotFound(raw), false);
  }
});

test('message equals JSON.stringify(raw) so user-visible text is unchanged', () => {
  const raw = { status: 404, name: 'NotFoundError', extra: [1, 2, 3] };
  const err = apiError(raw);
  assert.equal(err.message, JSON.stringify(raw));
  assert.equal(String(err), `OpenCodeApiError: ${JSON.stringify(raw)}`);
});

test('raw is preserved untouched', () => {
  const raw = { status: 404, deep: { nested: true } };
  const err = apiError(raw);
  assert.equal(err.raw, raw);
});

test('constructor and factory produce equivalent instances', () => {
  const raw = { status: 404 };
  const viaCtor = new OpenCodeApiError(raw);
  const viaFactory = apiError(raw);
  assert.equal(viaCtor.name, 'OpenCodeApiError');
  assert.equal(viaCtor.isNotFound(), viaFactory.isNotFound());
  assert.equal(viaCtor.message, viaFactory.message);
});
