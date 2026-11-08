import { useMemo, useState } from 'react';
import { CloudDownload, ListMusic, Play, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Cover } from './Cover';
import { PlayButton } from './PlayButton';
import { DownloadButton } from './DownloadButton';
import { formatBytes, formatDuration } from '../lib/format';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import type { PlaylistSummary, Track } from '../types';

export type PreviewItem = {
  providerTrackId: string | null;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  artworkUrl: string | null;
  sourceUrl: string | null;
  matchedTrack: Track | null;
};

export type PlaylistPreview = {
  provider: 'spotify' | 'youtube' | 'youtube-music' | 'norie';
  title: string;
  description: string | null;
  artworkUrl: string | null;
  creator: string | null;
  totalDuration: number | null;
  sourceUrl: string;
  sourcePlaylistId: string | null;
  items: PreviewItem[];
};

const PROVIDER_LABELS: Record<PlaylistPreview['provider'], string> = {
  spotify: 'Spotify',
  youtube: 'YouTube',
  'youtube-music': 'YouTube Music',
  norie: 'NorieMusic',
};

export function ImportPreviewPanel({
  preview,
  playlists,
  onImport,
  onDownloadAll,
}: {
  preview: PlaylistPreview;
  playlists: PlaylistSummary[];
  onImport: (selectedIndexes: number[], existingPlaylistId?: string) => Promise<void>;
  onDownloadAll: () => void;
}) {
  const playQueue = usePlayer((state) => state.playQueue);
  const records = useDownloads((state) => state.records);
  const pushToast = useToastStore((state) => state.push);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(preview.items.map((_, index) => index)),
  );
  const [existingPlaylistId, setExistingPlaylistId] = useState('');
  const [importing, setImporting] = useState(false);

  const matchedTracks = useMemo(
    () =>
      preview.items
        .map((item) => item.matchedTrack)
        .filter((track): track is Track => Boolean(track)),
    [preview.items],
  );
  const unavailableCount = preview.items.length - matchedTracks.length;
  const eligibleToDownload = useMemo(
    () => matchedTracks.filter((track) => records[track.id]?.state !== 'downloaded'),
    [matchedTracks, records],
  );
  const eligibleBytes = eligibleToDownload.reduce((sum, track) => sum + track.size, 0);
  const selectedItems = useMemo(
    () => preview.items.filter((_, index) => selected.has(index)),
    [preview.items, selected],
  );
  const totalDuration = preview.totalDuration ?? preview.items.reduce((sum, item) => sum + (item.duration ?? 0), 0);

  const toggle = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const importSelected = async () => {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    try {
      await onImport([...selected].sort((a, b) => a - b), existingPlaylistId || undefined);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'İçe aktarma başarısız.', 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="content-section import-preview-page" aria-label="Çalma listesi önizlemesi">
      <header className="detail-hero">
        <Cover src={preview.artworkUrl} alt="" seed={preview.title} className="detail-cover" iconSize={40} />
        <div className="detail-copy">
          <span className="eyebrow">Çalma listesi önizlemesi · {PROVIDER_LABELS[preview.provider]}</span>
          <h1>{preview.title}</h1>
          {preview.description ? <p className="detail-description">{preview.description}</p> : null}
          <div className="detail-meta">
            <span>{preview.items.length} parça</span>
            {totalDuration ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatDuration(totalDuration)}</span>
              </>
            ) : null}
            {preview.creator ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{preview.creator}</span>
              </>
            ) : null}
          </div>
          <div className="import-status-row" aria-label="Parça durumu özeti">
            <span className="status-pill"><ShieldCheck size={13} /> {matchedTracks.length} çalınabilir</span>
            {unavailableCount ? (
              <span className="status-pill is-warning"><TriangleAlert size={13} /> {unavailableCount} kullanılamıyor</span>
            ) : null}
            <span className="status-pill"><ListMusic size={13} /> {preview.items.length} referans korundu</span>
          </div>
          <div className="detail-actions">
            <button type="button" className="button primary" onClick={() => playQueue(matchedTracks)} disabled={matchedTracks.length === 0}>
              <Play size={16} fill="currentColor" /> Çal
            </button>
            <button type="button" className="button secondary" onClick={importSelected} disabled={importing || selected.size === 0}>
              {importing ? 'İçe aktarılıyor…' : existingPlaylistId ? 'Mevcut listeye ekle' : 'Kütüphaneye aktar'}
            </button>
            <button type="button" className="button ghost" onClick={onDownloadAll} disabled={matchedTracks.length === 0}>
              <CloudDownload size={16} /> Tümünü indir
            </button>
            <label className="import-existing">
              <span>Mevcut liste</span>
              <select value={existingPlaylistId} onChange={(event) => setExistingPlaylistId(event.target.value)}>
                <option value="">Yeni liste oluştur</option>
                {playlists.filter((playlist) => playlist.isOwner).map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="settings-hint">
            {matchedTracks.length > 0
              ? `${eligibleToDownload.length} parça bu cihazda indirilebilir · tahmini ${formatBytes(eligibleBytes)}.`
              : 'Bu cihazdan çalınabilir parça yok; tüm referanslar korunacak.'}
            {' '}İçe aktarma ve çalma işlemleri ses dosyası indirmez.
          </p>
        </div>
      </header>

      <div className="section-heading">
        <div>
          <h2>Parçalar</h2>
          <p>İçe aktarmadan önce incele. {selectedItems.length}/{preview.items.length} seçili.</p>
        </div>
        <div className="filter-pills" role="group" aria-label="Seçim">
          <button type="button" className="filter-pill" onClick={() => setSelected(new Set(preview.items.map((_, index) => index)))}>Tümünü seç</button>
          <button type="button" className="filter-pill" onClick={() => setSelected(new Set())}>Seçimi temizle</button>
        </div>
      </div>

      <div className="surface-panel import-track-list">
        {preview.items.map((item, index) => {
          const checked = selected.has(index);
          return (
            <article className={`import-track-row ${item.matchedTrack ? 'is-playable' : 'is-unavailable'}`} key={`${item.providerTrackId ?? index}-${index}`}>
              <label className="import-check">
                <input type="checkbox" checked={checked} onChange={() => toggle(index)} aria-label={`${item.title} seç`} />
              </label>
              <Cover src={item.artworkUrl ?? item.matchedTrack?.coverUrl ?? null} alt="" seed={`${item.title}-${item.artist}`} className="import-cover" iconSize={16} />
              <div className="import-copy">
                <strong>{item.title}</strong>
                <span>{item.artist}{item.album ? ` · ${item.album}` : ''}</span>
                <small>
                  {item.matchedTrack ? 'Çalınabilir' : 'Kullanılamıyor'}
                  {item.duration ? ` · ${formatDuration(item.duration)}` : ''}
                </small>
              </div>
              {item.matchedTrack ? (
                <>
                  <PlayButton tracks={[item.matchedTrack]} size="sm" label={`${item.title} çal`} />
                  <DownloadButton track={item.matchedTrack} />
                </>
              ) : (
                <span className="import-unavailable" title="Bu parça henüz çözülemedi">
                  <TriangleAlert size={16} />
                </span>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
