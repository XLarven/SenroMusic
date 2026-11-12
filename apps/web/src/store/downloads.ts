import { create } from 'zustand';
import { getServerUrl } from '../lib/serverUrl';
import { mediaUrl } from '../lib/media';
import {
  deleteDownloadBlob,
  deleteDownloadRecord,
  getStorageEstimate,
  loadDownloadBlob,
  loadDownloadRecords,
  requestPersistentStorage,
  saveDownloadBlob,
  saveDownloadRecord,
} from '../lib/localDownloads';
import type { DownloadRecord, Track } from '../types';

const controllers = new Map<string, AbortController>();
const objectUrls = new Map<string, string>();
/** FIFO download queue: one track at a time, in the order the user asked. */
const queue: string[] = [];
const tracksById = new Map<string, Track>();
const canceled = new Set<string>();
let activeId: string | null = null;
const STALL_TIMEOUT_MS = 45_000;

function now(): string {
  return new Date().toISOString();
}

function baseRecord(track: Track): DownloadRecord {
  return {
    trackId: track.id,
    state: 'not-downloaded',
    progress: 0,
    size: track.size,
    downloadedAt: null,
    error: null,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverUrl: track.coverUrl,
    duration: track.duration,
  };
}

type DownloadsState = {
  records: Record<string, DownloadRecord>;
  initialized: boolean;
  init: () => Promise<void>;
  getState: (trackId: string) => DownloadRecord | undefined;
  download: (track: Track) => Promise<void>;
  cancel: (trackId: string) => void;
  remove: (trackId: string) => Promise<void>;
  resolveSource: (track: Track) => Promise<string>;
  validateTracks: (tracks: Track[]) => Promise<void>;
};

export const useDownloads = create<DownloadsState>((set, get) => ({
  records: {},
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    try {
      const stored = await loadDownloadRecords();
      const records: Record<string, DownloadRecord> = {};
      for (const record of stored) {
        if (record.state === 'downloading' || record.state === 'queued') {
          records[record.trackId] = { ...record, state: 'paused', error: 'İndirme yarım kaldı.' };
        } else {
          records[record.trackId] = record;
        }
      }
      for (const record of Object.values(records)) {
        if (record.state === 'downloaded') {
          const blob = await loadDownloadBlob(record.trackId).catch(() => null);
          if (!blob) {
            records[record.trackId] = {
              ...record,
              state: 'unavailable',
              error: 'Yerel dosya bulunamadı. Yeniden indirmeyi dene.',
            };
          }
        }
      }
      set({ records, initialized: true });
      await Promise.all(Object.values(records).map((record) => saveDownloadRecord(record).catch(() => undefined)));
    } catch {
      set({ initialized: true });
    }
  },

  getState: (trackId) => get().records[trackId],

  download: async (track) => {
    const existing = get().records[track.id];
    if (existing && ['queued', 'downloading', 'verifying', 'downloaded'].includes(existing.state)) return;
    if (queue.includes(track.id) || activeId === track.id) return;

    // One worker, strict FIFO: the track only starts when everything queued
    // before it has finished (or failed).
    tracksById.set(track.id, track);
    queue.push(track.id);
    const record: DownloadRecord = {
      ...baseRecord(track),
      state: 'queued',
      progress: 0,
      error: null,
    };
    set((state) => ({ records: { ...state.records, [track.id]: record } }));
    await saveDownloadRecord(record).catch(() => undefined);
    void pump();
  },

  cancel: (trackId) => {
    // A queued item leaves the queue immediately; an active one aborts and is
    // parked as paused so it can be resumed later.
    const index = queue.indexOf(trackId);
    if (index >= 0) {
      queue.splice(index, 1);
      const record = get().records[trackId];
      if (record) {
        const next = { ...record, state: 'paused' as const, error: null };
        set((state) => ({ records: { ...state.records, [trackId]: next } }));
        void saveDownloadRecord(next).catch(() => undefined);
      }
      return;
    }
    const controller = controllers.get(trackId);
    if (controller) {
      canceled.add(trackId);
      controller.abort();
    }
  },

  remove: async (trackId) => {
    controllers.get(trackId)?.abort();
    const objectUrl = objectUrls.get(trackId);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(trackId);
    }
    await deleteDownloadBlob(trackId).catch(() => undefined);
    await deleteDownloadRecord(trackId).catch(() => undefined);
    set((state) => {
      const records = { ...state.records };
      delete records[trackId];
      return { records };
    });
  },

  resolveSource: async (track) => {
    const state = get().records[track.id];
    if (state?.state !== 'downloaded') return mediaUrl(track);
    const cached = objectUrls.get(track.id);
    if (cached) return cached;
    const blob = await loadDownloadBlob(track.id).catch(() => null);
    if (!blob) {
      set((current) => ({
        records: {
          ...current.records,
          [track.id]: {
            ...state,
            state: 'unavailable',
            error: 'Yerel dosya bulunamadı. Yeniden indirmeyi dene.',
          },
        },
      }));
      return mediaUrl(track);
    }
    const url = URL.createObjectURL(blob);
    objectUrls.set(track.id, url);
    return url;
  },

  validateTracks: async (tracks) => {
    for (const track of tracks) {
      const state = get().records[track.id];
      if (state?.state !== 'downloaded') continue;
      const blob = await loadDownloadBlob(track.id).catch(() => null);
      if (!blob) {
        set((current) => ({
          records: {
            ...current.records,
            [track.id]: {
              ...state,
              state: 'unavailable',
              error: 'Yerel dosya bulunamadı. Yeniden indirmeyi dene.',
            },
          },
        }));
      }
    }
  },
}));

