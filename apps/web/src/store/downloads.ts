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
    if (existing && ['queued', 'downloading', 'downloaded'].includes(existing.state)) return;
    if (controllers.has(track.id)) return;

    const controller = new AbortController();
    controllers.set(track.id, controller);
    const record: DownloadRecord = {
      ...baseRecord(track),
      state: 'queued',
      progress: 0,
      error: null,
    };
    set((state) => ({ records: { ...state.records, [track.id]: record } }));
    await saveDownloadRecord(record).catch(() => undefined);

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

      const setRecord = (update: Partial<DownloadRecord>) => {
        const next = { ...record, ...update };
        set((state) => ({ records: { ...state.records, [track.id]: next } }));
        return saveDownloadRecord(next).catch(() => undefined);
      };

      await setRecord({ state: 'downloading', progress: 0, error: null });
      // `streamUrl` is a server path for local files and a provider reference
      // for remote ones; `mediaUrl` normalises both into a fetchable URL.
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
            chunks.push(value);
            received += value.byteLength;
            // Only report a percentage we can actually back with bytes; when the
            // provider hides the length the UI shows an indeterminate bar.
            const progress = expectedTotal > 0 ? Math.min(99, Math.floor((received / expectedTotal) * 100)) : 0;
            const stamp = Date.now();
            if (stamp - lastProgressUpdate > 200 && (progress !== record.progress || expectedTotal === 0)) {
              record.progress = progress;
              record.received = received;
              record.total = expectedTotal;
              // Keep the state explicit: this update is built from the record
              // captured at start, which still says "queued".
              record.state = 'downloading';
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
      await saveDownloadBlob(track.id, blob);
      await setRecord({
        state: 'downloaded',
        progress: 100,
        received: blob.size,
        total: blob.size,
        size: blob.size,
        downloadedAt: now(),
        error: null,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        await saveDownloadRecord({
          ...record,
          state: 'paused',
          error: null,
        }).catch(() => undefined);
        set((state) => ({
          records: {
            ...state.records,
            [track.id]: { ...record, state: 'paused', error: null },
          },
        }));
      } else {
        const message = error instanceof Error ? error.message : 'İndirme başarısız oldu.';
        await saveDownloadRecord({
          ...record,
          state: 'failed',
          error: message,
        }).catch(() => undefined);
        set((state) => ({
          records: {
            ...state.records,
            [track.id]: { ...record, state: 'failed', error: message },
          },
        }));
      }
    } finally {
      controllers.delete(track.id);
    }
  },

  cancel: (trackId) => {
    controllers.get(trackId)?.abort();
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
