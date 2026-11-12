import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Award,
  Flame,
  Headphones,
  Loader2,
  Music4,
  Play,
  Radio,
  RotateCcw,
  SkipForward,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { api } from '../api';
import { Cover } from '../components/Cover';
import { t } from '../lib/i18n';
import { useToastStore } from '../store/toast';
import type { QuizAttempt, QuizCategory, QuizHistoryEntry, QuizLeaderboardRow, QuizStats } from '../types';

type Tab = 'daily' | 'practice' | 'leaderboard' | 'party';
const CATEGORIES: Array<{ key: QuizCategory; tr: string; en: string }> = [
  { key: 'mixed', tr: 'Karışık', en: 'Mixed' },
  { key: 'tr', tr: 'Türkçe', en: 'Turkish' },
  { key: 'intl', tr: 'Uluslararası', en: 'International' },
];
const RANGES: Array<{ key: 'daily' | 'weekly' | 'monthly' | 'all' | 'friends'; tr: string; en: string }> = [
  { key: 'daily', tr: 'Günlük', en: 'Daily' },
  { key: 'weekly', tr: 'Haftalık', en: 'Weekly' },
  { key: 'monthly', tr: 'Aylık', en: 'Monthly' },
  { key: 'all', tr: 'Tüm zamanlar', en: 'All time' },
  { key: 'friends', tr: 'Arkadaşlar', en: 'Friends' },
];

function secondsLabel(value: number | null): string {
  if (value === null) return '—';
  return `${value}s`;
}

/**
 * Music Quiz.
 *
 * The answer never reaches this component before the attempt is over: the API
 * only returns the stage, a short-lived preview URL and, once finished, the song.
 */
