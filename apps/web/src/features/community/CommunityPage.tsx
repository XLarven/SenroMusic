import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  MessageSquare,
  MessagesSquare,
  Radio,
  Sparkles,
  Trophy,
  UserPlus,
  Users,
  UsersRound,
} from 'lucide-react';
import { api } from '../../api';
import { subscribeRealtime } from '../../lib/presence';
import { useAuthStore } from '../../store/auth';
import { t } from '../../lib/i18n';
import { CommunityChat } from './CommunityChat';
import { CommunityMembers } from './CommunityMembers';
import { FriendsPanel } from './FriendsPanel';
import { PeopleSearch } from './PeopleSearch';
import { MessagesPanel } from './MessagesPanel';
import { ListeningRoomsPanel } from './ListeningRoomsPanel';
import { TasteMatchPanel } from './TasteMatchPanel';
import { QuizTeaserPanel } from './QuizTeaserPanel';

type SectionKey = 'chat' | 'friends' | 'messages' | 'rooms' | 'taste' | 'quiz' | 'members';

const SECTIONS: Array<{ key: SectionKey; icon: typeof Users; tr: string; en: string }> = [
  { key: 'chat', icon: MessageSquare, tr: 'Genel Sohbet', en: 'General Chat' },
  { key: 'friends', icon: Users, tr: 'Arkadaşlar', en: 'Friends' },
  { key: 'messages', icon: MessagesSquare, tr: 'Direkt Mesajlar', en: 'Direct Messages' },
  { key: 'rooms', icon: Radio, tr: 'Birlikte Dinle', en: 'Listening Together' },
  { key: 'taste', icon: Sparkles, tr: 'Zevk Uyumu', en: 'Taste Match' },
  { key: 'quiz', icon: Trophy, tr: 'Müzik Yarışması', en: 'Music Quiz' },
  { key: 'members', icon: UsersRound, tr: 'Üyeler', en: 'Members' },
];

/**
 * Official community shell.
 *
 * One section at a time, chosen from the left rail (or the mobile chip row), with
 * the member list as contextual right panel. Nothing is stacked vertically any
 * more; every panel keeps its own loading/empty states.
 */
export function CommunityPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('section');
  const section: SectionKey = (SECTIONS.some((entry) => entry.key === raw) ? raw : 'chat') as SectionKey;
  const me = useQuery({ queryKey: ['community', 'me'], queryFn: () => api.communityMe(), staleTime: 30_000 });
  const myId = useAuthStore((state) => state.user?.id ?? null);
  const queryClient = useQueryClient();

  // Role and restriction changes for this account reach the composer live.
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

  const select = (key: SectionKey) => {
    const next = new URLSearchParams(params);
    if (key === 'chat') next.delete('section');
    else next.set('section', key);
    setParams(next, { replace: true });
  };

  const showAside = section === 'chat' || section === 'friends';

  return (
    <div className="page community-page community-workspace">
      <header className="community-hero community-hero-compact">
        <div>
          <span className="eyebrow">{t('Topluluk', 'Community')}</span>
          <h1>{me.data?.name ?? 'NorieMusic Community'}</h1>
          <p>
            {me.data
              ? t(`${me.data.memberCount} üye · tek resmî sunucu`, `${me.data.memberCount} members · one official server`)
              : t('Resmî topluluk yükleniyor…', 'Loading the official community…')}
          </p>
        </div>
        {me.data?.role !== 'member' ? (
          <span className="community-role is-owner">
            {me.data?.role === 'owner' ? t('Kurucu', 'Owner') : t('Moderatör', 'Moderator')}
          </span>
        ) : null}
      </header>

      <div className="community-shell">
        <nav className="community-rail" aria-label={t('Topluluk bölümleri', 'Community sections')}>
          {SECTIONS.map(({ key, icon: Icon, tr, en }) => (
            <button
              key={key}
              type="button"
              className={`community-rail-item ${section === key ? 'is-active' : ''}`}
              onClick={() => select(key)}
              aria-current={section === key ? 'page' : undefined}
            >
              <Icon size={16} />
              <span>{t(tr, en)}</span>
            </button>
          ))}
          <div className="community-rail-foot">
            <span className="status-pill">
              <UserPlus size={12} /> {t('Resmî sunucu', 'Official server')}
            </span>
          </div>
        </nav>

        <main className="community-main">
          {section === 'chat' ? (
            <CommunityChat me={me.data ?? null} />
          ) : section === 'friends' ? (
            <div className="community-section-stack">
              <section aria-label={t('Arkadaşlar', 'Friends')}>
                <FriendsPanel />
              </section>
              <section aria-label={t('Kişiler', 'People')}>
                <div className="section-heading">
                  <div>
                    <h2>{t('Kişiler', 'People')}</h2>
                    <p>{t('Yeni arkadaşlar bul.', 'Find new friends.')}</p>
                  </div>
                </div>
                <PeopleSearch />
              </section>
            </div>
          ) : section === 'messages' ? (
            <MessagesPanel />
          ) : section === 'rooms' ? (
            <ListeningRoomsPanel />
          ) : section === 'taste' ? (
            <TasteMatchPanel />
          ) : section === 'quiz' ? (
            <QuizTeaserPanel />
          ) : (
            <CommunityMembers me={me.data ?? null} />
          )}
        </main>

        {showAside ? (
          <aside className="community-aside" aria-label={t('Üyeler', 'Members')}>
            <CommunityMembers me={me.data ?? null} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
