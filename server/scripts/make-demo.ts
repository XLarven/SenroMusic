import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../src/config.js';

const SAMPLE_RATE = 22_050;
const CHANNELS = 2;

type Chord = { notes: number[]; root: number };
type Album = {
  artist: string;
  name: string;
  colors: [string, string, string];
  bpm: number;
  progression: Chord[];
  scale: number[];
  genre: string;
  year: number;
};

type DemoTrack = {
  album: Album;
  title: string;
  seconds: number;
  seed: number;
};

const ALBUMS: Album[] = [
  {
    artist: 'Nova Lane',
    name: 'Neon Nights',
    colors: ['#ff6b4a', '#8b5cf6', '#14121f'],
    bpm: 92,
    genre: 'Synthwave',
    year: 2024,
    progression: [
      { notes: [57, 60, 64], root: 45 },
      { notes: [53, 57, 60], root: 41 },
      { notes: [48, 52, 55], root: 36 },
      { notes: [55, 59, 62], root: 43 },
    ],
    scale: [57, 60, 62, 64, 67, 69, 72],
  },
  {
    artist: 'Kite & Echo',
    name: 'Paper Skies',
    colors: ['#5eead4', '#60a5fa', '#0f172a'],
    bpm: 84,
    genre: 'Chillout',
    year: 2023,
    progression: [
      { notes: [50, 53, 57], root: 38 },
      { notes: [46, 50, 53], root: 34 },
      { notes: [41, 45, 48], root: 29 },
      { notes: [48, 52, 55], root: 36 },
    ],
    scale: [50, 53, 55, 57, 60, 62, 65],
  },
  {
    artist: 'Mira Sol',
    name: 'Golden Hour',
    colors: ['#fbbf24', '#fb7185', '#1c1917'],
    bpm: 76,
    genre: 'Downtempo',
    year: 2025,
    progression: [
      { notes: [48, 52, 55], root: 36 },
      { notes: [55, 59, 62], root: 43 },
      { notes: [57, 60, 64], root: 45 },
      { notes: [53, 57, 60], root: 41 },
    ],
    scale: [48, 50, 52, 55, 57, 60, 62],
  },
];

const TRACKS: Array<{ album: number; title: string; seconds: number; seed: number }> = [
  { album: 0, title: 'Midnight Drive', seconds: 28, seed: 11 },
  { album: 0, title: 'Afterglow', seconds: 25, seed: 23 },
  { album: 0, title: 'City Lights', seconds: 27, seed: 37 },
  { album: 1, title: 'Paper Skies', seconds: 30, seed: 41 },
  { album: 1, title: 'Slow Motion', seconds: 26, seed: 53 },
  { album: 1, title: 'Cloudline', seconds: 24, seed: 67 },
  { album: 2, title: 'Golden Hour', seconds: 28, seed: 71 },
  { album: 2, title: 'Saltwater', seconds: 26, seed: 83 },
  { album: 2, title: 'Last Light', seconds: 30, seed: 97 },
];

function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function softClip(value: number): number {
  return Math.tanh(value * 1.2) * 0.85;
}

function addTone(
  left: Float32Array,
  right: Float32Array,
  startSec: number,
  durationSec: number,
  frequency: number,
  amplitude: number,
  pan: number,
  timbre: 'pad' | 'pluck' | 'bass' | 'lead',
): void {
  const start = Math.max(0, Math.floor(startSec * SAMPLE_RATE));
  const length = Math.min(left.length - start, Math.floor(durationSec * SAMPLE_RATE));
  if (length <= 0) return;
  const leftGain = Math.cos(((pan + 1) / 2) * Math.PI * 0.5);
  const rightGain = Math.sin(((pan + 1) / 2) * Math.PI * 0.5);
  const attack = timbre === 'pad' ? 0.35 : timbre === 'bass' ? 0.02 : 0.008;
  const release = timbre === 'pad' ? 0.6 : timbre === 'bass' ? 0.12 : 0.35;

  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const remaining = (length - index) / SAMPLE_RATE;
    const env =
      Math.min(1, t / attack) *
      Math.min(1, remaining / release) *
      Math.exp(-t * (timbre === 'pluck' ? 1.8 : timbre === 'bass' ? 0.9 : 0.15));

    const phase = 2 * Math.PI * frequency * t;
    let sample = 0;
    if (timbre === 'pad') {
      sample =
        Math.sin(phase) * 0.55 +
        Math.sin(phase * 1.003) * 0.2 +
        Math.sin(phase * 2) * 0.12 +
        Math.sin(phase * 3) * 0.05;
    } else if (timbre === 'pluck') {
      sample =
        Math.sin(phase) * 0.55 +
        Math.sin(phase * 2) * 0.22 +
        Math.sin(phase * 3) * 0.1;
    } else if (timbre === 'bass') {
      sample = Math.sin(phase) * 0.8 + Math.sin(phase * 2) * 0.14;
    } else {
      const vibrato = Math.sin(2 * Math.PI * 4.8 * t) * 0.004;
      sample =
        Math.sin(phase + vibrato) * 0.62 +
        Math.sin(phase * 2 + vibrato) * 0.18 +
        Math.sin(phase * 3) * 0.06;
    }

    const value = sample * env * amplitude;
    left[start + index] += value * leftGain;
    right[start + index] += value * rightGain;
  }
}