/** Runs one download to completion. Called only by the FIFO pump. */
async function runDownload(track: Track): Promise<void> {
  const set = useDownloads.setState;
  const get = useDownloads.getState;
  const controller = new AbortController();
  controllers.set(track.id, controller);
  canceled.delete(track.id);
  const base = get().records[track.id] ?? baseRecord(track);
  const setRecord = (update: Partial<DownloadRecord>) => {
    const next = { ...base, ...update };
    set((state) => ({ records: { ...state.records, [track.id]: next } }));
    return saveDownloadRecord(next).catch(() => undefined);
  };

  // A stalled socket must not freeze the queue: if no bytes arrive for 45s the
  // request is aborted and the next track gets its turn.
  let lastChunk = Date.now();
  let stalled = false;
  const watchdog = window.setInterval(() => {
    if (Date.now() - lastChunk > STALL_TIMEOUT_MS) {
      stalled = true;
      controller.abort();
    }
  }, 5_000);

  try {
    const connection = navigator as Navigator & { connection?: { type?: string } };
    if (localStorage.getItem('Norie.wifiOnly') === 'true' && connection.connection?.type === 'cellular') {
      throw new Error('Yalnızca Wi-Fi indirme açık. Wi-Fi bağlantısına geç.');
    }
    await requestPersistentStorage();
    const estimate = await getStorageEstimate();
    if (estimate && estimate.quota > 0 && estimate.usage + track.size > estimate.quota) {
      throw new Error('Cihaz depolama alanı dolu. Bazı indirilen dosyaları sil.');
    }

    await setRecord({ state: 'downloading', progress: 0, received: 0, error: null });

    const response = await fetch(`${getServerUrl()}${mediaUrl(track)}`, {
      credentials: 'include',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Sunucu ${response.status} yanıtı döndü.`);

    const chunks: BlobPart[] = [];
    let received = 0;
    let lastProgressUpdate = 0;
    const declaredTotal = Number(response.headers.get('content-length') || 0);
    const expectedTotal = declaredTotal > 0 ? declaredTotal : track.size > 0 ? track.size : 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          lastChunk = Date.now();
          chunks.push(value);
          received += value.byteLength;
          const progress = expectedTotal > 0 ? Math.min(99, Math.floor((received / expectedTotal) * 100)) : 0;
          const stamp = Date.now();
          if (stamp - lastProgressUpdate > 200) {
            lastProgressUpdate = stamp;
            void setRecord({ state: 'downloading', progress, received, total: expectedTotal });
          }
        }
      }
    } else {
      chunks.push(await response.arrayBuffer());
    }

    const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });
    if (blob.size === 0) throw new Error('Boş bir dosya alındı.');

    // Verify step: the bytes go to IndexedDB first, then are read back and
    // compared before the UI is allowed to claim "downloaded".
    await setRecord({ state: 'verifying', progress: 100, received: blob.size, total: blob.size });
    await saveDownloadBlob(track.id, blob);
    const verified = await loadDownloadBlob(track.id).catch(() => null);
    if (!verified || verified.size === 0 || verified.size !== blob.size) {
      await deleteDownloadBlob(track.id).catch(() => undefined);
      throw new Error('İndirilen dosya doğrulanamadı. Yeniden dene.');
    }

    await setRecord({
      state: 'downloaded',
      progress: 100,
      received: verified.size,
      total: verified.size,
      size: verified.size,
      downloadedAt: now(),
      error: null,
    });
  } catch (error) {
    if (controller.signal.aborted && canceled.has(track.id)) {
      await setRecord({ state: 'paused', error: null });
    } else if (stalled) {
      await setRecord({ state: 'failed', error: 'İndirme zaman aşımına uğradı. Yeniden dene.' });
    } else if (error instanceof DOMException && error.name === 'AbortError') {
      await setRecord({ state: 'paused', error: null });
    } else {
      const message = error instanceof Error ? error.message : 'İndirme başarısız oldu.';
      await setRecord({ state: 'failed', error: message });
    }
  } finally {
    window.clearInterval(watchdog);
    controllers.delete(track.id);
  }
}

/** Starts the next queued download when the worker is free. */
async function pump(): Promise<void> {
  if (activeId) return;
  const next = queue.shift();
  if (!next) return;
  activeId = next;
  const track = tracksById.get(next);
  try {
    if (track) await runDownload(track);
  } finally {
    activeId = null;
    tracksById.delete(next);
    void pump();
  }
}
