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
import { Cover } from '../../components/Cover';
import { EmptyState } from '../../components/EmptyState';
import { useMusicData } from '../../MusicDataContext';
import { getStorageEstimate, loadDownloadBlob } from '../../lib/localDownloads';
import { formatBytes, formatDuration } from '../../lib/format';
import { t } from '../../lib/i18n';
import { useDownloads } from '../../store/downloads';
import { usePlayer } from '../../store/player';
import { useToastStore } from '../../store/toast';
import type { DownloadRecord, Track } from '../../types';

const STATE_LABEL: Record<string, string> = {
  'not-downloaded': t('İndirilmedi', 'Not downloaded'),
  queued: t('Sırada', 'Queued'),
  downloading: t('İndiriliyor', 'Downloading'),
  paused: t('Duraklatıldı', 'Paused'),
  downloaded: t('Bu cihazda', 'On this device'),
  failed: t('Başarısız', 'Failed'),
  unavailable: t('Dosya bulunamadı', 'File missing'),
};

/** A record can outlive its library entry (imported Spotify/YouTube tracks). */
export function trackFromRecord(record: DownloadRecord): Track {
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
        aria-label={percent === null ? t('İndiriliyor', 'Downloading') : `${t('Yüzde', 'Percent')} ${percent}`}
      >
        <span style={{ width: percent === null ? '40%' : `${percent}%` }} />
      </div>
      <small className="download-percent">
        {percent === null
          ? formatBytes(record.received ?? 0)
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
        pushToast(t('Yerel dosya bulunamadı.', 'Local file not found.'), 'error');
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
      pushToast(t('Dosya cihazına kaydedildi.', 'Saved to your device.'), 'success');
    } catch {
      pushToast(t('Dosya kaydedilemedi.', 'Could not save the file.'), 'error');
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
          aria-label={`${record.title} ${t('çal', 'play')}`}
          title={t('Çal', 'Play')}
        >
          <Play size={16} />
        </button>
        {active ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => cancel(record.trackId)}
            aria-label={t('İndirmeyi iptal et', 'Cancel download')}
            title={t('İptal et', 'Cancel')}
          >
            <X size={16} />
          </button>
        ) : record.state === 'downloaded' ? (
          <>
            <span className="download-check" title={t('Bu cihazda', 'On this device')}>
              <CheckCircle2 size={17} />
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => void saveToDevice()}
              aria-label={t('Dosyayı cihaza kaydet', 'Save file to device')}
              title={t('Dosyayı cihaza kaydet', 'Save file to device')}
            >
              <HardDriveDownload size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void remove(record.trackId)}
              aria-label={t('Yerel kopyayı kaldır', 'Remove local copy')}
              title={t('Yerel kopyayı kaldır', 'Remove local copy')}
            >
              <Trash2 size={16} />
            </button>
          </>
        ) : retryable ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => void download(track).catch(() => pushToast(t('İndirme başlatılamadı.', 'Download could not start.'), 'error'))}
            aria-label={t('Yeniden dene', 'Retry')}
            title={t('Yeniden dene', 'Retry')}
          >
            <RefreshCw size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-button"
            onClick={() => void download(track).catch(() => pushToast(t('İndirme başlatılamadı.', 'Download could not start.'), 'error'))}
            aria-label={t('Bu cihazda indir', 'Download to this device')}
            title={t('Bu cihazda indir', 'Download to this device')}
          >
            <CloudDownload size={16} />
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * Device-local downloads. Rendered inside the Library tab and on /downloads so
 * the old route keeps working.
 */
export function DownloadsPanel({ compact = false }: { compact?: boolean }) {
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
    <div className={`downloads-panel ${compact ? 'is-compact' : ''}`}>
      <div className="downloads-panel-head">
        <div className="storage-card" aria-label={t('Depolama kullanımı', 'Storage usage')}>
          <span>
            <strong>{formatBytes(usage)}</strong> {t('kullanılıyor', 'used')}
          </span>
          {estimate?.quota ? (
            <small>{formatBytes(estimate.quota)} {t('toplam', 'total')}</small>
          ) : (
            <small>{t('Tarayıcı kotası', 'Browser quota')}</small>
          )}
        </div>
        <p className="settings-hint">
          {t(
            'İndirilen ses yalnızca bu cihazda saklanır; sunucuda dosya tutulmaz.',
            'Downloaded audio stays on this device; nothing is stored on the server.',
          )}
        </p>
      </div>

      {totalCount === 0 ? (
        <EmptyState
          icon={<WifiOff size={34} />}
          title={t('Bu cihazda henüz indirme yok.', 'No downloads on this device yet.')}
          description={t(
            'Bir şarkıyı indirdiğinde burada, bu cihazda; internet olmadan da çalar.',
            'Download a song and it lives here, on this device — playable without internet.',
          )}
          action={
            <a className="button primary" href="/search">
              {t('Müzik ara', 'Find music')}
            </a>
          }
        />
      ) : (
        <div className="download-groups">
          {groups.active.length + groups.paused.length > 0 ? (
            <section className="download-group" aria-label={t('Aktif indirmeler', 'Active downloads')}>
              <div className="download-group-head">
                <h3>
                  <CloudDownload size={17} /> {t('İndiriliyor', 'Downloading')}
                </h3>
                <span className="status-pill">
                  {groups.active.length} {t('aktif', 'active')}
                </span>
                {groups.paused.length ? (
                  <span className="status-pill is-warning">
                    <PauseCircle size={13} /> {groups.paused.length} {t('duraklatıldı', 'paused')}
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
            <section className="download-group" aria-label={t('Başarısız indirmeler', 'Failed downloads')}>
              <div className="download-group-head">
                <h3>
                  <TriangleAlert size={17} /> {t('Başarısız', 'Failed')}
                </h3>
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
            <section className="download-group" aria-label={t('İndirilenler', 'Downloads')}>
              <div className="download-group-head">
                <h3>
                  <CheckCircle2 size={17} /> {t('Bu cihazda', 'On this device')} {groups.done.length}{' '}
                  {t('parça', 'tracks')}
                </h3>
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

      {!compact ? (
        <section className="panel storage-panel" aria-label={t('Depolama yönetimi', 'Storage management')}>
          <div>
            <h2>{t('Depolama yönetimi', 'Storage management')}</h2>
            <p>
              {t(
                'Yerel kopyayı kaldırmak favorilerden veya çalma listelerinden çıkarmaz; yalnızca bu cihazın çevrimdışı dosyasını siler. İstersen dosyayı cihazına ayrıca kaydedebilirsin.',
                'Removing a local copy does not touch favorites or playlists; it only deletes this device’s offline file. You can also save the file to your device.',
              )}
            </p>
            <small>
              {library.stats.tracks} {t('parça kütüphanede', 'tracks in the library')} · {groups.done.length}{' '}
              {t('parça bu cihazda', 'tracks on this device')}
            </small>
          </div>
        </section>
      ) : null}
    </div>
  );
}
