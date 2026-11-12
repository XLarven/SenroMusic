import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Copy,
  Crown,
  Loader2,
  Play,
  SkipForward,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError } from '../api';
import { Cover } from '../components/Cover';
import { t } from '../lib/i18n';
import { subscribeRealtime } from '../lib/presence';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import type { QuizPartyState } from '../types';

/**
 * Quiz party. Rounds are opened and closed by the server clock; the client only
 * renders the shared round and sends answers that the server may still reject.
 */
export function QuizPartyPage() {
  const { partyId = '' } = useParams();
  const me = useAuthStore((state) => state.user);
  const pushToast = useToastStore((state) => state.push);

  const [state, setState] = useState<QuizPartyState | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [guess, setGuess] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; duration: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [friends, setFriends] = useState<Array<{ id: string; displayName: string; username: string | null; avatarUrl: string | null }>>([]);
  const [now, setNow] = useState(Date.now());

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const roundRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const result = await api.quizParty(partyId);
      setState(result.state);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError) setError(err);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeRealtime((event) => {
      if (event.type === 'quiz_party' && event.partyId === partyId) void load();
    });
    return unsubscribe;
  }, [load, partyId]);

  // Refresh once a round hits its end so the reveal appears promptly.
  useEffect(() => {
    if (!state?.roundEndsAt) return;
    const ends = Date.parse(state.roundEndsAt);
    if (ends <= now) return;
    const timer = window.setTimeout(() => void load(), Math.max(0, ends - Date.now()) + 600);
    return () => window.clearTimeout(timer);
  }, [load, now, state?.roundEndsAt]);

  const refreshPreview = useCallback(async (roundNo: number) => {
    try {
      const result = await api.quizPartyPreview(partyId);
      setPreview(result);
      roundRef.current = roundNo;
    } catch {
      setPreview(null);
    }
  }, [partyId]);

  useEffect(() => {
    if (!state || state.status !== 'playing' || !state.roundNo) return;
    const ended = state.roundEndsAt ? Date.parse(state.roundEndsAt) <= now : true;
    if (ended) return;
    if (roundRef.current !== state.roundNo) {
      void refreshPreview(state.roundNo);
    }
  }, [now, refreshPreview, state]);

  const playPreview = useCallback(() => {
    if (!preview?.url) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = preview.url;
    audio.currentTime = 0;
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        setPlaying(false);
        pushToast(t('Tarayıcı sesi engelledi; tekrar bas.', 'The browser blocked audio; press play again.'), 'error');
      });
  }, [preview?.url, pushToast]);

  const answer = useCallback(async () => {
    const value = guess.trim();
    if (!value || !state) return;
    setBusy(true);
    try {
      const result = await api.quizPartyAnswer(partyId, value);
      setGuess('');
      if (result.kind === 'correct') {
        setFeedback(t(`Doğru! +${result.points} puan`, `Correct! +${result.points} points`));
      } else if (result.kind === 'wrong') {
        setFeedback(t('Yanlış. Bir sonraki klip açık.', 'Wrong. The next clip is available.'));
      } else {
        setFeedback(result.message ?? t('Tahmin sayılmadı.', 'The guess did not count.'));
      }
      if (result.kind === 'wrong') await refreshPreview(state.roundNo);
      if (result.kind === 'correct') roundRef.current = 0;
      await load();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('Cevap gönderilemedi.', 'The answer was not accepted.'), 'error');
    } finally {
      setBusy(false);
    }
  }, [guess, load, partyId, pushToast, refreshPreview, state]);

  const openInvite = useCallback(async () => {
    setInviteOpen(true);
    try {
      const page = await api.friends(50, 0);
      setFriends(page.friends.items);
    } catch {
      setFriends([]);
    }
  }, []);

  async function joinNow() {
    try {
      await api.quizJoinParty(partyId, joinCode.trim() || undefined);
      setError(null);
      await load();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('Partiye katılınamadı.', 'Could not join.'), 'error');
    }
  }

  if (loading) {
    return (
      <div className="page quiz-page">
        <div className="taste-loading">
          <Loader2 size={18} className="spin" /> {t('Parti yükleniyor', 'Loading the party')}
        </div>
      </div>
    );
  }

  if (error || !state) {
    const needsJoin = error?.status === 403;
    return (
      <div className="page quiz-page">
        <Link className="button ghost compact" to="/quiz">
          <ArrowLeft size={15} /> {t('Yarışma', 'Quiz')}
        </Link>
        <div className="taste-blocked">
          <Users size={26} />
          <h2>{needsJoin ? t('Bu parti özel', 'This party is private') : t('Parti bulunamadı', 'Party not found')}</h2>
          <p>{needsJoin ? t('Katılmak için parti kodunu gir.', 'Enter the party code to join.') : t('Bağlantı geçersiz olabilir.', 'The link may be invalid.')}</p>
          {needsJoin ? (
            <div className="room-join">
              <input
                type="text"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase().slice(0, 12))}
                placeholder={t('Kod', 'Code')}
                aria-label={t('Parti kodu', 'Party code')}
              />
              <button type="button" className="button" onClick={() => void joinNow()}>
                {t('Katıl', 'Join')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const isHost = state.hostId === me?.id;
  const remaining = state.roundEndsAt ? Math.max(0, Math.ceil((Date.parse(state.roundEndsAt) - now) / 1000)) : 0;
  const answered = state.yourAnswers;
  const attemptsLeft = Math.max(0, 5 - answered);
  const roundEnded = state.roundEndsAt ? Date.parse(state.roundEndsAt) <= now : false;
  const podium = [...state.members].sort((a, b) => b.score - a.score);

  return (
    <div className="page quiz-page">
      <header className="room-head">
        <Link className="icon-button subtle" to="/quiz" aria-label={t('Yarışma', 'Quiz')}>
          <ArrowLeft size={18} />
        </Link>
        <div className="room-head-copy">
          <strong>{t('Müzik partisi', 'Music party')}</strong>
          <small>
            {state.category === 'tr' ? t('Türkçe', 'Turkish') : state.category === 'intl' ? t('Uluslararası', 'International') : t('Karışık', 'Mixed')} ·{' '}
            {t('Tur', 'Round')} {state.roundNo || 0}/5 · {state.code}
          </small>
        </div>
        <div className="room-head-actions">
          <button
            type="button"
            className="button ghost compact"
            onClick={() => {
              if (!state) return;
              const link = `${window.location.origin}/quiz/party/${state.id}?code=${state.code}`;
              void navigator.clipboard?.writeText(link);
              pushToast(t('Davet bağlantısı kopyalandı.', 'Invite link copied.'), 'success');
            }}
          >
            <Copy size={14} /> {t('Bağlantı', 'Link')}
          </button>
          <button type="button" className="button ghost compact" onClick={() => void openInvite()}>
            <UserPlus size={14} /> {t('Davet et', 'Invite')}
          </button>
        </div>
      </header>

      <section className="quiz-stage">
        <div className="quiz-head">
          <div>
            <span className="eyebrow">{t('Parti', 'Party')}</span>
            <h2>
              {state.finished
                ? t('Parti bitti', 'Party finished')
                : state.status === 'open'
                  ? t('Tur bekleniyor', 'Waiting for the first round')
                  : roundEnded
                    ? t('Cevap açıklandı', 'Round revealed')
                    : t('Bu şarkı hangisi?', 'Which song is this?')}
            </h2>
          </div>
          {state.status === 'playing' && !roundEnded ? (
            <span className="quiz-timer">
              {remaining}s
            </span>
          ) : null}
        </div>

        {state.status === 'open' ? (
          <div className="quiz-party-ready">
            <p className="quiz-note">
              {isHost
                ? t('Hazır olduğunda ilk turu başlat.', 'Start the first round when everyone is in.')
                : t('Ev sahibi turu başlatacak.', 'The host will start the round.')}
            </p>
            {isHost ? (
              <button
                type="button"
                className="button"
                onClick={() =>
                  void (async () => {
                    try {
                      await api.quizStartPartyRound(partyId);
                      await load();
                    } catch (err) {
                      pushToast(err instanceof Error ? err.message : t('Tur başlatılamadı.', 'Could not start.'), 'error');
                    }
                  })()
                }
              >
                <Trophy size={15} /> {t('İlk turu başlat', 'Start round 1')}
              </button>
            ) : null}
            <ul className="quiz-board">
              {state.members.map((member) => (
                <li key={member.userId}>
                  <Cover src={member.avatarUrl} alt="" seed={member.userId} className="quiz-board-avatar" iconSize={14} />
                  <span className="quiz-board-name">{member.displayName}</span>
                  {member.userId === state.hostId ? <Crown size={13} className="room-role-icon is-owner" /> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.status === 'playing' && !roundEnded ? (
          <>
            <div className="quiz-clip">
              <button type="button" className="quiz-play" onClick={playPreview} aria-label={t('Klibi çal', 'Play clip')}>
                {playing ? <SkipForward size={24} /> : <Play size={24} fill="currentColor" />}
              </button>
              <div className="quiz-clip-copy">
                <strong>
                  {preview?.duration ?? 1} {t('saniyelik klip', 'second clip')}
                </strong>
                <small>
                  {t('Kalan hak', 'Guesses left')}: {attemptsLeft} · {t('Puanın', 'Your score')}: {state.yourScore}
                </small>
              </div>
            </div>

            <div className="quiz-input-row">
              <input
                type="text"
                value={guess}
                onChange={(event) => setGuess(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void answer();
                }}
                placeholder={t('Şarkı adı veya sanatçı', 'Song title or artist')}
                aria-label={t('Tahmin', 'Guess')}
                maxLength={120}
              />
              <button type="button" className="button" onClick={() => void answer()} disabled={busy || !guess.trim()}>
                {busy ? <Loader2 size={15} className="spin" /> : null}
                {t('Gönder', 'Send')}
              </button>
            </div>
            {feedback ? <p className="quiz-feedback is-warn">{feedback}</p> : null}
          </>
        ) : null}

        {state.status !== 'open' && state.reveal ? (
          <div className="quiz-result">
            <Cover
              src={state.reveal.coverUrl}
              alt=""
              seed={state.reveal.title}
              className="quiz-result-cover"
              iconSize={26}
            />
            <div className="quiz-result-copy">
              <span className="eyebrow">
                {t('Tur', 'Round')} {state.reveal.roundNo}
              </span>
              <strong>{state.reveal.title}</strong>
              <span>{state.reveal.artist}</span>
            </div>
          </div>
        ) : null}

        {state.status === 'playing' ? (
          <div className="quiz-party-scores">
            <h3>{t('Skorlar', 'Scores')}</h3>
            <ol className="quiz-board">
              {podium.map((member, index) => (
                <li key={member.userId} className={index === 0 ? 'is-top is-1' : ''}>
                  <span className="quiz-rank">{index + 1}</span>
                  <Cover src={member.avatarUrl} alt="" seed={member.userId} className="quiz-board-avatar" iconSize={14} />
                  <span className="quiz-board-name">{member.displayName}</span>
                  <span className="quiz-board-points">{member.score}</span>
                </li>
              ))}
            </ol>
            {isHost && roundEnded && state.roundNo < 5 && !state.finished ? (
              <button
                type="button"
                className="button"
                onClick={() =>
                  void (async () => {
                    try {
                      await api.quizNextPartyRound(partyId);
                      setPreview(null);
                      roundRef.current = 0;
                      await load();
                    } catch (err) {
                      pushToast(err instanceof Error ? err.message : t('Sonraki tur açılamadı.', 'Could not open the next round.'), 'error');
                    }
                  })()
                }
              >
                <Play size={15} /> {t('Sonraki tur', 'Next round')}
              </button>
            ) : null}
          </div>
        ) : null}

        {state.finished ? (
          <div className="quiz-podium">
            <h3>
              <Trophy size={18} /> {t('Podyum', 'Podium')}
            </h3>
            <ol>
              {podium.slice(0, 3).map((member, index) => (
                <li key={member.userId} className={`is-${index + 1}`}>
                  <span>{index + 1}</span>
                  <Cover src={member.avatarUrl} alt="" seed={member.userId} className="quiz-board-avatar" iconSize={14} />
                  <strong>{member.displayName}</strong>
                  <small>{member.score}</small>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <audio ref={audioRef} preload="none" onEnded={() => setPlaying(false)} className="quiz-audio" />
      </section>

      {inviteOpen ? (
        <div className="dm-picker" role="dialog" aria-modal="true" aria-label={t('Davet et', 'Invite')}>
          <div className="dm-picker-card">
            <header>
              <h4>{t('Arkadaşını davet et', 'Invite a friend')}</h4>
              <button type="button" className="icon-button subtle" onClick={() => setInviteOpen(false)} aria-label={t('Kapat', 'Close')}>
                <X size={16} />
              </button>
            </header>
            <div className="dm-picker-list">
              {friends.length === 0 ? (
                <p className="dm-share-hint">{t('Davet edilecek arkadaş yok.', 'No friends to invite.')}</p>
              ) : (
                friends.map((friend) => (
                  <button
                    type="button"
                    key={friend.id}
                    className="person-row dm-picker-row"
                    onClick={() =>
                      void (async () => {
                        try {
                          await api.quizInviteParty(partyId, friend.id);
                          pushToast(t('Davet gönderildi.', 'Invitation sent.'), 'success');
                        } catch (err) {
                          pushToast(err instanceof Error ? err.message : t('Davet gönderilemedi.', 'Invite failed.'), 'error');
                        }
                      })()
                    }
                  >
                    <Cover src={friend.avatarUrl} alt="" seed={friend.id} className="person-avatar" iconSize={14} />
                    <span className="person-copy">
                      <strong>{friend.displayName}</strong>
                      <small>{friend.username ? `@${friend.username}` : ''}</small>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