export function QuizPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pushToast = useToastStore((state) => state.push);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [tab, setTab] = useState<Tab>('daily');
  const [category, setCategory] = useState<QuizCategory>('mixed');
  const [view, setView] = useState<QuizAttempt | null>(null);
  const [guess, setGuess] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const [range, setRange] = useState<'daily' | 'weekly' | 'monthly' | 'all' | 'friends'>('weekly');
  const [partyCategory, setPartyCategory] = useState<QuizCategory>('mixed');
  const [joinCode, setJoinCode] = useState('');

  const pool = useQuery({ queryKey: ['quiz', 'pool'], queryFn: () => api.quizPool(), staleTime: 60_000 });
  const daily = useQuery({
    queryKey: ['quiz', 'daily', category],
    queryFn: () => api.quizDaily(category),
    retry: false,
    staleTime: 30_000,
  });
  const history = useQuery({ queryKey: ['quiz', 'history'], queryFn: () => api.quizHistory(), staleTime: 30_000 });
  const board = useQuery({
    queryKey: ['quiz', 'leaderboard', range],
    queryFn: () => api.quizLeaderboard(range),
    staleTime: 30_000,
  });
  const parties = useQuery({ queryKey: ['quiz', 'parties'], queryFn: () => api.quizParties(), staleTime: 15_000 });

  useEffect(() => {
    if (daily.data) {
      setView(daily.data);
      setFeedback(null);
    }
  }, [daily.data]);

  useEffect(() => {
    if (tab !== 'practice' || view?.mode === 'practice') return;
    let cancelled = false;
    void api
      .quizPractice(category)
      .then((attempt) => {
        if (!cancelled) setView(attempt);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, category]);

  useEffect(() => {
    if (tab !== 'daily') return;
    void daily.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, category]);

  useEffect(() => {
    if (guess.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .quizSuggest(guess.trim())
        .then((result) => setSuggestions(result.suggestions))
        .catch(() => setSuggestions([]));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [guess]);

  const playPreview = useCallback(() => {
    if (!view?.previewUrl) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = view.previewUrl;
    audio.currentTime = 0;
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        setPlaying(false);
        pushToast(t('Tarayıcı sesi engelledi; tekrar bas.', 'The browser blocked audio; press play again.'), 'error');
      });
  }, [pushToast, view?.previewUrl]);

  const applyResult = useCallback(
    (result: { view: QuizAttempt }, message?: { tone: 'ok' | 'bad' | 'warn'; text: string }) => {
      setView(result.view);
      if (message) setFeedback(message);
      if (result.view.status !== 'active') {
        void queryClient.invalidateQueries({ queryKey: ['quiz', 'history'] });
        void queryClient.invalidateQueries({ queryKey: ['quiz', 'leaderboard'] });
      }
    },
    [queryClient],
  );

  const submit = useCallback(async () => {
    if (!view || view.status !== 'active' || busy) return;
    const value = guess.trim();
    if (!value) return;
    setBusy(true);
    try {
      const result = await api.quizGuess(view.attemptId, value);
      setGuess('');
      if (result.kind === 'correct') {
        applyResult(result, {
          tone: 'ok',
          text: t(`Doğru! +${result.points} puan`, `Correct! +${result.points} points`),
        });
      } else if (result.kind === 'wrong') {
        applyResult(result, {
          tone: 'bad',
          text:
            result.view.status === 'lost'
              ? t('Hakkın kalmadı; şarkı açıklandı.', 'No guesses left; the song is revealed.')
              : t('Yanlış. Daha uzun bir klip açıldı.', 'Wrong. A longer clip is unlocked.'),
        });
      } else {
        applyResult(result, { tone: 'warn', text: result.message });
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Tahmin gönderilemedi.', 'The guess was not accepted.'), 'error');
    } finally {
      setBusy(false);
    }
  }, [applyResult, busy, guess, pushToast, view]);

  const skip = useCallback(async () => {
    if (!view || view.status !== 'active' || busy) return;
    setBusy(true);
    try {
      const result = await api.quizSkip(view.attemptId);
      applyResult(result, { tone: 'warn', text: t('Atlandı; sıradaki klip açıldı.', 'Skipped; the next clip is unlocked.') });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Atlanamadı.', 'Could not skip.'), 'error');
    } finally {
      setBusy(false);
    }
  }, [applyResult, busy, pushToast, view]);

  const newPractice = useCallback(async () => {
    setBusy(true);
    try {
      const attempt = await api.quizPractice(category, true);
      setView(attempt);
      setFeedback(null);
      setGuess('');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Yeni şarkı açılamadı.', 'Could not start a new song.'), 'error');
    } finally {
      setBusy(false);
    }
  }, [category, pushToast]);

  const createParty = useCallback(async () => {
    setBusy(true);
    try {
      const party = await api.quizCreateParty(partyCategory);
      navigate(`/quiz/party/${party.id}`);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t('Parti açılamadı.', 'Could not create the party.'), 'error');
    } finally {
      setBusy(false);
    }
  }, [navigate, partyCategory, pushToast]);

  const joinParty = useCallback(
    async (partyId: string, code: string) => {
      try {
        await api.quizJoinParty(partyId, code);
        navigate(`/quiz/party/${partyId}`);
      } catch (error) {
        pushToast(error instanceof Error ? error.message : t('Partiye katılınamadı.', 'Could not join the party.'), 'error');
      }
    },
    [navigate, pushToast],
  );

  const stats: QuizStats | null = history.data?.stats ?? null;
  const historyItems: QuizHistoryEntry[] = history.data?.items ?? [];
  const poolEmpty = (pool.data?.size ?? 0) === 0;

  const currentStageDuration = view?.previewDuration ?? 1;

  return (
    <div className="page quiz-page">
      <header className="community-hero">
        <span className="eyebrow">{t('Topluluk', 'Community')}</span>
        <h1>{t('Müzik Yarışması', 'Music Quiz')}</h1>
        <p>
          {t(
            'Şarkıyı 1 saniyelik klipten tanı. Her yanlış cevap bir sonraki, daha uzun klibi açar.',
            'Name the song from a one-second clip. Every wrong guess unlocks a longer one.',
          )}
        </p>
        <div className="community-hero-meta">
          <span className="status-pill">
            <Music4 size={13} /> {pool.data?.size ?? 0} {t('şarkı havuzda', 'songs in the pool')}
          </span>
          {stats ? (
            <span className="status-pill">
              <Flame size={13} /> {stats.currentStreak} {t('günlük seri', 'day streak')}
            </span>
          ) : null}
        </div>
      </header>

      {poolEmpty ? (
        <section className="content-section">
          <div className="taste-optin">
            <Headphones size={20} />
            <div>
              <strong>{t('Önce biraz müzik gerekiyor.', 'Some music is needed first.')}</strong>
              <p>
                {t(
                  'Yarışma yalnızca kütüphanendeki gerçek dosyaları kullanır. En az 20 saniyelik birkaç parça ekle.',
                  'The quiz only uses real files from your library. Add a few tracks of at least 20 seconds.',
                )}
              </p>
            </div>
            <Link className="button" to="/library">
              {t('Kütüphaneye git', 'Open library')}
            </Link>
          </div>
        </section>
      ) : null}

      <div className="quiz-tabs" role="tablist">
        {(['daily', 'practice', 'leaderboard', 'party'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`room-tab ${tab === key ? 'is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {key === 'daily'
              ? t('Günün Şarkısı', 'Daily Song')
              : key === 'practice'
                ? t('Pratik', 'Practice')
                : key === 'leaderboard'
                  ? t('Liderlik', 'Leaderboard')
                  : t('Arkadaşlarla', 'With friends')}
          </button>
        ))}
      </div>

      {tab === 'daily' || tab === 'practice' ? (
        <section className="quiz-stage" aria-label={t('Oyun', 'Game')}>
          <div className="quiz-category-row">
            {CATEGORIES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`taste-chip ${category === entry.key ? 'is-selected' : ''}`}
                onClick={() => {
                  setCategory(entry.key);
                  setView(null);
                  setFeedback(null);
                  setGuess('');
                }}
              >
                {t(entry.tr, entry.en)}
              </button>
            ))}
            {tab === 'daily' && daily.data?.resetsAt ? (
              <span className="quiz-reset">
                {t('Sıfırlanma', 'Resets')}:{' '}
                {new Date(daily.data.resetsAt).toLocaleString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  day: '2-digit',
                  month: 'short',
                })}{' '}
                (TSİ)
              </span>
            ) : null}
          </div>

          {!view ? (
            <div className="taste-loading">
              <Loader2 size={18} className="spin" /> {t('Şarkı hazırlanıyor', 'Preparing the song')}
            </div>
          ) : (
            <>
              <div className="quiz-head">
                <div>
                  <span className="eyebrow">
                    {tab === 'daily' ? t('Günün şarkısı', 'Daily song') : t('Pratik', 'Practice')}
                  </span>
                  <h2>
                    {view.status === 'active'
                      ? t('Bu şarkı hangisi?', 'Which song is this?')
                      : view.status === 'won'
                        ? t('Bildin!', 'You got it!')
                        : t('Şarkı açıklandı', 'Song revealed')}
                  </h2>
                </div>
                <div className="quiz-stage-meter" aria-label={`${t('Klip', 'Clip')} ${view.stage + 1}/${view.stageCount}`}>
                  <span>
                    {t('Klip', 'Clip')} {view.status === 'active' ? view.stage + 1 : Math.min(view.stage + 1, view.stageCount)}/
                    {view.stageCount}
                  </span>
                  <div className="quiz-stage-bars">
                    {Array.from({ length: view.stageCount }, (_, index) => (
                      <span
                        key={index}
                        className={
                          view.status === 'active'
                            ? index <= view.stage
                              ? 'is-on'
                              : ''
                            : index <= view.stage
                              ? 'is-done'
                              : ''
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>

              {view.status === 'active' ? (
                <>
                  <div className="quiz-clip">
                    <button type="button" className="quiz-play" onClick={playPreview} aria-label={t('Klibi çal', 'Play clip')}>
                      {playing ? <RotateCcw size={26} /> : <Play size={26} fill="currentColor" />}
                    </button>
                    <div className="quiz-clip-copy">
                      <strong>
                        {currentStageDuration} {t('saniyelik klip', 'second clip')}
                      </strong>
                      <small>
                        {t('Kalan hak', 'Guesses left')}: {view.attemptsLeft} · {t('Olası puan', 'Possible points')}:{' '}
                        {view.possiblePoints}
                      </small>
                    </div>
                  </div>

                  <div className="quiz-input-row">
                    <input
                      type="text"
                      list="quiz-suggestions"
                      value={guess}
                      onChange={(event) => setGuess(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void submit();
                      }}
                      placeholder={t('Şarkı adı veya sanatçı', 'Song title or artist')}
                      aria-label={t('Tahmin', 'Guess')}
                      maxLength={120}
                    />
                    <datalist id="quiz-suggestions">
                      {suggestions.map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                    <button type="button" className="button" onClick={() => void submit()} disabled={busy || !guess.trim()}>
                      {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                      {t('Tahmin et', 'Guess')}
                    </button>
                    <button
                      type="button"
                      className="button ghost compact"
                      onClick={() => void skip()}
                      disabled={busy || view.stage >= view.stageCount - 1}
                    >
                      <SkipForward size={14} /> {t('Atla', 'Skip')}
                    </button>
                  </div>

                  {feedback ? <p className={`quiz-feedback is-${feedback.tone}`}>{feedback.text}</p> : null}
                </>
              ) : (
                <div className="quiz-result">
                  <Cover
                    src={view.result?.coverUrl ?? null}
                    alt=""
                    seed={view.result?.title ?? 'quiz'}
                    className="quiz-result-cover"
                    iconSize={28}
                  />
                  <div className="quiz-result-copy">
                    <span className="eyebrow">{view.status === 'won' ? t('Doğru cevap', 'Correct answer') : t('Cevap', 'Answer')}</span>
                    <strong>{view.result?.title}</strong>
                    <span>{view.result?.artist}</span>
                  </div>
                  <div className="quiz-result-score">
                    <strong>+{view.score}</strong>
                    <small>{t('puan', 'points')}</small>
                  </div>
                </div>
              )}

              {view.status !== 'active' && tab === 'practice' ? (
                <div className="quiz-actions">
                  <button type="button" className="button" onClick={() => void newPractice()} disabled={busy}>
                    {busy ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
                    {t('Sıradaki şarkı', 'Next song')}
                  </button>
                </div>
              ) : null}

              {view.status !== 'active' && tab === 'daily' ? (
                <p className="quiz-note">
                  {t(
                    'Günün şarkısı günde bir kez puanlanır. Yarın yeni bir şarkı gelir.',
                    'The daily song scores once per day. A new song arrives tomorrow.',
                  )}
                </p>
              ) : null}
            </>
          )}

          <audio ref={audioRef} preload="none" onEnded={() => setPlaying(false)} className="quiz-audio" />

          <div className="quiz-side">
            <div className="quiz-streak-card">
              <Flame size={18} />
              <strong>{stats?.currentStreak ?? 0}</strong>
              <span>{t('günlük seri', 'day streak')}</span>
              <small>
                {t('En iyi', 'Best')}: {stats?.bestStreak ?? 0} · {t('Toplam puan', 'Total points')}:{' '}
                {stats?.totalPoints ?? 0}
              </small>
            </div>
            {historyItems.length > 0 ? (
              <ul className="quiz-history">
                {historyItems.slice(0, 5).map((entry) => (
                  <li key={`${entry.day}-${entry.category}`} className={entry.correct ? 'is-correct' : ''}>
                    <span>{entry.day.slice(5)}</span>
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.score} {t('puan', 'pts')}
                      {entry.previewSeconds ? ` · ${entry.previewSeconds}s` : ''}
                    </small>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === 'leaderboard' ? (
        <section className="content-section" aria-label={t('Liderlik', 'Leaderboard')}>
          <div className="quiz-category-row">
            {RANGES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`taste-chip ${range === entry.key ? 'is-selected' : ''}`}
                onClick={() => setRange(entry.key)}
              >
                {t(entry.tr, entry.en)}
              </button>
            ))}
          </div>
          {board.isPending ? (
            <div className="taste-loading">
              <Loader2 size={18} className="spin" /> {t('Yükleniyor', 'Loading')}
            </div>
          ) : (board.data?.rows.length ?? 0) === 0 ? (
            <p className="quiz-note">{t('Bu aralıkta henüz puan yok.', 'No points in this range yet.')}</p>
          ) : (
            <ol className="quiz-board">
              {board.data?.rows.map((row: QuizLeaderboardRow) => (
                <li key={row.userId} className={row.rank <= 3 ? `is-top is-${row.rank}` : ''}>
                  <span className="quiz-rank">{row.rank}</span>
                  <Cover src={row.avatarUrl} alt="" seed={row.userId} className="quiz-board-avatar" iconSize={14} />
                  {row.username ? (
                    <Link className="quiz-board-name" to={`/u/${row.username}`}>
                      {row.displayName}
                    </Link>
                  ) : (
                    <span className="quiz-board-name">{row.displayName}</span>
                  )}
                  <span className="quiz-board-points">{row.points}</span>
                  <span className="quiz-board-meta">
                    {row.correct} {t('doğru', 'correct')} · {secondsLabel(row.averagePreviewSeconds)} · {row.streak}
                    {t('g', 'd')}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      {tab === 'party' ? (
        <section className="content-section" aria-label={t('Parti', 'Party')}>
          <div className="quiz-party-grid">
            <div className="quiz-party-card">
              <h3>
                <Trophy size={16} /> {t('Yeni parti', 'New party')}
              </h3>
              <p>{t('Arkadaşlarını davet et, aynı anda yarışın.', 'Invite friends and race at the same time.')}</p>
              <div className="quiz-category-row">
                {CATEGORIES.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`taste-chip ${partyCategory === entry.key ? 'is-selected' : ''}`}
                    onClick={() => setPartyCategory(entry.key)}
                  >
                    {t(entry.tr, entry.en)}
                  </button>
                ))}
              </div>
              <button type="button" className="button" onClick={() => void createParty()} disabled={busy}>
                {busy ? <Loader2 size={15} className="spin" /> : <Users size={15} />}
                {t('Parti oluştur', 'Create party')}
              </button>
            </div>

            <div className="quiz-party-card">
              <h3>
                <Radio size={16} /> {t('Kodla katıl', 'Join with a code')}
              </h3>
              <p>{t('Arkadaşının paylaştığı 6 haneli kodu gir.', 'Enter the 6-character code your friend shared.')}</p>
              <div className="quiz-input-row">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase().slice(0, 12))}
                  placeholder={t('Parti kodu', 'Party code')}
                  aria-label={t('Parti kodu', 'Party code')}
                />
              </div>
              <p className="quiz-note">
                {t('Bağlantıyla katılmak için davet kartını kullan.', 'Use an invite card to join by link.')}
              </p>
            </div>
          </div>

          {parties.data?.current ? (
            <p className="quiz-note">
              {t('Devam eden parti:', 'Party in progress:')}{' '}
              <Link to={`/quiz/party/${parties.data.current.id}`}>{t('Partiye dön', 'Return to party')}</Link>
            </p>
          ) : null}

          {parties.data && parties.data.invites.length > 0 ? (
            <div className="quiz-invites">
              <h3>{t('Davetler', 'Invitations')}</h3>
              {parties.data.invites.map((invite) => (
                <button
                  key={invite.id}
                  type="button"
                  className="quiz-invite-row"
                  onClick={() => void joinParty(invite.id, invite.code)}
                >
                  <Users size={14} />
                  <span>{t('Parti daveti', 'Party invitation')}</span>
                  <small>
                    {invite.category} · {invite.code}
                  </small>
                </button>
              ))}
            </div>
          ) : null}

          {joinCode.length >= 4 ? (
            <button
              type="button"
              className="button ghost compact"
              onClick={() =>
                void (async () => {
                  try {
                    const party = await api.quizJoinPartyByCode(joinCode.trim());
                    navigate(`/quiz/party/${party.id}`);
                  } catch (error) {
                    pushToast(
                      error instanceof Error ? error.message : t('Bu kodla parti bulunamadı.', 'No party with that code.'),
                      'error',
                    );
                  }
                })()
              }
            >
              {t('Kodu dene', 'Try code')}
            </button>
          ) : null}

          <div className="quiz-achievements">
            <h3>
              <Award size={16} /> {t('Başarımlar', 'Achievements')}
            </h3>
            <div className="taste-chips">
              {(stats?.achievements ?? []).map((achievement) => (
                <span key={achievement.key} className={`taste-chip ${achievement.unlocked ? 'is-unlocked' : 'is-locked'}`}>
                  {achievement.key === 'first_correct'
                    ? t('İlk doğru', 'First correct')
                    : achievement.key === 'five_correct'
                      ? t('5 doğru', '5 correct')
                      : achievement.key === 'perfect_clip'
                        ? t('1 sn klip', '1s clip')
                        : achievement.key === 'streak_3'
                          ? t('3 günlük seri', '3 day streak')
                          : t('7 günlük seri', '7 day streak')}
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
