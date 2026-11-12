import { Check, CloudDownload, Loader2, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { useDownloads } from '../store/downloads';
import { useToastStore } from '../store/toast';
import type { Track } from '../types';

export function DownloadButton({ track }: { track: Track }) {
  const record = useDownloads((state) => state.records[track.id]);
  const download = useDownloads((state) => state.download);
  const cancel = useDownloads((state) => state.cancel);
  const pushToast = useToastStore((state) => state.push);
  const state = record?.state ?? 'not-downloaded';
  const bytes =
    record && record.received
      ? `${(record.received / 1_048_576).toFixed(1)} MB${
          record.total ? ` / ${(record.total / 1_048_576).toFixed(1)} MB` : ''
        }`
      : '';

  if (state === 'downloading') {
    return (
      <button
        type="button"
        className="icon-button subtle track-action download-button is-downloading"
        onClick={() => cancel(track.id)}
        title={`İndiriliyor %${record?.progress ?? 0}${bytes ? ` · ${bytes}` : ''} — iptal etmek için dokun`}
        aria-label={`${track.title} indiriliyor, iptal et`}
      >
        <Loader2 size={16} className="spin" />
      </button>
    );
  }

  if (state === 'verifying') {
    return (
      <span
        className="download-button is-verifying"
        title="Dosya doğrulanıyor"
        aria-label={`${track.title} doğrulanıyor`}
      >
        <Check size={16} />
      </span>
    );
  }

  if (state === 'queued') {
    return (
      <button
        type="button"
        className="icon-button subtle track-action download-button is-queued"
        onClick={() => cancel(track.id)}
        title="Sırada bekliyor — kuyruktan çıkarmak için dokun"
        aria-label={`${track.title} indirme sırasında, kuyruktan çıkar`}
      >
        <CloudDownload size={16} />
      </button>
    );
  }

  if (state === 'downloaded') {
    return (
      <span className="download-button downloaded" title="Bu cihazda indirildi" aria-label="Bu cihazda indirildi">
        <Check size={16} />
      </span>
    );
  }

  if (state === 'failed' || state === 'unavailable') {
    return (
      <button
        type="button"
        className="icon-button subtle track-action download-button is-error"
        onClick={() => void download(track).catch(() => pushToast('İndirme yeniden başlatılamadı.', 'error'))}
        title={record?.error ?? 'İndirme başarısız — yeniden dene'}
        aria-label={`${track.title} indirme başarısız, yeniden dene`}
      >
        <TriangleAlert size={16} />
      </button>
    );
  }

  if (state === 'paused') {
    return (
      <button
        type="button"
        className="icon-button subtle track-action download-button"
        onClick={() => void download(track).catch(() => pushToast('İndirme sürdürülemedi.', 'error'))}
        title="İndirmeyi sürdür"
        aria-label={`${track.title} indirmeyi sürdür`}
      >
        <RotateCcw size={16} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="icon-button subtle track-action download-button"
      onClick={() => void download(track).catch(() => pushToast('İndirme başlatılamadı.', 'error'))}
      title="Bu cihazda indir"
      aria-label={`${track.title} bu cihazda indir`}
    >
      <CloudDownload size={16} />
    </button>
  );
}

export function DownloadCancelIcon() {
  return <X size={16} />;
}
