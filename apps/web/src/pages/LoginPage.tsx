import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  Music2,
  ShieldCheck,
  Smartphone,
  User,
  Wifi,
  WifiOff,
  HardDrive,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { useAuthStore } from '../store/auth';
import { formatCount } from '../lib/format';

type Mode = 'login' | 'register';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const tokenLogin = useAuthStore((state) => state.tokenLogin);
  const clearError = useAuthStore((state) => state.clearError);

  const { data: health, isError: healthError, isPending: healthPending, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    retry: false,
    staleTime: 20_000,
  });

  const { data: authStatus } = useQuery({
    queryKey: ['auth-status'],
    queryFn: api.authStatus,
    retry: false,
    staleTime: 60_000,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, displayName.trim());
      }
    } catch {
      // store handles error
    } finally {
      setSubmitting(false);
    }
  };

  const submitToken = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    try {
      await tokenLogin(token.trim());
    } catch {
      // store handles error
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || status === 'checking';

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-story-top">
          <Logo />
          <span className="login-story-badge">Kendi müziğin. Kendi sunucun.</span>
        </div>

        <div className="login-copy">
          <span className="eyebrow">
            <span className="status-dot" />
            Yerel öncelikli müzik
          </span>
          <h1>
            Kütüphanen
            <br />
            <span>her cihazında.</span>
          </h1>
          <p>
            Müzik arşivini kendi sunucunda barındır. Telefonunda, tabletinde ve bilgisayarında aynı
            kütüphaneye bağlan; kayıpsız akışın ve sade bir dinleme deneyiminin keyfini çıkar.
          </p>

          <div className="login-features">
            <span>
              <HardDrive size={16} /> Kendi dosyaların
            </span>
            <span>
              <Smartphone size={16} /> Her ekranda
            </span>
            <span>
              <ShieldCheck size={16} /> Reklamsız
            </span>
          </div>
        </div>

        <div className="login-visual" aria-hidden="true">
          <div className="login-disc login-disc-back" />
          <div className="login-disc login-disc-front" />
          <div className="login-player-card">
            <div className="login-cover">
              <span className="login-cover-ring" />
              <Music2 size={36} strokeWidth={1.4} />
            </div>
            <div className="login-track-copy">
              <span className="eyebrow">Şimdi çalıyor</span>
              <strong>Midnight Drive</strong>
              <small>Nova Lane · Neon Nights</small>
              <div className="login-wave">
                {Array.from({ length: 22 }, (_, index) => (
                  <span key={index} style={{ animationDelay: `${(index % 7) * -0.14}s` }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="login-story-foot">
          SenroMusic, yalnızca hak sahibi olduğun veya lisansa sahip olduğun dosyaları oynatmak için
          tasarlandı.
        </p>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="login-form-heading">
            <span className="eyebrow">Hesabına giriş yap</span>
            <h2>{mode === 'login' ? 'Tekrar hoş geldin.' : 'Hesap oluştur.'}</h2>
            <p>{mode === 'login' ? 'E-posta ve parolanla kütüphanene bağlan.' : 'İlk hesabın yönetici olur. Sonra aile/arkadaşların kayıt olabilir.'}</p>
          </div>

          <div className="server-status-row">
            {healthPending ? (
              <span className="server-status">
                <Loader2 size={14} className="spin" /> Sunucu kontrol ediliyor
              </span>
            ) : healthError ? (
              <span className="server-status is-error">
                <WifiOff size={14} /> Sunucuya ulaşılamıyor
                <button type="button" className="text-button" onClick={() => void refetch()}>
                  Dene
                </button>
              </span>
            ) : health ? (
              <span className="server-status">
                <Wifi size={14} /> Sunucu çevrimiçi
                <span className="status-separator">·</span>
                {formatCount(health.tracks)} parça
              </span>
            ) : null}
          </div>

          <div className="search-tabs" role="tablist" aria-label="Giriş / Kayıt" style={{ marginTop: 8 }}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={clsx('filter-chip', mode === 'login' && 'is-active')}
              onClick={() => { setMode('login'); clearError(); }}
            >
              Giriş yap
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={clsx('filter-chip', mode === 'register' && 'is-active')}
              onClick={() => { setMode('register'); clearError(); }}
            >
              Kayıt ol
            </button>
          </div>

          <form className="login-form" onSubmit={submit}>
            {mode === 'register' ? (
              <label htmlFor="display-name">Ad Soyad</label>
            ) : null}
            {mode === 'register' ? (
              <div className="token-field">
                <User size={18} aria-hidden="true" />
                <input
                  id="display-name"
                  type="text"
                  value={displayName}
                  onChange={(event) => { setDisplayName(event.target.value); if (error) clearError(); }}
                  placeholder="Ahmet Yılmaz"
                  autoComplete="name"
                  autoCapitalize="words"
                  spellCheck={false}
                  maxLength={80}
                />
              </div>
            ) : null}

            <label htmlFor="email">E-posta</label>
            <div className="token-field">
              <Mail size={18} aria-hidden="true" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => { setEmail(event.target.value); if (error) clearError(); }}
                placeholder="ornek@senromusic.local"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                autoFocus
                aria-invalid={Boolean(error)}
              />
            </div>

            <label htmlFor="password">Parola</label>
            <div className="token-field">
              <KeyRound size={18} aria-hidden="true" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => { setPassword(event.target.value); if (error) clearError(); }}
                placeholder={mode === 'register' ? 'En az 8 karakter' : 'Parolan'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                autoCapitalize="none"
                spellCheck={false}
                maxLength={200}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
              />
              <button
                type="button"
                className="token-visibility"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Parolayı gizle' : 'Parolayı göster'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            {error ? (
              <p className="form-error" id="login-error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="button primary login-submit" disabled={!email.trim() || !password || busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} />}
              {busy ? 'Bağlanıyor…' : mode === 'login' ? 'Kütüphaneye gir' : 'Hesap oluştur'}
            </button>
          </form>

          <p className="login-privacy">
            Oturumun bu cihazda 30 gün boyunca güvenli bir çerezle saklanır. Parolan scrypt ile hashlenir.
            {authStatus?.supabaseEnabled ? ' Supabase hesabın senkronize ediliyor.' : ''}
          </p>

          <div style={{ marginTop: 18 }}>
            <button type="button" className="text-button" onClick={() => setShowToken((v) => !v)}>
              {showToken ? 'Anahtar girişini gizle' : 'Eski sunucu anahtarı ile gir (geliştirici)'}
            </button>
          </div>
          {showToken ? (
            <form className="login-form" onSubmit={submitToken} style={{ marginTop: 8 }}>
              <label htmlFor="music-token">Sunucu anahtarı (MUSIC_TOKEN)</label>
              <div className="token-field">
                <KeyRound size={18} aria-hidden="true" />
                <input
                  id="music-token"
                  type="password"
                  value={token}
                  onChange={(event) => { setToken(event.target.value); if (error) clearError(); }}
                  placeholder="MUSIC_TOKEN"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={512}
                />
              </div>
              <button type="submit" className="button secondary login-submit" disabled={!token.trim() || busy}>
                Anahtar ile gir
              </button>
            </form>
          ) : null}

          <footer className="login-footer">
            <span>SenroMusic 0.4</span>
            <span>Yerel öncelikli · Açık arayüz</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
