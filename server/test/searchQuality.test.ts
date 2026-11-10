import assert from 'node:assert/strict';
import test from 'node:test';
import { isDisqualified, rankCandidates, relevanceScore, splitArtistTitle } from '../src/searchQuality.js';

type C = { id: string; title: string; uploader: string; duration: number | null };

const c = (id: string, title: string, uploader: string, duration: number | null = 200): C => ({
  id,
  title,
  uploader,
  duration,
});

test('disqualifies karaoke, instrumental, nightcore and loops', () => {
  assert.equal(isDisqualified(c('1', 'Linkin Park - Numb (Karaoke Version)', 'Sing King')), true);
  assert.equal(isDisqualified(c('2', 'Numb (Instrumental) - Linkin Park', 'Linkin Park')), true);
  assert.equal(isDisqualified(c('3', 'Numb (Nightcore)', 'x')), true);
  assert.equal(isDisqualified(c('4', 'Blinding Lights (slowed/reverbed)', 'ramona')), true);
  assert.equal(isDisqualified(c('5', 'Numb 10 hours loop', 'x')), true);
  assert.equal(isDisqualified(c('6', 'Numb', 'x', 25 * 60)), true);
});

test('keeps the studio upload', () => {
  assert.equal(isDisqualified(c('1', 'Numb (Official Music Video) – Linkin Park', 'Linkin Park')), false);
  assert.equal(isDisqualified(c('2', 'Linkin Park - Numb (Audio)', 'Linkin Park')), false);
});

test('ranks the official recording above a cover', () => {
  const ranked = rankCandidates(
    [
      c('cover', 'Bohemian Rhapsody', 'The Braids - Topic', 239),
      c('official', 'Queen – Bohemian Rhapsody (Official Video Remastered)', 'Queen Official', 360),
      c('live', 'Bohemian Rhapsody - Queen Live In Wembley Stadium', 'Alex', 359),
    ],
    'bohemian rhapsody queen',
    5,
  );
  assert.equal(ranked[0]?.id, 'official');
});

test('ranks the exact song above an encore medley', () => {
  const ranked = rankCandidates(
    [
      c('encore', 'Numb / Encore (Official Audio) - Linkin Park / JAY-Z', 'Linkin Park', 207),
      c('numb', 'Numb (Official Music Video) – Linkin Park', 'Linkin Park', 188),
    ],
    'numb linkin park',
    5,
  );
  assert.equal(ranked[0]?.id, 'numb');
});

test('single-token queries stay permissive', () => {
  const ranked = rankCandidates([c('a', 'Numb', 'Linkin Park', 188)], 'numb', 5);
  assert.equal(ranked.length, 1);
});

test('relevance prefers full token coverage', () => {
  const full = relevanceScore(c('a', 'The Weeknd - Blinding Lights (Official Audio)', 'The Weeknd'), 'blinding lights');
  const partial = relevanceScore(c('b', 'Blinding Lights Cover', 'Someone'), 'the weeknd blinding lights');
  assert.ok(full > partial);
});

test('splits artist and title on a dash', () => {
  assert.deepEqual(splitArtistTitle('Queen - Bohemian Rhapsody'), {
    artist: 'Queen',
    title: 'Bohemian Rhapsody',
  });
});

test('never returns an empty page when everything is filtered', () => {
  const ranked = rankCandidates([c('k', 'Numb (Karaoke)', 'X')], 'numb', 5);
  assert.equal(ranked.length, 1);
});
