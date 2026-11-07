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
  const session = issueSession('user-123', now);
  assert.equal(verifySession(session), 'user-123');
  assert.equal(verifySession(`${session}x`), null);
  assert.equal(verifySession('not-a-session'), null);
  const expired = issueSession('user-123', now - 40 * 86_400 * 1000);
  assert.equal(verifySession(expired), null);
});
