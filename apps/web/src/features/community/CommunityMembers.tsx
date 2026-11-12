import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Headphones, Loader2, Search, ShieldOff, ShieldPlus, UserCog } from 'lucide-react';
import { api } from '../../api';
import { Cover } from '../../components/Cover';
import { t } from '../../lib/i18n';
import { subscribeRealtime } from '../../lib/presence';
import { useAuthStore } from '../../store/auth';
import { useToastStore } from '../../store/toast';
import type { CommunityMe, CommunityMember } from '../../types';

const PAGE = 30;

/**
 * Registered-member directory for the official community.
 *
 * Presence and listening activity are filtered by the server per member, so an
 * invisible user arrives as offline with no activity. Moderation actions are
 * offered only when the server already says the viewer is staff.
 */
export function CommunityMembers({ me }: { me: CommunityMe | null }) {
  const myId = useAuthStore((state) => state.user?.id ?? null);
  const pushToast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const members = useQuery({
    queryKey: ['community', 'members', query, page],
    queryFn: () => api.communityMembers({ q: query || undefined, limit: PAGE * page, offset: 0 }),
    staleTime: 20_000,
  });

  useEffect(() => {
    const unsubscribe = subscribeRealtime((event) => {
      if (event.type === 'community_member_update' || event.type === 'community_moderation') {
        void queryClient.invalidateQueries({ queryKey: ['community', 'members'] });
      }
    });
    return unsubscribe;
  }, [queryClient]);

  const act = useCallback(
    async (userId: string, action: () => Promise<unknown>, message: string) => {
      setBusyId(userId);
      try {
        await action();
        await queryClient.invalidateQueries({ queryKey: ['community', 'members'] });
        pushToast(message, 'success');
      } catch (error) {
        pushToast(error instanceof Error ? error.message : t('İşlem başarısız.', 'Action failed.'), 'error');
      } finally {
        setBusyId(null);
        setOpenMenu(null);
      }
    },
    [pushToast, queryClient],
  );

  const canModerate = me?.canModerate ?? false;
  const isOwner = me?.role === 'owner';
  const items: CommunityMember[] = members.data?.items ?? [];
  const total = members.data?.total ?? 0;

  return (
    <div className="community-members">
      <div className="community-members-head">
        <h2>{t('Üyeler', 'Members')}</h2>
        <span className="status-pill">{total}</span>
      </div>
      <label className="taste-input community-search">
        <Search size={14} />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('Üye ara', 'Search members')}
          aria-label={t('Üye ara', 'Search members')}
        />
      </label>

      {members.isPending ? (
        <div className="dm-list-status">
          <Loader2 size={16} className="spin" /> {t('Yükleniyor', 'Loading')}
        </div>
      ) : items.length === 0 ? (
        <p className="dm-share-hint">{t('Eşleşen üye yok.', 'No matching members.')}</p>
      ) : (
        <ul className="community-member-list">
          {items.map((member) => {
            const mine = member.userId === myId;
            const href = member.username ? `/u/${member.username}` : `/profile/${member.userId}`;
            const isStaffRow = member.role === 'owner' || member.role === 'moderator';
            return (
              <li key={member.userId} className="community-member">
                <Link to={href} className="community-member-avatar">
                  <Cover src={member.avatarUrl} alt="" seed={member.userId} className="person-avatar" iconSize={14} />
                  {member.status !== 'offline' ? <span className={`presence-dot-wrap is-${member.status}`} /> : null}
                </Link>
                <div className="community-member-copy">
                  <Link to={href}>
                    <strong>{member.displayName}</strong>
                    {member.role === 'owner' ? <span className="community-role is-owner">{t('Kurucu', 'Owner')}</span> : null}
                    {member.role === 'moderator' ? <span className="community-role">{t('Mod', 'Mod')}</span> : null}
                  </Link>
                  {member.activity ? (
                    <small className="community-now">
                      <Headphones size={11} /> {member.activity.title} · {member.activity.artist}
                    </small>
                  ) : (
                    <small>{member.username ? `@${member.username}` : member.status === 'online' ? t('Çevrimiçi', 'Online') : t('Üye', 'Member')}</small>
                  )}
                  {member.mutedUntil || member.suspendedUntil ? (
                    <small className="community-restricted">
                      {member.suspendedUntil ? t('askıda', 'suspended') : t('susturuldu', 'muted')}
                    </small>
                  ) : null}
                </div>

                {canModerate && !mine && member.role !== 'owner' && (!isStaffRow || isOwner) ? (
                  <div className="community-member-actions">
                    <button
                      type="button"
                      className="icon-button subtle"
                      onClick={() => setOpenMenu(openMenu === member.userId ? null : member.userId)}
                      aria-label={t('Moderasyon', 'Moderation')}
                      disabled={busyId === member.userId}
                    >
                      {busyId === member.userId ? <Loader2 size={13} className="spin" /> : <UserCog size={14} />}
                    </button>
                    {openMenu === member.userId ? (
                      <div className="community-menu">
                        <button
                          type="button"
                          onClick={() =>
                            void act(member.userId, () => api.communityMute(member.userId, 10, 'community'), t('10 dakika susturuldu.', 'Muted for 10 minutes.'))
                          }
                        >
                          {t('10 dk sustur', 'Mute 10m')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void act(member.userId, () => api.communitySuspend(member.userId, 60, 'community'), t('1 saat askıya alındı.', 'Suspended for 1 hour.'))
                          }
                        >
                          {t('1 saat askıya al', 'Suspend 1h')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void act(member.userId, () => api.communityClearRestriction(member.userId, 'mute'), t('Susturma kaldırıldı.', 'Mute cleared.'))
                          }
                        >
                          <ShieldPlus size={12} /> {t('Susturmayı kaldır', 'Clear mute')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void act(member.userId, () => api.communityClearRestriction(member.userId, 'suspend'), t('Askı kaldırıldı.', 'Suspension cleared.'))
                          }
                        >
                          <ShieldOff size={12} /> {t('Askıyı kaldır', 'Clear suspension')}
                        </button>
                        {isOwner ? (
                          <button
                            type="button"
                            onClick={() =>
                              void act(
                                member.userId,
                                () => api.communitySetRole(member.userId, member.role === 'moderator' ? 'member' : 'moderator'),
                                member.role === 'moderator'
                                  ? t('Moderatörlük alındı.', 'Moderator removed.')
                                  : t('Moderatör yapıldı.', 'Promoted to moderator.'),
                              )
                            }
                          >
                            {member.role === 'moderator' ? t('Moderatörlüğü al', 'Demote') : t('Moderatör yap', 'Make moderator')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {items.length < total ? (
        <button type="button" className="button ghost compact community-more" onClick={() => setPage((value) => value + 1)}>
          {t('Daha fazla üye', 'More members')}
        </button>
      ) : null}
    </div>
  );
}
