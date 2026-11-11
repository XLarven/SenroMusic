import assert from 'node:assert/strict';
import test from 'node:test';
import { isVariantTitle } from '../src/audio/jiosaavn.js';
import { songTitle } from '../src/searchQuality.js';

test('songTitle drops the soundtrack tag and subtitle', () => {
  assert.equal(
    songTitle('Kesariya (From "Brahmastra") - Tu Fuljhadiyo Wale Tyohaaro Jesi - Happy Diwali'),
    'Kesariya',
  );
});

test('songTitle keeps a plain title untouched', () => {
  assert.equal(songTitle('Blinding Lights'), 'Blinding Lights');
  assert.equal(songTitle('Tum Hi Ho'), 'Tum Hi Ho');
});

test('songTitle falls back when brackets are the whole title', () => {
  assert.equal(songTitle('(Untitled)'), '(Untitled)');
});

test('a decorative festival subtitle is not a variant', () => {
  assert.equal(
    isVariantTitle('Kesariya (Tu Fuljhadiyo Wale Tyohaaro Jesi - Happy Diwali)', 'Kesariya'),
    false,
  );
  assert.equal(isVariantTitle('Kesariya (From "Brahmastra")', 'Kesariya'), false);
  assert.equal(isVariantTitle('Kesariya', 'Kesariya'), false);
});

test('edits and re-recordings are variants', () => {
  const rejected = [
    'Kesariya (Lofi Flip)',
    'Kesariya (Dance Mix)',
    'Kesariya (Slowed and Reverb)',
    'Kesariya (Instrumental)',
    'Kesariya (Female Version)',
    'Kesariya (Remix) (From "Brahmastra")',
  ];
  for (const title of rejected) assert.equal(isVariantTitle(title, 'Kesariya'), true, title);
});

test('a variant word outside brackets still counts', () => {
  assert.equal(isVariantTitle('Blinding Lights Nightcore', 'Blinding Lights'), true);
  assert.equal(isVariantTitle('shape of you (hyperpop edit)', 'Shape of You'), true);
});

test('a marker that belongs to the requested title does not count', () => {
  assert.equal(isVariantTitle('Piano Man', 'Piano Man'), false);
  assert.equal(isVariantTitle('Live Forever', 'Live Forever'), false);
});
