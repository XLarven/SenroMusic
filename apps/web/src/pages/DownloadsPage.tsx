import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CloudDownload,
  HardDriveDownload,
  PauseCircle,
  Play,
  RefreshCw,
  Trash2,
  TriangleAlert,
  WifiOff,
  X,
} from 'lucide-react';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { useMusicData } from '../MusicDataContext';
import { getStorageEstimate, loadDownloadBlob } from '../lib/localDownloads';
import { formatBytes, formatDuration } from '../lib/format';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import type { DownloadRecord, Track } from '../types';

const STATE_LABEL: Record<string, string> = {
  'not-downloaded': 'İndirilmedi',
  queued: 'Sırada',
  downloading: 'İndiriliyor',
  paused: 'Duraklatıldı',
  downloaded: 'Bu cihazda',
  failed: 'Başarısız',
  unavailable: 'Dosya bulunamadı',
};

/** A record can outlive its library entry (imported Spotify/YouTube tracks). */
function trackFromRecord(record: DownloadRecord): Track {
  return {
    id: record.trackId,
    title: record.title,
    artist: record.artist,
    album: record.album,
    albumArtist: record.artist,
    genre: null,
    year: null,
    trackNo: null,
    discNo: null,
    duration: record.duration,
    bitrate: null,
    sampleRate: null,
    channels: null,
    format: 'download',
    size: record.size,
    coverUrl: record.coverUrl,
    streamUrl: '',
    addedAt: record.downloadedAt ?? new Date(0).toISOString(),
  };
}

