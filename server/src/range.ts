export type ByteRange = { start: number; end: number };

export type RangeParseResult =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'range'; range: ByteRange };

export function parseRange(header: string | undefined, size: number): RangeParseResult {
  if (!header) return { kind: 'none' };
  if (size <= 0) return { kind: 'invalid' };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: 'invalid' };
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return { kind: 'invalid' };

  if (!startRaw) {
    const suffix = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'invalid' };
    return { kind: 'range', range: { start: Math.max(0, size - suffix), end: size - 1 } };
  }

  const start = Number.parseInt(startRaw, 10);
  const end = endRaw ? Number.parseInt(endRaw, 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end < start) {
    return { kind: 'invalid' };
  }
  return { kind: 'range', range: { start, end: Math.min(end, size - 1) } };
}
