import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Flame, Loader2, Trophy } from 'lucide-react';
import { api } from '../../api';
import { t } from '../../lib/i18n';

/**
 * Community → Music Quiz teaser: today's state, streak and the daily leader,
 * straight from the quiz tables. It never opens an attempt.
 */
export function QuizTeaserPanel() {
  const history = useQuery({ queryKey: ['quiz', 'history'], queryFn: () => api.quizHistory(), staleTime: 30_000 });
  const board = useQuery({ queryKey: ['quiz', 'leaderboard', 'daily'], queryFn: () => api.quizLeaderboard('daily'), staleTime: 60_000 });

  if (history.isPending) {
    return (
      <div className="taste-loading">
        <Loader2 size={16} className="spin" /> {t('Yükleniyor', 'Loading')}
      </div>
    );
  }

  const stats = history.data?.stats;
  const latest = history.data?.items[0];
  const today = new Date().toISOString().slice(0, 10);
  const playedToday = latest?.day === today;
  const leader = board.data?.rows[0];

  return (
    <div className="quiz-teaser">
      <div className="quiz-teaser-row">
        <span className="quiz-teaser-stat">
          <Flame size={14} /> {stats?.currentStreak ?? 0} {t('günlük seri', 'day streak')}
        </span>
        <span className="quiz-teaser-stat">
          <Trophy size={14} /> {stats?.totalPoints ?? 0} {t('puan', 'points')}
        </span>
      </div>
      <p className="room-mini-mine">
        {playedToday && latest
          ? t(
              `Bugün ${latest.title} — ${latest.correct ? `${latest.score} puan` : 'bilemedin'}`,
              `Today: ${latest.title} — ${latest.correct ? `${latest.score} points` : 'missed'}`,
            )
          : t('Bugünün şarkısı henüz çözülmedi.', 'Today’s song is still unsolved.')}
      </p>
      {leader ? (
        <p className="room-mini-mine">
          {t('Günün lideri', 'Daily leader')}: <strong>{leader.displayName}</strong> · {leader.points}
        </p>
      ) : null}
      <Link className="taste-more" to="/quiz">
        {playedToday ? t('Liderliği gör', 'See the leaderboard') : t('Günün şarkısını dene', 'Play today’s song')}{' '}
        <ArrowUpRight size={13} />
      </Link>
    </div>
  );
}
