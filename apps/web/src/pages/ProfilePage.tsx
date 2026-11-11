import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Camera, Image as ImageIcon, LogOut, Pencil, Settings2, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { api } from '../api';
import { FriendButton } from '../features/community/FriendButton';
import { BlockButton } from '../features/community/BlockButton';
import { ProfilePresence } from '../features/community/ProfilePresence';
import { EmptyState } from '../components/EmptyState';
import { ImageCropEditor } from '../components/ImageCropEditor';
import { PlaylistCard } from '../components/PlaylistCard';
import { Modal } from '../components/Modal';
import { useMusicData } from '../MusicDataContext';
import { getAppLanguage } from '../lib/i18n';
import { useAuthStore } from '../store/auth';
import { useFavorites } from '../store/favorites';
import { useToastStore } from '../store/toast';
import { formatCount, formatLongDuration } from '../lib/format';
import type { PlaylistSummary, User } from '../types';

function validateImageFile(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Yalnızca JPEG, PNG veya WebP görseller desteklenir.';
  if (file.size > 20 * 1024 * 1024) return 'Görsel en fazla 20 MB olabilir.';
  return null;
}

function EditProfileDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const updateUser = useAuthStore((state) => state.updateUser);
  const pushToast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username ?? '');
  const [bio, setBio] = useState(user.bio);
  const [genres, setGenres] = useState(user.favoriteGenres.join(', '));
  const [visibility, setVisibility] = useState<'public' | 'private'>(user.profileVisibility);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [bannerUrl, setBannerUrl] = useState(user.bannerUrl);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ kind: 'avatar' | 'banner'; url: string } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const language = getAppLanguage();

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const openEditor = (kind: 'avatar' | 'banner', file: File) => {
    const error = validateImageFile(file);
    if (error) {
      pushToast(error, 'error');
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    setEditor({ kind, url: objectUrlRef.current });
  };

  const save = async () => {
    if (!/^[a-z0-9_.]{3,30}$/.test(username.trim().toLocaleLowerCase('tr'))) {
      pushToast('Kullanıcı adı 3-30 karakter olmalı: küçük harfler, rakamlar, alt çizgi veya nokta.', 'error');
      return;
    }
    setSaving(true);
    try {
      const result = await api.updateProfile({
        displayName,
        username: username.trim().toLocaleLowerCase('tr'),
        bio,
        avatarUrl,
        bannerUrl,
        profileVisibility: visibility,
        favoriteGenres: genres.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 10),
      });
      updateUser(result.user);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profile'] }),
        queryClient.invalidateQueries({ queryKey: ['playlists'] }),
      ]);
      pushToast('Profil kaydedildi.', 'success');
      onClose();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Profil kaydedilemedi.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Profili düzenle"
      description="Profil bilgileriniz hesap genelinde senkronize edilir."
      className="profile-edit-modal"
      footer={
        <>
          <button type="button" className="button ghost" onClick={onClose} disabled={saving}>İptal</button>
          <button type="button" className="button primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="profile-edit-grid">
        <label className="field">
          <span>Görünen ad</span>
          <input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label className="field">
          <span>Kullanıcı adı</span>
          <input value={username} maxLength={30} onChange={(event) => setUsername(event.target.value.toLocaleLowerCase('tr'))} placeholder="ornek_kullanici" />
        </label>
        <label className="field full">
          <span>Biyografi</span>
          <textarea value={bio} maxLength={500} rows={3} onChange={(event) => setBio(event.target.value)} />
        </label>
        <label className="field full">
          <span>Favori türler</span>
          <input value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Türkçe Pop, Rock, Elektronik" />
        </label>
        <label className="field">
          <span>Profil görünürlüğü</span>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as 'public' | 'private')}>
            <option value="public">Herkese açık</option>
            <option value="private">Özel</option>
          </select>
        </label>
        <section className="field full profile-image-upload" aria-label={language === 'en' ? 'Profile picture' : 'Profil fotoğrafı'}>
          <span>{language === 'en' ? 'Profile Picture (750 × 750)' : 'Profil Fotoğrafı (750 × 750)'}</span>
          <div className="profile-image-preview">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="profile-avatar profile-avatar-fallback">{user.displayName.slice(0, 2).toLocaleUpperCase('tr')}</span>}
          </div>
          <div className="profile-image-actions">
            <button type="button" className="button secondary compact" onClick={() => avatarInputRef.current?.click()}>
              <Camera size={15} /> {language === 'en' ? 'Edit Profile Picture' : 'Profil Fotoğrafını Düzenle'}
            </button>
            {avatarUrl ? (
              <button type="button" className="button ghost compact" onClick={() => setAvatarUrl(null)}>
                <Trash2 size={15} /> {language === 'en' ? 'Remove' : 'Kaldır'}
              </button>
            ) : null}
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) openEditor('avatar', file);
            }}
          />
        </section>
        <section className="field full profile-image-upload" aria-label={language === 'en' ? 'Banner' : 'Banner'}>
          <span>{language === 'en' ? 'Banner (2660 × 1140)' : 'Banner (2660 × 1140)'}</span>
          <div className="profile-banner-preview">
            {bannerUrl ? <img src={bannerUrl} alt="" /> : <span className="settings-hint">Banner bulunmuyor</span>}
          </div>
          <div className="profile-image-actions">
            <button type="button" className="button secondary compact" onClick={() => bannerInputRef.current?.click()}>
              <ImageIcon size={15} /> {language === 'en' ? 'Edit Banner' : 'Banner Düzenle'}
            </button>
            {bannerUrl ? (
              <button type="button" className="button ghost compact" onClick={() => setBannerUrl(null)}>
                <Trash2 size={15} /> {language === 'en' ? 'Remove' : 'Kaldır'}
              </button>
            ) : null}
          </div>
          <input
            ref={bannerInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) openEditor('banner', file);
            }}
          />
        </section>
      </div>
      {editor ? (
        <ImageCropEditor
          imageUrl={editor.url}
          outputWidth={editor.kind === 'avatar' ? 750 : 2660}
          outputHeight={editor.kind === 'avatar' ? 750 : 1140}
          shape={editor.kind === 'avatar' ? 'circle' : 'wide'}
          title={editor.kind === 'avatar' ? (language === 'en' ? 'Edit Profile Picture' : 'Profil Fotoğrafını Düzenle') : (language === 'en' ? 'Edit Banner' : 'Banner Düzenle')}
          onCancel={() => setEditor(null)}
          onSave={(dataUrl) => {
            if (editor.kind === 'avatar') setAvatarUrl(dataUrl);
            else setBannerUrl(dataUrl);
            setEditor(null);
          }}
        />
      ) : null}
    </Modal>
  );
}