function addKick(left: Float32Array, right: Float32Array, startSec: number, amplitude: number): void {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const length = Math.min(left.length - start, Math.floor(0.26 * SAMPLE_RATE));
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const frequency = 56 + 48 * Math.exp(-t * 26);
    const env = Math.exp(-t * 15);
    const value = Math.sin(2 * Math.PI * frequency * t) * env * amplitude;
    left[start + index] += value;
    right[start + index] += value;
  }
}

function addHat(left: Float32Array, right: Float32Array, startSec: number, rand: () => number): void {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const length = Math.min(left.length - start, Math.floor(0.055 * SAMPLE_RATE));
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const env = Math.exp(-t * 70);
    const value = (rand() * 2 - 1) * env * 0.035;
    left[start + index] += value * 0.8;
    right[start + index] += value;
  }
}

function renderTrack(track: DemoTrack): Buffer {
  const frames = Math.floor(track.seconds * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const rand = mulberry32(track.seed);
  const beat = 60 / track.album.bpm;
  const bar = beat * 4;
  const chordBars = 2;

  for (let barIndex = 0; barIndex * bar < track.seconds; barIndex += 1) {
    const chord = track.album.progression[Math.floor(barIndex / chordBars) % track.album.progression.length];
    const barStart = barIndex * bar;

    for (const note of chord.notes) {
      addTone(left, right, barStart, bar * chordBars * 0.96, midiToHz(note), 0.075, -0.25, 'pad');
      addTone(left, right, barStart, bar * chordBars * 0.96, midiToHz(note + 12), 0.022, 0.35, 'pad');
    }

    addTone(left, right, barStart, bar * 0.92, midiToHz(chord.root - 12), 0.2, 0, 'bass');
    addTone(left, right, barStart + beat * 2, bar * 0.42, midiToHz(chord.root - 12), 0.16, 0, 'bass');

    const arpPattern = [0, 1, 2, 1, 0, 2, 1, 2];
    for (let step = 0; step < 8; step += 1) {
      const note = chord.notes[arpPattern[step] % chord.notes.length] + 12;
      const pan = step % 2 === 0 ? -0.45 : 0.45;
      addTone(left, right, barStart + step * (beat / 2), beat * 0.44, midiToHz(note), 0.055, pan, 'pluck');
    }

    for (let step = 0; step < 4; step += 1) {
      addKick(left, right, barStart + step * beat, step === 0 ? 0.3 : 0.2);
      addHat(left, right, barStart + step * beat + beat / 2, rand);
    }

    if (barIndex >= 4 && barIndex % 2 === 0) {
      const melodyLength = Math.floor(rand() * 2) + 1;
      for (let noteIndex = 0; noteIndex < melodyLength; noteIndex += 1) {
        const note = track.album.scale[Math.floor(rand() * track.album.scale.length)] + 12;
        addTone(
          left,
          right,
          barStart + noteIndex * beat * 1.5,
          beat * 1.35,
          midiToHz(note),
          0.085,
          0.1,
          'lead',
        );
      }
    }
  }

  let peak = 0;
  for (let index = 0; index < frames; index += 1) {
    const fadeIn = Math.min(1, index / (SAMPLE_RATE * 1.2));
    const fadeOut = Math.min(1, (frames - index) / (SAMPLE_RATE * 3));
    const gain = fadeIn * fadeOut;
    left[index] = softClip(left[index] * gain);
    right[index] = softClip(right[index] * gain);
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
  }
  const scale = peak > 0 ? 0.88 / peak : 1;

  const dataSize = frames * CHANNELS * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28);
  buffer.writeUInt16LE(CHANNELS * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let index = 0; index < frames; index += 1) {
    const l = Math.max(-1, Math.min(1, left[index] * scale));
    const r = Math.max(-1, Math.min(1, right[index] * scale));
    buffer.writeInt16LE(Math.round(l * 32767), offset);
    buffer.writeInt16LE(Math.round(r * 32767), offset + 2);
    offset += 4;
  }
  return buffer;
}

