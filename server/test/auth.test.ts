import assert from 'node:assert/strict';
import test from 'node:test';
import { issueSession, verifySession } from '../src/auth.js';

test('issued sessions verify and expire', () => {
  const now = Date.now();
  const session = issueSession('user-123', now);
  assert.equal(verifySession(session), 'user-123');
  assert.equal(verifySession(`${session}x`), null);
  assert.equal(verifySession('not-a-session'), null);
  const expired = issueSession('user-123', now - 40 * 86_400 * 1000);
  assert.equal(verifySession(expired), null);
});
