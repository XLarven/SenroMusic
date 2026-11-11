import {
  Activity,
  CalendarDays,
  ListMusic,
  MessagesSquare,
  Music4,
  Radio,
  Sparkles,
  Trophy,
  Users,
  UsersRound,
  UserPlus,
  HeartHandshake,
} from 'lucide-react';
import { CommunitySection } from './CommunitySection';
import { PeopleSearch } from './PeopleSearch';
import { t } from '../../lib/i18n';

/**
 * Community, phase 1: the page, the navigation and the real people search.
 * Everything else is scaffolding with an explicit "coming soon" badge — no
 * fake friends, no invented online dots, no simulated chats.
 */
export function CommunityPage() {
  return (
    <div className="page community-page">
      <header className="community-hero">
        <span className="eyebrow">{t('Topluluk', 'Community')}</span>
        <h1>{t('Müziği birlikte dinle', 'Listen together')}</h1>
        <p>
          {t(
            'Arkadaşlarını bul, aynı şarkıda buluş, zevkini karşılaştır. Bu sayfa yeni topluluk özelliklerinin ilk adımı.',
            'Find your people, meet on the same song, compare taste. This page is the first step of the community features.',
          )}
        </p>
        <div className="community-hero-meta">
          <span className="status-pill">
            <Users size={14} /> {t('Aşama 1', 'Phase 1')}
          </span>
          <span className="status-pill is-warning">
            <Sparkles size={14} /> {t('Yeni özellikler yakında', 'More coming soon')}
          </span>
        </div>
      </header>

      <section className="content-section" aria-label={t('Kişiler', 'People')}>
        <div className="section-heading">
          <div>
            <h2>{t('Kişiler', 'People')}</h2>
            <p>
              {t(
                'Kayıtlı NorieMusic kullanıcılarını ara, profillerini aç.',
                'Search registered NorieMusic users and open their profiles.',
              )}
            </p>
          </div>
        </div>
        <PeopleSearch />
      </section>

      <div className="community-grid">
        <CommunitySection
          icon={UserPlus}
          title={t('Arkadaşlar', 'Friends')}
          description={t(
            'Arkadaş listesi, istekler ve ekleme akışı.',
            'Friend list, requests and adding people.',
          )}
          bullets={[
            t('Arkadaş listesi ve istekler', 'Friend list and requests'),
            t('Kullanıcı adıyla arkadaş ekleme', 'Add friends by username'),
            t('Dinleme durumu (yalnızca sen açarsan)', 'Listening status (only if you enable it)'),
          ]}
          comingSoon
        />

        <CommunitySection
          icon={MessagesSquare}
          title={t('Mesajlar', 'Messages')}
          description={t(
            'Birebir sohbetler ve müzik paylaşımı.',
            'Private conversations and sharing music.',
          )}
          bullets={[
            t('Birebir konuşmalar', 'Private chats'),
            t('Şarkı ve çalma listesi paylaşımı', 'Share songs and playlists'),
            t('Okunmamış sayacı', 'Unread counter'),
          ]}
          comingSoon
        />

        <CommunitySection
          icon={Radio}
          title={t('Birlikte Dinle', 'Listening Together')}
          description={t(
            'Aynı anda, aynı şarkıda senkron dinleme odaları.',
            'Shared rooms with synchronized playback.',
          )}
          bullets={[
            t('Dinleme odaları', 'Listening rooms'),
            t('Senkron oynatma', 'Synchronized playback'),
            t('Oda bağlantısıyla davet', 'Invite by room link'),
          ]}
          comingSoon
        />

        <CommunitySection
          icon={Activity}
          title={t('Etkinlikler', 'Activities')}
          description={t(
            'Arkadaşlarının dinledikleri ve paylaştıkları.',
            'What your friends listen to and share.',
          )}
          bullets={[
            t('Arkadaş dinleme akışı', 'Friends’ listening feed'),
            t('Paylaşılan şarkı ve listeler', 'Shared songs and playlists'),
          ]}
          comingSoon
        />

        <CommunitySection
          icon={UsersRound}
          title={t('Gruplar', 'Groups')}
          description={t(
            'Müzik toplulukları ve ortak çalma listeleri.',
            'Music communities and collaborative playlists.',
          )}
          bullets={[
            t('Temalı topluluklar', 'Themed communities'),
            t('Ortak çalma listeleri', 'Collaborative playlists'),
          ]}
          comingSoon
        />

        <CommunitySection
          icon={HeartHandshake}
          title={t('Zevk Uyumu', 'Taste Match')}
          description={t(
            'İki kullanıcı arasındaki müzik uyumu.',
            'Music compatibility between two people.',
          )}
          bullets={[
            t('Ortak sanatçı ve parçalar', 'Shared artists and tracks'),
            t('Tür bazlı uyum yüzdesi', 'Genre-based match score'),
          ]}
          comingSoon
        />

        <CommunitySection
          icon={Trophy}
          title={t('Müzik Yarışması', 'Music Quiz')}
          description={t(
            'Günün şarkısı, alıştırma ve arkadaşlarla yarış.',
            'Daily song, practice and playing with friends.',
          )}
          bullets={[
            t('Günün şarkısı', 'Daily song'),
            t('Alıştırma modu', 'Practice mode'),
            t('Liderlik tablosu', 'Leaderboard'),
            t('Arkadaşlarla oyna', 'Play with friends'),
          ]}
          comingSoon
          className="community-card-wide"
        />
      </div>

      <section className="panel community-note" aria-label={t('Yol haritası', 'Roadmap')}>
        <div>
          <h2>
            <ListMusic size={18} /> {t('Sırada ne var?', 'What comes next?')}
          </h2>
          <p>
            {t(
              'Bu aşamada yalnızca yapı hazır: gezinme, gerçek kullanıcı araması ve profil bağlantıları. Arkadaşlık, mesajlaşma ve senkron dinleme sunucu tarafında yeni uç noktalar gerektiriyor; sıradaki aşamalarda eklenecek.',
              'This phase ships the structure only: navigation, real user search and profile links. Friends, messaging and synchronized listening need new server endpoints and arrive in the next phases.',
            )}
          </p>
          <div className="community-hero-meta">
            <span className="status-pill">
              <Users size={13} /> {t('Kişiler', 'People')} · {t('hazır', 'ready')}
            </span>
            <span className="status-pill">
              <Music4 size={13} /> {t('Müzik', 'Music')} · {t('değişmedi', 'unchanged')}
            </span>
            <span className="status-pill">
              <CalendarDays size={13} /> {t('Aşama 2', 'Phase 2')} · {t('yakında', 'soon')}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
