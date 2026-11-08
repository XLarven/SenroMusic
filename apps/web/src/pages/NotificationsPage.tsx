import { Bell } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { useMusicData } from '../MusicDataContext';
import { formatDate } from '../lib/format';

export function NotificationsPage() {
  const { library } = useMusicData();
  const recent = [...library.tracks].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()).slice(0, 10);

  return (
    <div className="page">
      <header className="page-heading">
        <span className="eyebrow">Bildirimler</span>
        <h1>Bildirimler</h1>
        <p>Kütüphanendeki son eklenenler ve senin için seçtiklerimiz.</p>
      </header>

      {recent.length === 0 ? (
        <EmptyState icon={Bell} title="Bildirim yok" description="Kütüphanene yeni şarkı eklenince burada göreceksin." />
      ) : (
        <div className="surface-panel">
          {recent.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 10px', borderBottom: '1px solid var(--border)' }}>
              <img src={t.coverUrl || ''} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', background: '#222' }} loading="lazy" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{t.title}</strong>
                <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>{t.artist} · {formatDate(t.addedAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: '0.78rem' }}>
        Not: Push bildirim sistemi backend gerektirir — mevcut altyapıda kütüphane aktivitesi gösteriliyor. Push için VAPID/WebSocket gerekir.
      </p>
    </div>
  );
}
