import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, UserRound, Wifi, Clock3, UserPlus, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { EmptyState } from '../components/EmptyState';
import { formatDate, formatCount } from '../lib/format';
import { useMusicData } from '../MusicDataContext';

function shortDuration(value: string | null): string {
  if (!value) return '—';
  const diffMin = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (diffMin < 1) return 'şimdi';
  if (diffMin < 60) return `${diffMin} dk önce`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.round(hours / 24);
  return `${days} gün önce`;
}

export function AdminPage() {
  const { refreshLibrary } = useMusicData();
  const stats = useQuery({
    queryKey: ['admin-stats'],
    queryFn: api.adminStats,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const data = stats.data;
  const online = data?.onlineNow ?? 0;

  return (
    <div className="page admin-page">
      <header className="page-heading">
        <span className="eyebrow">Yönetim</span>
        <h1>Kullanıcılar &amp; aktivite</h1>
        <p>Kaç kişi kayıtlı, kaç kişi şu an çevrimiçi, kim en son ne zaman girdi.</p>
      </header>

      {stats.isPending ? (
        <p style={{ color: 'var(--muted)' }}>Yükleniyor…</p>
      ) : stats.isError || !data ? (
        <EmptyState
          icon={ShieldCheck}
          title="Veri alınamadı"
          description={stats.error instanceof Error ? stats.error.message : 'Yönetici yetkisi gerekli.'}
          action={
            <button type="button" className="button secondary" onClick={() => void stats.refetch()}>
              <RefreshCw size={16} /> Yeniden dene
            </button>
          }
        />
      ) : (
        <>
          <div className="library-stats" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            <div className="library-stat">
              <span className="library-stat-icon"><UserRound size={18} /></span>
              <span>
                <strong>{formatCount(data.totalUsers)}</strong>
                <small>toplam kullanıcı</small>
              </span>
            </div>
            <div className="library-stat">
              <span className="library-stat-icon"><Wifi size={18} /></span>
              <span>
                <strong style={{ color: online > 0 ? '#34d399' : undefined }}>{formatCount(data.onlineNow)}</strong>
                <small>şimdi çevrimiçi (3 dk içi)</small>
              </span>
            </div>
            <div className="library-stat">
              <span className="library-stat-icon"><Clock3 size={18} /></span>
              <span>
                <strong>{formatCount(data.activeToday)}</strong>
                <small>son 24 saat aktif</small>
              </span>
            </div>
            <div className="library-stat">
              <span className="library-stat-icon"><UserPlus size={18} /></span>
              <span>
                <strong>{formatCount(data.newLast7d)}</strong>
                <small>son 7 gün kayıt</small>
              </span>
            </div>
          </div>

          <section className="content-section">
            <div className="section-heading">
              <div>
                <h2>Kullanıcı listesi</h2>
                <p>{data.users.length} kayıt — çevrimiçi olanlar üstte.</p>
              </div>
              <button type="button" className="button secondary" onClick={() => { void stats.refetch(); void refreshLibrary(); }}>
                <RefreshCw size={16} /> Yenile
              </button>
            </div>

            {data.users.length === 0 ? (
              <EmptyState icon={UserRound} title="Henüz kullanıcı yok" description="İlk kayıt olan yönetici olur." />
            ) : (
              <div className="surface-panel">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 640 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        <th style={{ padding: '12px 10px' }}>Kullanıcı</th>
                        <th style={{ padding: '12px 10px' }}>Rol</th>
                        <th style={{ padding: '12px 10px' }}>Durum</th>
                        <th style={{ padding: '12px 10px' }}>Son aktif</th>
                        <th style={{ padding: '12px 10px' }}>Kayıt</th>
                        <th style={{ padding: '12px 10px' }}>IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.map((u) => (
                        <tr key={u.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px' }}>
                            <div style={{ fontWeight: 650 }}>{u.displayName}</div>
                            <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>{u.email}</div>
                          </td>
                          <td style={{ padding: '10px' }}>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: 999,
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              background: u.role === 'admin' ? 'rgba(255,62,99,0.18)' : 'rgba(255,255,255,0.08)',
                              color: u.role === 'admin' ? '#ff8fa8' : 'var(--text-soft)',
                            }}>
                              {u.role === 'admin' ? 'Yönetici' : 'Kullanıcı'}
                            </span>
                          </td>
                          <td style={{ padding: '10px' }}>
                            {u.online ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#34d399', fontWeight: 700 }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 10px #34d399' }} />
                                Çevrimiçi
                              </span>
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>Çevrimdışı</span>
                            )}
                          </td>
                          <td style={{ padding: '10px' }}>
                            <div>{shortDuration(u.lastActiveAt)}</div>
                            <div style={{ color: 'var(--muted)', fontSize: '0.68rem' }}>{u.lastActiveAt ? formatDate(u.lastActiveAt) : '—'}</div>
                          </td>
                          <td style={{ padding: '10px', color: 'var(--muted)' }}>{formatDate(u.createdAt)}</td>
                          <td style={{ padding: '10px', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>
                            {u.lastIp || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <p style={{ marginTop: 14, color: 'var(--muted)', fontSize: '0.78rem' }}>
            Çevrimiçi = son 3 dakikada giriş yapmış. IP ve tarayıcı bilgisi yalnızca kendi sunucunuzdan görüntülenir — Supabase önemli görürseniz <code>last_ip</code> alanını kaldırın.
          </p>
        </>
      )}
    </div>
  );
}
