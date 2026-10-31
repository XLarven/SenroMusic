import assert from 'node:assert/strict';
import test from 'node:test';
import { issueSession, tokensMatch, verifySession } from '../src/auth.js';
import { config } from '../src/config.js';

test('configured token matches itself but not a wrong token', () => {
  assert.equal(tokensMatch(config.musicToken), true);
  assert.equal(tokensMatch(`${config.musicToken}-wrong`), false);
});

test('issued sessions verify and expire', () => {
  const now = Date.now();
  const session = issueSession(now);
  assert.equal(verifySession(session), true);
  assert.equal(verifySession(`${session}x`), false);
  assert.equal(verifySession('not-a-session'), false);
  const expired = issueSession(now - 40 * 86_400 * 1000);
  assert.equal(verifySession(expired), false);
});
