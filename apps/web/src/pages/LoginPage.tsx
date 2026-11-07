import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Loader2,
  Music2,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api } from '../api';
import { Logo } from '../components/Logo';
import { useAuthStore } from '../store/auth';
import { formatCount } from '../lib/format';

export function LoginPage() {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const login = useAuthStore((state) => state.login);
  const clearError = useAuthStore((state) => state.clearError);

  const { data: health, isError: healthError, isPending: healthPending, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    retry: false,
    staleTime: 20_000,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    try {
      await login(token.trim());
    } catch {
      // The auth store exposes the localized error message.
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
            <span className="eyebrow">Sunucuna bağlan</span>
            <h2>Tekrar hoş geldin.</h2>
            <p>Sunucu anahtarını girerek kütüphanene eriş.</p>
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

          <form className="login-form" onSubmit={submit}>
            <label htmlFor="music-token">Sunucu anahtarı</label>
            <div className="token-field">
              <KeyRound size={18} aria-hidden="true" />
              <input
                id="music-token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  if (error) clearError();
                }}
                placeholder="MUSIC_TOKEN"
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={512}
                autoFocus
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
              />
              <button
                type="button"
                className="token-visibility"
                onClick={() => setShowToken((value) => !value)}
                aria-label={showToken ? 'Anahtarı gizle' : 'Anahtarı göster'}
              >
                {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            {health?.demoToken ? (
              <button
                type="button"
                className="demo-token-button"
                onClick={() => {
                  setToken('senro-demo');
                  if (error) clearError();
                }}
              >
                <span>Geliştirme modu · demo anahtarı</span>
                <span>Doldur</span>
              </button>
            ) : null}

            {error ? (
              <p className="form-error" id="login-error" role="alert">
                {error}
              </p>
            ) : null}

            <button type="submit" className="button primary login-submit" disabled={!token.trim() || busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <ArrowRight size={18} />}
              {busy ? 'Bağlanıyor…' : 'Kütüphaneye gir'}
            </button>
          </form>

          <p className="login-privacy">
            Oturumun bu cihazda {30} gün boyunca güvenli bir çerezle saklanır. Anahtarın yalnızca
            kendi sunucuna gönderilir.
          </p>

          {health?.demoToken ? (
            <div className="demo-notice">
              <strong>Geliştirme anahtarı etkin</strong>
              <p>
                Üretimde <code>server/.env</code> içindeki <code>MUSIC_TOKEN</code> değerini güçlü ve
                benzersiz bir anahtarla değiştir.
              </p>
            </div>
          ) : null}

          <footer className="login-footer">
            <span>SenroMusic 0.3</span>
            <span>Yerel öncelikli · Açık arayüz</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
