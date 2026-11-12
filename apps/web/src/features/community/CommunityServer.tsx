import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Lock, MessageSquare, ShieldCheck, Users } from 'lucide-react';
import { api } from '../../api';
import { t } from '../../lib/i18n';
import { subscribeRealtime } from '../../lib/presence';
import { useAuthStore } from '../../store/auth';
import { CommunityChat } from './CommunityChat';
import { CommunityMembers } from './CommunityMembers';
import type { CommunityModerationEntry, CommunityReport } from '../../types';

/**
 * The official NorieMusic Community: one header, one global chat and one member
 * list. There is no server picker — the community is the platform itself.
 */
export function CommunityServer() {
  const [tab, setTab] = useState<'chat' | 'members'>('chat');
  const [modOpen, setModOpen] = useState(false);
  const myId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['community', 'me'], queryFn: () => api.communityMe(), staleTime: 30_000 });
  const moderation = useQuery({
    queryKey: ['community', 'moderation'],
    queryFn: () => api.communityModeration(),
    enabled: modOpen && (me.data?.canModerate ?? false),
    staleTime: 15_000,
  });

  const data = me.data;

  // Role or restriction changes for this account must reach the composer live.
  useEffect(() => {
    const unsubscribe = subscribeRealtime((event) => {
      if (event.type === 'community_member_update' && event.userId === myId) {
        void queryClient.invalidateQueries({ queryKey: ['community', 'me'] });
      }
      if (event.type === 'community_moderation' && event.targetUserId === myId) {
        void queryClient.invalidateQueries({ queryKey: ['community', 'me'] });
      }
    });
    return unsubscribe;
  }, [myId, queryClient]);

  return (
    <section className="community-server" aria-label={t('NorieMusic Topluluğu', 'NorieMusic Community')}>
      <header className="community-server-head">
        <div className="community-server-id">
          <span className="community-server-mark" aria-hidden="true">
            <MessageSquare size={20} />
          </span>
          <div>
            <h2>{data?.name ?? 'NorieMusic Community'}</h2>
            <p>
              {data
                ? t(
                    `${data.memberCount} üye · herkese açık genel sohbet`,
                    `${data.memberCount} members · one public general chat`,
                  )
                : t('Yükleniyor…', 'Loading…')}
            </p>
          </div>
        </div>
        <div className="community-server-actions">
          {data?.role === 'owner' ? <span className="community-role is-owner">{t('Kurucu', 'Owner')}</span> : null}
          {data?.role === 'moderator' ? <span className="community-role">{t('Moderatör', 'Moderator')}</span> : null}
          <span className="status-pill">
            <Lock size={12} /> {t('Resmî sunucu', 'Official server')}
          </span>
          {data?.canModerate ? (
            <button type="button" className="button ghost compact" onClick={() => setModOpen((value) => !value)}>
              <ShieldCheck size={14} /> {t('Moderasyon', 'Moderation')}
            </button>
          ) : null}
        </div>
      </header>

      <div className="community-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={`room-tab ${tab === 'chat' ? 'is-active' : ''}`}
          onClick={() => setTab('chat')}
        >
          <MessageSquare size={14} /> {t('Genel Sohbet', 'General Chat')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'members'}
          className={`room-tab ${tab === 'members' ? 'is-active' : ''}`}
          onClick={() => setTab('members')}
        >
          <Users size={14} /> {t('Üyeler', 'Members')}
        </button>
      </div>

      <div className={`community-layout ${tab === 'members' ? 'show-members' : ''}`}>
        <div className="community-chat-slot">
          {me.isPending ? (
            <div className="taste-loading">
              <Loader2 size={16} className="spin" /> {t('Topluluk yükleniyor', 'Loading the community')}
            </div>
          ) : (
            <CommunityChat me={data ?? null} />
          )}
        </div>
        <aside className="community-members-slot">
          <CommunityMembers me={data ?? null} />
        </aside>
      </div>

      {modOpen && data?.canModerate ? (
        <div className="community-mod-panel">
          <div className="community-mod-head">
            <h3>
              <ShieldCheck size={16} /> {t('Moderasyon', 'Moderation')}
            </h3>
            <button type="button" className="icon-button subtle" onClick={() => setModOpen(false)} aria-label={t('Kapat', 'Close')}>
              ×
            </button>
          </div>

          {moderation.isPending ? (
            <div className="taste-loading">
              <Loader2 size={15} className="spin" /> {t('Yükleniyor', 'Loading')}
            </div>
          ) : (
            <div className="community-mod-grid">
              <div>
                <h4>{t('Açık bildirimler', 'Open reports')}</h4>
                {(moderation.data?.reports.length ?? 0) === 0 ? (
                  <p className="dm-share-hint">{t('Bekleyen bildirim yok.', 'No pending reports.')}</p>
                ) : (
                  <ul className="community-mod-list">
                    {moderation.data?.reports.map((report: CommunityReport) => (
                      <li key={report.id}>
                        <span>
                          <strong>{report.reporterName}</strong> → {report.targetName} · {report.reason}
                        </span>
                        <div>
                          <button
                            type="button"
                            className="button ghost compact"
                            onClick={() => void api.communityResolveReport(report.id, 'resolved').then(() => moderation.refetch())}
                          >
                            {t('Kapat', 'Resolve')}
                          </button>
                          <button
                            type="button"
                            className="button ghost compact"
                            onClick={() => void api.communityResolveReport(report.id, 'dismissed').then(() => moderation.refetch())}
                          >
                            {t('Yok say', 'Dismiss')}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4>{t('Son işlemler', 'Recent actions')}</h4>
                <ul className="community-mod-list">
                  {(moderation.data?.actions ?? []).slice(0, 12).map((entry: CommunityModerationEntry) => (
                    <li key={entry.id}>
                      <span>
                        <strong>{entry.action}</strong> · {new Date(entry.createdAt).toLocaleString()}
                      </span>
                      <small>{entry.reason ?? ''}</small>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <nav className="community-nav-pills" aria-label={t('Topluluk bölümleri', 'Community sections')}>
        <a href="#friends">{t('Arkadaşlar', 'Friends')}</a>
        <a href="#messages">{t('Mesajlar', 'Messages')}</a>
        <Link to="/rooms">{t('Birlikte Dinle', 'Listening Together')}</Link>
        <Link to="/community/taste">{t('Zevk Uyumu', 'Taste Match')}</Link>
        <Link to="/quiz">{t('Müzik Yarışması', 'Music Quiz')}</Link>
      </nav>
    </section>
  );
}
