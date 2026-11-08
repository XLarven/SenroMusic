import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CloudDownload, PauseCircle, Play, RefreshCw, Trash2, WifiOff, X } from 'lucide-react';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { useMusicData } from '../MusicDataContext';
import { getStorageEstimate } from '../lib/localDownloads';
import { formatBytes, formatDuration } from '../lib/format';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import type { DownloadState, Track } from '../types';

const STATE_LABELS: Record<DownloadState, string> = {
  'not-downloaded': 'İndirilmedi',
  queued: 'Kuyrukta',
  downloading: 'İndiriliyor',
  paused: 'Duraklatıldı',
  downloaded: 'Bu cihazda indirildi',
  failed: 'Başarısız oldu',
  unavailable: 'Çevrimdışı kullanılamıyor',
};

function TrackCard({ track }: { track: Track }) {
  const record = useDownloads((state) => state.records[track.id]);
  const download = useDownloads((state) => state.download);
  const cancel = useDownloads((state) => state.cancel);
  const remove = useDownloads((state) => state.remove);
  const playTrack = usePlayer((state) => state.playTrack);
  const pushToast = useToastStore((state) => state.push);
  const state = record?.state ?? 'not-downloaded';

  const action = async () => {
    try {
      await download(track);
      if (state === 'failed' || state === 'unavailable') pushToast('İndirme yeniden başlatıldı.', 'success');
    } catch {
      pushToast('İndirme başlatılamadı.', 'error');
    }
  };

  return (
    <article className="download-row">
      <Cover src={track.coverUrl} alt="" seed={track.id} className="download-cover" />
      <div className="download-copy">
        <strong>{track.title}</strong>
        <span>{track.artist}{track.album ? ` · ${track.album}` : ''}</span>
        <small>{STATE_LABELS[state]}{record?.size ? ` · ${formatBytes(record.size)}` : ''}</small>
        {record?.error ? <em>{record.error}</em> : null}
        {(state === 'downloading' || state === 'queued') ? (
          <div className="download-progress" aria-label={`${STATE_LABELS[state]}: yüzde ${record?.progress ?? 0}`}>
            <span style={{ width: `${record?.progress ?? 0}%` }} />
          </div>
        ) : null}
      </div>
      <div className="download-actions">
        <button
          type="button"
          className="icon-button"
          onClick={() => playTrack(track)}
          aria-label={`${track.title} çal`}
          title="Çal"
        >
          <Play size={16} />
        </button>
        {(state === 'downloading' || state === 'queued') ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => cancel(track.id)}
            aria-label="İndirmeyi iptal et"
            title="İptal et"
          >
            <X size={16} />
          </button>
        ) : state === 'downloaded' ? (
          <>
            <span className="download-check" title="İndirildi"><CheckCircle2 size={17} /></span>
            <button
              type="button"
              className="icon-button"
              onClick={() => void remove(track.id)}
              aria-label="Yerel kopyayı kaldır"
              title="Yerel kopyayı kaldır"
            >
              <Trash2 size={16} />
            </button>
          </>
        ) : state === 'paused' || state === 'failed' || state === 'unavailable' ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => void action()}
            aria-label="Yeniden dene"
            title="Yeniden dene"
          >
            <RefreshCw size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-button"
            onClick={() => void action()}
            aria-label="Bu cihazda indir"
            title="Bu cihazda indir"
          >
            <CloudDownload size={16} />
          </button>
        )}
      </div>
    </article>
  );
}

export function DownloadsPage() {
  const { library } = useMusicData();
  const records = useDownloads((state) => state.records);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    void getStorageEstimate().then(setEstimate).catch(() => undefined);
  }, [records]);

  const downloadedTracks = useMemo(() => {
    const byId = new Map(library.tracks.map((track) => [track.id, track]));
    return Object.values(records)
      .filter((record) => record.state === 'downloaded')
      .map((record) => byId.get(record.trackId))
      .filter((track): track is Track => Boolean(track));
  }, [library.tracks, records]);

  const totalBytes = downloadedTracks.reduce((sum, track) => sum + (records[track.id]?.size ?? track.size), 0);
  const usage = estimate?.usage ?? totalBytes;

  return (
    <section className="page downloads-page" aria-labelledby="downloads-title">
      <header className="page-head">
        <div>
          <span className="eyebrow">Yerel indirmeler</span>
          <h1 id="downloads-title">Bu cihazda indirildi</h1>
          <p>İndirilen sesler bu cihaza kaydedilir; başka cihazlara aktarılmaz.</p>
        </div>
        <div className="storage-card" aria-label="Depolama kullanımı">
          <span><strong>{formatBytes(usage)}</strong> kullanılıyor</span>
          {estimate?.quota ? <small>{formatBytes(estimate.quota)} toplam</small> : <small>Tarayıcı kotası</small>}
        </div>
      </header>

      {downloadedTracks.length === 0 ? (
        <EmptyState
          icon={<WifiOff size={34} />}
          title="Henüz yerel indirme yok."
          description="Dinlediğin parçalar için indir düğmesini kullan. İnternet yokken yalnızca bu cihazda indirilenler çalınabilir."
          action={<a className="button primary" href="/search">Müzik ara</a>}
        />
      ) : (
        <div className="download-grid">
          {downloadedTracks.map((track) => (
            <TrackCard key={track.id} track={track} />
          ))}
        </div>
      )}

      <section className="panel storage-panel" aria-label="Depolama yönetimi">
        <div>
          <h2>Depolama yönetimi</h2>
          <p>Yerel kopyayı kaldırmak favorilerden veya çalma listelerinden çıkarmaz; yalnızca bu cihazın çevrimdışı dosyasını siler.</p>
          <small>{downloadedTracks.length} parça · {formatDuration(downloadedTracks.reduce((sum, track) => sum + track.duration, 0))}</small>
        </div>
      </section>
    </section>
  );
}