function ProgressBar({ record }: { record: DownloadRecord }) {
  const hasTotal = Boolean(record.total && record.total > 0);
  const percent = hasTotal ? Math.min(100, Math.max(0, record.progress)) : null;
  return (
    <div className="download-progress-wrap">
      <div
        className={`download-progress ${percent === null ? 'is-indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-label={percent === null ? 'İndiriliyor' : `İndiriliyor: yüzde ${percent}`}
      >
        <span style={{ width: percent === null ? '40%' : `${percent}%` }} />
      </div>
      <small className="download-percent">
        {percent === null
          ? `${formatBytes(record.received ?? 0)}`
          : `%${percent}${record.received ? ` · ${formatBytes(record.received)} / ${formatBytes(record.total ?? 0)}` : ''}`}
      </small>
    </div>
  );
}

function DownloadRow({ record }: { record: DownloadRecord }) {
  const download = useDownloads((state) => state.download);
  const cancel = useDownloads((state) => state.cancel);
  const remove = useDownloads((state) => state.remove);
  const playTrack = usePlayer((state) => state.playTrack);
  const pushToast = useToastStore((state) => state.push);
  const track = useMemo(() => trackFromRecord(record), [record]);
  const active = record.state === 'downloading' || record.state === 'queued';
  const retryable = record.state === 'paused' || record.state === 'failed' || record.state === 'unavailable';

  const saveToDevice = async () => {
    try {
      const blob = await loadDownloadBlob(record.trackId);
      if (!blob) {
        pushToast('Yerel dosya bulunamadı.', 'error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${record.artist} - ${record.title}`.replace(/[\\/:*?"<>|]/g, '_') + '.m4a';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      pushToast('Dosya cihazına kaydedildi.', 'success');
    } catch {
      pushToast('Dosya kaydedilemedi.', 'error');
    }
  };

  return (
    <article className="download-row">
      <Cover src={record.coverUrl} alt="" seed={record.trackId} className="download-cover" />
      <div className="download-copy">
        <strong>{record.title}</strong>
        <span>{record.artist}</span>
        <small>
          {STATE_LABEL[record.state] ?? record.state}
          {record.size ? ` · ${formatBytes(record.size)}` : ''}
          {record.duration ? ` · ${formatDuration(record.duration)}` : ''}
        </small>
        {active || record.state === 'paused' ? <ProgressBar record={record} /> : null}
        {record.error ? <em className="download-error">{record.error}</em> : null}
      </div>
      <div className="download-actions">
        <button
          type="button"
          className="icon-button"
          onClick={() => playTrack(track)}
          aria-label={`${record.title} çal`}
          title="Çal"
        >
          <Play size={16} />
        </button>
        {active ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => cancel(record.trackId)}
            aria-label="İndirmeyi iptal et"
            title="İptal et"
          >
            <X size={16} />
          </button>
        ) : record.state === 'downloaded' ? (
          <>
            <span className="download-check" title="Bu cihazda"><CheckCircle2 size={17} /></span>
            <button
              type="button"
              className="icon-button"
              onClick={() => void saveToDevice()}
              aria-label="Dosyayı cihaza kaydet"
              title="Dosyayı cihaza kaydet"
            >
              <HardDriveDownload size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void remove(record.trackId)}
              aria-label="Yerel kopyayı kaldır"
              title="Yerel kopyayı kaldır"
            >
              <Trash2 size={16} />
            </button>
          </>
        ) : retryable ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => void download(track).catch(() => pushToast('İndirme başlatılamadı.', 'error'))}
            aria-label="Yeniden dene"
            title="Yeniden dene"
          >
            <RefreshCw size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-button"
            onClick={() => void download(track).catch(() => pushToast('İndirme başlatılamadı.', 'error'))}
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

  const groups = useMemo(() => {
    const all = Object.values(records);
    return {
      active: all.filter((record) => record.state === 'downloading' || record.state === 'queued'),
      paused: all.filter((record) => record.state === 'paused'),
      failed: all.filter((record) => record.state === 'failed' || record.state === 'unavailable'),
      done: all.filter((record) => record.state === 'downloaded'),
    };
  }, [records]);

  const totalBytes = groups.done.reduce((sum, record) => sum + record.size, 0);
  const usage = estimate?.usage ?? totalBytes;
  const totalCount = groups.active.length + groups.paused.length + groups.failed.length + groups.done.length;

  return (
    <section className="page downloads-page" aria-labelledby="downloads-title">
      <header className="page-head">
        <div>
          <span className="eyebrow">Yerel indirmeler</span>
          <h1 id="downloads-title">Bu cihazdaki müzik</h1>
          <p>İndirilen ses yalnızca bu cihazda saklanır; sunucuda dosya tutulmaz.</p>
        </div>
        <div className="storage-card" aria-label="Depolama kullanımı">
          <span><strong>{formatBytes(usage)}</strong> kullanılıyor</span>
          {estimate?.quota ? <small>{formatBytes(estimate.quota)} toplam</small> : <small>Tarayıcı kotası</small>}
        </div>
      </header>

      {totalCount === 0 ? (
        <EmptyState
          icon={<WifiOff size={34} />}
          title="Bu cihazda henüz indirme yok."
          description="Bir şarkıyı indirdiğinde burada, bu cihazda; internet olmadan da çalar."
          action={<a className="button primary" href="/search">Müzik ara</a>}
        />
      ) : (
        <div className="download-groups">
          {groups.active.length + groups.paused.length > 0 ? (
            <section className="download-group" aria-label="Aktif indirmeler">
              <div className="download-group-head">
                <h2>
                  <CloudDownload size={17} /> İndiriliyor
                </h2>
                <span className="status-pill">{groups.active.length} aktif</span>
                {groups.paused.length ? (
                  <span className="status-pill is-warning">
                    <PauseCircle size={13} /> {groups.paused.length} duraklatıldı
                  </span>
                ) : null}
              </div>
              <div className="download-grid">
                {[...groups.active, ...groups.paused].map((record) => (
                  <DownloadRow key={record.trackId} record={record} />
                ))}
              </div>
            </section>
          ) : null}

          {groups.failed.length > 0 ? (
            <section className="download-group" aria-label="Başarısız indirmeler">
              <div className="download-group-head">
                <h2>
                  <TriangleAlert size={17} /> Başarısız
                </h2>
                <span className="status-pill is-warning">{groups.failed.length}</span>
              </div>
              <div className="download-grid">
                {groups.failed.map((record) => (
                  <DownloadRow key={record.trackId} record={record} />
                ))}
              </div>
            </section>
          ) : null}

          {groups.done.length > 0 ? (
            <section className="download-group" aria-label="İndirilenler">
              <div className="download-group-head">
                <h2>
                  <CheckCircle2 size={17} /> Bu cihazda {groups.done.length} parça
                </h2>
                <span className="status-pill">{formatBytes(totalBytes)}</span>
                <span className="status-pill">
                  {formatDuration(groups.done.reduce((sum, record) => sum + record.duration, 0))}
                </span>
              </div>
              <div className="download-grid">
                {groups.done.map((record) => (
                  <DownloadRow key={record.trackId} record={record} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      <section className="panel storage-panel" aria-label="Depolama yönetimi">
        <div>
          <h2>Depolama yönetimi</h2>
          <p>
            Yerel kopyayı kaldırmak favorilerden veya çalma listelerinden çıkarmaz; yalnızca bu cihazın
            çevrimdışı dosyasını siler. İstersen dosyayı cihazına ayrıca kaydedebilirsin.
          </p>
          <small>{library.stats.tracks} parça kütüphanede · {groups.done.length} parça bu cihazda</small>
        </div>
      </section>
    </section>
  );
}
