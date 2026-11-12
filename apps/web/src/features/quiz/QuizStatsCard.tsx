import { useQuery } from '@tanstack/react-query';
import { Award, Flame, Trophy } from 'lucide-react';
import { api } from '../../api';
import { t } from '../../lib/i18n';
import type { QuizStats } from '../../types';

const ACHIEVEMENTS: Record<string, { tr: string; en: string }> = {
  first_correct: { tr: 'İlk doğru', en: 'First correct' },
  five_correct: { tr: '5 doğru', en: '5 correct' },
  perfect_clip: { tr: '1 sn klip', en: '1s clip' },
  streak_3: { tr: '3 günlük seri', en: '3 day streak' },
  streak_7: { tr: '7 günlük seri', en: '7 day streak' },
};

/**
 * Quiz stats on a profile. The server decides visibility; a 403 simply renders
 * nothing, so private accounts never leak their numbers.
 */
export function QuizStatsCard({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ['quiz', 'stats', userId],
    queryFn: () => api.quizStats(userId),
    retry: false,
    staleTime: 60_000,
  });

  if (query.isPending || query.isError || !query.data) return null;
  const stats: QuizStats = query.data.stats;
  if (stats.dailyPlayed === 0 && stats.totalCorrect === 0) return null;

  return (
    <section className="content-section quiz-profile" aria-label={t('Müzik yarışması istatistikleri', 'Music quiz stats')}>
      <div className="section-heading">
        <div>
          <h2>
            <Trophy size={17} /> {t('Müzik Yarışması', 'Music Quiz')}
          </h2>
          <p>{t('Yarışma istatistikleri dinleme geçmişinden ayrı tutulur.', 'Quiz statistics stay separate from listening history.')}</p>
        </div>
      </div>
      <div className="quiz-profile-grid">
        <div>
          <strong>{stats.totalPoints}</strong>
          <span>{t('toplam puan', 'total points')}</span>
        </div>
        <div>
          <strong>{stats.totalCorrect}</strong>
          <span>{t('doğru tahmin', 'correct guesses')}</span>
        </div>
        <div>
          <strong>{stats.averagePreviewSeconds === null ? '—' : `${stats.averagePreviewSeconds}s`}</strong>
          <span>{t('ortalama klip', 'average clip')}</span>
        </div>
        <div>
          <strong>
            <Flame size={14} /> {stats.currentStreak}
          </strong>
          <span>{t('günlük seri', 'day streak')}</span>
        </div>
        <div>
          <strong>{stats.bestStreak}</strong>
          <span>{t('en iyi seri', 'best streak')}</span>
        </div>
      </div>
      <div className="taste-chips">
        {stats.achievements.map((achievement) => (
          <span
            key={achievement.key}
            className={`taste-chip ${achievement.unlocked ? 'is-unlocked' : 'is-locked'}`}
            title={t('Başarım', 'Achievement')}
          >
            <Award size={11} />{' '}
            {ACHIEVEMENTS[achievement.key] ? t(ACHIEVEMENTS[achievement.key]!.tr, ACHIEVEMENTS[achievement.key]!.en) : achievement.key}
          </span>
        ))}
      </div>
    </section>
  );
}