export function ProfilePage() {
  const { id, username } = useParams<{ id?: string; username?: string }>();
  const { playlists } = useMusicData();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const favoriteIds = useFavorites((state) => state.ids);
  const pushToast = useToastStore((state) => state.push);
  const [editing, setEditing] = useState(false);

  const isOwn = (!id && !username) || id === user?.id || username === user?.username;
  const publicProfileQuery = useQuery({
    queryKey: username ? ['profile', 'username', username] : ['profile', id],
    queryFn: () => (username ? api.publicProfileByUsername(username) : api.publicProfile(id ?? '')),
    enabled: Boolean(username || id) && !isOwn,
    staleTime: 30_000,
    retry: false,
  });
  const historyStatsQuery = useQuery({
    queryKey: ['history-stats'],
    queryFn: api.historyStats,
    enabled: isOwn,
    staleTime: 30_000,
  });
  const followsQuery = useQuery({
    queryKey: ['artist-follows'],
    queryFn: api.artistFollows,
    enabled: isOwn,
    staleTime: 30_000,
  });

  if (!isOwn && publicProfileQuery.isPending) {
    return <div className="page"><div className="skeleton line-skeleton" aria-busy="true" /></div>;
  }

  if (!isOwn && (publicProfileQuery.error || !publicProfileQuery.data)) {
    return (
      <div className="page">
        <EmptyState
          icon={UserRound}
          title="Profil bulunamadı."
          description="Bu profil gizli olabilir veya kaldırılmış olabilir."
          action={<Link to="/" className="button primary">Ana sayfaya dön</Link>}
        />
      </div>
    );
  }

  const profile = isOwn
    ? {
        displayName: user?.displayName || user?.email?.split('@')[0] || 'kullanıcı',
        username: user?.username ?? null,
        bio: user?.bio ?? '',
        avatarUrl: user?.avatarUrl ?? null,
        bannerUrl: user?.bannerUrl ?? null,
        profileVisibility: user?.profileVisibility ?? 'public',
        favoriteGenres: user?.favoriteGenres ?? [],
        role: user?.role ?? 'user',
        publicPlaylistCount: playlists.filter((playlist) => playlist.visibility === 'public').length,
        followedArtistCount: followsQuery.data?.follows.length ?? 0,
      }
    : publicProfileQuery.data!.profile;

  const publicPlaylists: PlaylistSummary[] = isOwn
    ? playlists.filter((playlist) => playlist.visibility === 'public')
    : publicProfileQuery.data!.playlists;
  const name = profile.displayName;
  const initials = name.slice(0, 2).toLocaleUpperCase('tr');
  const totalPlays = historyStatsQuery.data?.totalPlays ?? 0;
  const totalMs = historyStatsQuery.data?.totalMs ?? 0;

  return (
    <div className="page profile-page">
      <header className="page-heading">
        <span className="eyebrow">Profil</span>
        <h1>{isOwn ? 'Profilin' : `${name} profili`}</h1>
      </header>

      <section className="profile-hero">
        {profile.bannerUrl ? (
          <div className="profile-banner" style={{ backgroundImage: `url(${profile.bannerUrl})` }} aria-hidden="true" />
        ) : null}
        <div className="profile-hero-content">
          {profile.avatarUrl ? (
            <img className="profile-avatar" src={profile.avatarUrl} alt="" />
          ) : (
            <div className="profile-avatar profile-avatar-fallback" aria-hidden="true">{initials}</div>
          )}
          <div className="profile-copy">
            <h2>{name}</h2>
            <p>
              {profile.username ? `@${profile.username} · ` : (isOwn ? 'Kullanıcı adın henüz ayarlanmadı · ' : '')}
              {profile.role === 'admin' ? 'Yönetici' : 'Üye'}
              {isOwn && profile.profileVisibility === 'private' ? <ShieldCheck size={14} aria-label="Özel profil" /> : null}
            </p>
            {isOwn && !profile.username ? (
              <p className="settings-hint">Herkese açık profil bağlantın için bir kullanıcı adı belirle. Mevcut hesabın, parolan ve içeriklerin aynen korunur.</p>
            ) : null}
            {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
            {profile.favoriteGenres.length ? (
              <div className="profile-genres" aria-label="Favori türler">
                {profile.favoriteGenres.map((genre) => <span key={genre}>{genre}</span>)}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="profile-stats" aria-label="Profil istatistikleri">
        <span><strong>{formatCount(profile.publicPlaylistCount)}</strong><small>Herkese açık liste</small></span>
        <span><strong>{formatCount(favoriteIds.length)}</strong><small>Favori parça</small></span>
        <span><strong>{formatCount(profile.followedArtistCount)}</strong><small>Takip edilen sanatçı</small></span>
        {isOwn ? (
          <span><strong>{formatCount(totalPlays)}</strong><small>Dinleme</small></span>
        ) : null}
        {isOwn && totalMs ? <span><strong>{formatLongDuration(totalMs / 1000)}</strong><small>Dinleme süresi</small></span> : null}
      </section>

      {isOwn ? (
        <div className="profile-actions">
          <button type="button" className="button primary" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Profili düzenle
          </button>
          <Link to="/settings" className="button secondary"><Settings2 size={16} /> Ayarlar</Link>
          <button type="button" className="button ghost" onClick={() => void logout().catch(() => pushToast('Çıkış yapılamadı.', 'error'))}>
            <LogOut size={16} /> Çıkış yap
          </button>
        </div>
      ) : (
        <div className="profile-actions">
          <FriendButton
            userId={publicProfileQuery.data?.profile.id ?? ''}
            initial={publicProfileQuery.data?.relationship ?? null}
          />
          <BlockButton
            userId={publicProfileQuery.data?.profile.id ?? ''}
            initial={publicProfileQuery.data?.relationship ?? null}
          />
        </div>
      )}

      {!isOwn && publicProfileQuery.data?.profile.id ? (
        <ProfilePresence userId={publicProfileQuery.data.profile.id} />
      ) : null}

      <section className="content-section">
        <div className="section-heading">
          <div><h2>{isOwn ? 'Herkese açık listelerin' : 'Herkese açık listeleri'}</h2><p>Yalnızca herkese açık olarak işaretlenen listeler görünür.</p></div>
          {isOwn ? <Link to="/library?tab=playlists" className="section-link">Tümünü gör <ArrowRight size={15} /></Link> : null}
        </div>
        {publicPlaylists.length > 0 ? (
          <div className="card-grid playlist-grid">
            {publicPlaylists.slice(0, 4).map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} />)}
          </div>
        ) : (
          <EmptyState
            icon={<Camera size={22} />}
            title="Henüz herkese açık liste yok."
            description="Bir listeyi herkese açık yaparak beğendiklerini başkalarıyla paylaşabilirsin."
            action={isOwn ? <Link to="/library?tab=playlists" className="button primary">Listeleri aç</Link> : undefined}
          />
        )}
      </section>

      {editing && user ? <EditProfileDialog user={user} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
