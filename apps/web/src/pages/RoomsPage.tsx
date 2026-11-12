import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Headphones, Loader2, Lock, Plus, Radio, Users } from 'lucide-react';
import { api } from '../api';
import { Cover } from '../components/Cover';
import { EmptyState } from '../components/EmptyState';
import { t } from '../lib/i18n';
import { subscribeRealtime } from '../lib/presence';
import { useToastStore } from '../store/toast';

/**
 * Listening rooms hub: public rooms, your rooms, pending invitations and the
 * create form. Everything comes from the server; nothing is mocked.
 */
export function RoomsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pushToast = useToastStore((state) => state.push);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [queueMode, setQueueMode] = useState<'owner' | 'collab'>('owner');

  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api.rooms(), staleTime: 15_000 });

  useEffect(() => {
    const unsubscribe = subscribeRealtime((event) => {
      if (event.type === 'room_invite') {
        pushToast(`${event.room.ownerName} · ${t('seni bir odaya davet etti', 'invited you to a room')}`, 'info');
        void queryClient.invalidateQueries({ queryKey: ['rooms'] });
      }
    });
    return unsubscribe;
  }, [pushToast, queryClient]);

  const create = useMutation({
    mutationFn: () => api.createRoom({ name: name.trim(), visibility, queueMode }),
    onSuccess: async (result) => {
      setName('');
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      navigate(`/rooms/${result.roomId}`);
    },
    onError: (error) =>
      pushToast(error instanceof Error ? error.message : t('Oda açılamadı.', 'Could not create the room.'), 'error'),
  });

  const join = useMutation({
    mutationFn: (roomId: string) => api.joinRoom(roomId),
    onSuccess: async (_result, roomId) => {
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      navigate(`/rooms/${roomId}`);
    },
    onError: (error) =>
      pushToast(error instanceof Error ? error.message : t('Odaya katılınamadı.', 'Could not join the room.'), 'error'),
  });

  const sections = rooms.data;

  return (
    <div className="page rooms-page">
      <header className="community-hero">
        <span className="eyebrow">{t('Topluluk', 'Community')}</span>
        <h1>{t('Birlikte dinle', 'Listen together')}</h1>
        <p>
          {t(
            'Aynı anda, aynı şarkıda. Oda aç, arkadaşlarını davet et, oynatmayı birlikte yönet.',
            'Same song, same second. Open a room, invite your friends, drive playback together.',
          )}
        </p>
      </header>

      <section className="content-section" aria-label={t('Oda aç', 'Create room')}>
        <div className="section-heading">
          <div>
            <h2>
              <Plus size={18} /> {t('Yeni oda', 'New room')}
            </h2>
            <p>{t('Adı sen koy, kimin girebileceğine sen karar ver.', 'Name it and decide who can join.')}</p>
          </div>
        </div>
        <form
          className="room-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length >= 2) create.mutate();
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 60))}
            placeholder={t('Oda adı', 'Room name')}
            aria-label={t('Oda adı', 'Room name')}
            maxLength={60}
          />
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'private')}>
            <option value="public">{t('Herkese açık', 'Public')}</option>
            <option value="private">{t('Özel (davet / kod)', 'Private (invite / code)')}</option>
          </select>
          <select value={queueMode} onChange={(event) => setQueueMode(event.target.value as 'owner' | 'collab')}>
            <option value="owner">{t('Sıra: yalnız yönetici', 'Queue: staff only')}</option>
            <option value="collab">{t('Sıra: herkes ekleyebilir', 'Queue: anyone can add')}</option>
          </select>
          <button type="submit" className="button" disabled={create.isPending || name.trim().length < 2}>
            {create.isPending ? <Loader2 size={15} className="spin" /> : <Radio size={15} />}
            {t('Oda aç', 'Create room')}
          </button>
        </form>
      </section>

      {rooms.isPending ? (
        <div className="taste-loading">
          <Loader2 size={18} className="spin" /> {t('Yükleniyor', 'Loading')}
        </div>
      ) : null}

      {sections && sections.invites.length > 0 ? (
        <section className="content-section" aria-label={t('Davetler', 'Invitations')}>
          <div className="section-heading">
            <div>
              <h2>{t('Davetler', 'Invitations')}</h2>
              <p>{t('Arkadaşların seni bekliyor.', 'Your friends are waiting.')}</p>
            </div>
          </div>
          <div className="rooms-grid">
            {sections.invites.map((room) => (
              <article className="room-card is-invite" key={room.id}>
                <span className="room-card-icon">
                  <Lock size={16} />
                </span>
                <div className="room-card-copy">
                  <strong>{room.name}</strong>
                  <small>
                    {room.ownerName} · {room.memberCount} {t('kişi', 'people')}
                  </small>
                </div>
                <button type="button" className="button compact" onClick={() => join.mutate(room.id)}>
                  {t('Katıl', 'Join')}
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {sections && sections.mine.length > 0 ? (
        <section className="content-section" aria-label={t('Odalarım', 'My rooms')}>
          <div className="section-heading">
            <div>
              <h2>{t('Odaların', 'Your rooms')}</h2>
              <p>{t('Şu an içinde olduğun odalar.', 'Rooms you are currently part of.')}</p>
            </div>
          </div>
          <div className="rooms-grid">
            {sections.mine.map((room) => (
              <Link className="room-card" key={room.id} to={`/rooms/${room.id}`}>
                <Cover
                  src={room.nowPlaying?.coverUrl ?? null}
                  alt=""
                  seed={room.id}
                  className="room-card-cover"
                  iconSize={18}
                />
                <div className="room-card-copy">
                  <strong>{room.name}</strong>
                  <small>
                    {room.nowPlaying
                      ? `${room.nowPlaying.title} · ${room.nowPlaying.artist}`
                      : t('Henüz şarkı yok', 'No track yet')}
                  </small>
                </div>
                <span className="room-card-members">
                  <Users size={13} /> {room.memberCount}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="content-section" aria-label={t('Açık odalar', 'Public rooms')}>
        <div className="section-heading">
          <div>
            <h2>{t('Açık odalar', 'Public rooms')}</h2>
            <p>{t('Katılmak için bir oda seç. Özel odalar burada görünmez.', 'Pick a room to join. Private rooms never appear here.')}</p>
          </div>
        </div>
        {sections && sections.publicRooms.length === 0 ? (
          <EmptyState
            icon={Headphones}
            title={t('Şu an açık oda yok.', 'No public rooms right now.')}
            description={t('İlk odayı sen aç, arkadaşların katılsın.', 'Open the first one and let your friends join.')}
            compact
          />
        ) : (
          <div className="rooms-grid">
            {sections?.publicRooms.map((room) => (
              <article className="room-card" key={room.id}>
                <Cover
                  src={room.nowPlaying?.coverUrl ?? null}
                  alt=""
                  seed={room.id}
                  className="room-card-cover"
                  iconSize={18}
                />
                <div className="room-card-copy">
                  <strong>{room.name}</strong>
                  <small>
                    {room.ownerName} · {room.memberCount} {t('kişi', 'people')}
                  </small>
                  <small className="room-card-track">
                    {room.nowPlaying ? `${room.nowPlaying.title} · ${room.nowPlaying.artist}` : t('Sessiz', 'Quiet')}
                  </small>
                </div>
                <button type="button" className="button ghost compact" onClick={() => join.mutate(room.id)}>
                  {t('Katıl', 'Join')}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