function coverSvg(album: Album): string {
  const [a, b, dark] = album.colors;
  const safeTitle = album.name.replace(/[<>&]/g, '');
  const safeArtist = album.artist.replace(/[<>&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/>
      <stop offset="0.55" stop-color="${b}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    <radialGradient id="r" cx="30%" cy="25%" r="80%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="900" height="900" fill="url(#g)"/>
  <rect width="900" height="900" fill="url(#r)"/>
  <circle cx="690" cy="210" r="230" fill="#ffffff" fill-opacity="0.08"/>
  <circle cx="210" cy="720" r="300" fill="#000000" fill-opacity="0.18"/>
  <path d="M120 640 C 280 420, 430 780, 780 480" stroke="#ffffff" stroke-opacity="0.28" stroke-width="3" fill="none"/>
  <text x="72" y="700" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="42" letter-spacing="6" opacity="0.75">${safeArtist.toUpperCase()}</text>
  <text x="68" y="790" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="76" font-weight="700">${safeTitle}</text>
  <text x="72" y="840" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="24" letter-spacing="4" opacity="0.55">SENRO DEMO SESSIONS</text>
</svg>`;
}

function syncsafeSize(size: number): Buffer {
  return Buffer.from([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
}

function id3Frame(id: string, value: string): Buffer {
  const body = Buffer.concat([Buffer.from([0x03]), Buffer.from(value, 'utf8')]);
  const header = Buffer.alloc(10);
  header.write(id, 0, 'ascii');
  const size = body.length;
  header[4] = (size >> 21) & 0x7f;
  header[5] = (size >> 14) & 0x7f;
  header[6] = (size >> 7) & 0x7f;
  header[7] = size & 0x7f;
  header.writeUInt16BE(0, 8);
  return Buffer.concat([header, body]);
}

function buildId3Tag(tags: Record<string, string>): Buffer {
  const frames = Object.entries(tags).map(([id, value]) => id3Frame(id, value));
  const body = Buffer.concat(frames);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'ascii');
  header[3] = 4;
  header[4] = 0;
  header[5] = 0;
  const size = body.length;
  header[6] = (size >> 21) & 0x7f;
  header[7] = (size >> 14) & 0x7f;
  header[8] = (size >> 7) & 0x7f;
  header[9] = size & 0x7f;
  return Buffer.concat([header, body]);
}

function tagWav(wav: Buffer, album: Album, title: string, trackIndex: number, trackTotal: number): Buffer {
  const tag = buildId3Tag({
    TIT2: title,
    TPE1: album.artist,
    TPE2: album.artist,
    TALB: album.name,
    TCON: album.genre,
    TDRC: String(album.year),
    TRCK: `${trackIndex}/${trackTotal}`,
    TPOS: '1',
  });
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write('id3 ', 0, 'ascii');
  chunkHeader.writeUInt32LE(tag.length, 4);
  const padding = tag.length % 2 === 0 ? Buffer.alloc(0) : Buffer.alloc(1);
  const output = Buffer.concat([wav, chunkHeader, tag, padding]);
  output.writeUInt32LE(output.length - 8, 4);
  return output;
}

async function main(): Promise<void> {
  const targetArg = process.argv[2];
  const target = targetArg ? resolve(targetArg) : config.musicDir;
  if (!existsSync(target)) await mkdir(target, { recursive: true });
  console.log(`Generating demo library in ${target}`);

  for (const [index, item] of TRACKS.entries()) {
    const album = ALBUMS[item.album];
    const albumDir = resolve(target, album.artist, album.name);
    await mkdir(albumDir, { recursive: true });
    const albumTracks = TRACKS.filter((entry) => entry.album === item.album);
    const trackIndex = albumTracks.indexOf(item) + 1;
    const trackNo = String(trackIndex).padStart(2, '0');
    const fileName = `${trackNo} - ${item.title}.wav`;
    const filePath = resolve(albumDir, fileName);
    const buffer = renderTrack({ album, title: item.title, seconds: item.seconds, seed: item.seed });
    const tagged = tagWav(buffer, album, item.title, trackIndex, albumTracks.length);
    await writeFile(filePath, tagged);
    await writeFile(resolve(albumDir, 'cover.svg'), coverSvg(album), 'utf8');
    console.log(`  ${index + 1}/${TRACKS.length} ${album.artist} — ${item.title} (${item.seconds}s)`);
  }

  await writeFile(
    resolve(target, 'README.txt'),
    [
      'SenroMusic demo library',
      '',
      'These files are synthesized locally for development and contain no third-party recordings.',
      'Delete this folder or point MUSIC_DIR at your own licensed music library.',
      '',
    ].join('\n'),
    'utf8',
  );
  console.log('Demo library ready. Start the server with: pnpm dev');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
