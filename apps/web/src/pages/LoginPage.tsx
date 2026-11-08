import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Mail, User, Wifi, WifiOff } from 'lucide-react';
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
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const clearError = useAuthStore((state) => state.clearError);

  const { data: health, isError: healthError, isPending: healthPending, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    retry: false,
    staleTime: 20_000,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        if (password !== passwordConfirm) return;
        await register(email.trim(), password, displayName.trim());
      }
    } catch {
      // store exposes localized error
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || status === 'checking';

  return (
    <main className="login-page login-premium" aria-label="Giriş">
      <div className="login-stage">
        <div className="login-brand">
          <Logo />
          <span className="login-tagline">Müziğin. Senin alanın.</span>
          <span className="login-status">
            {healthPending ? (
              <><Loader2 size={12} className="spin" /> Bağlanıyor…</>
            ) : healthError ? (
              <><WifiOff size={12} /> Sunucu çevrimdışı <button type="button" className="login-status-retry" onClick={() => void refetch()}>Dene</button></>
            ) : (
              <><Wifi size={12} /> {health ? `${formatCount(health.tracks)} parça çevrimiçi` : 'Çevrimiçi'}</>
            )}
          </span>
        </div>

        <section className="login-card nm-glass" aria-label={mode === 'login' ? 'Giriş yap' : 'Kayıt ol'}>
          <div className="login-form-heading">
            <h1>{mode === 'login' ? 'Tekrar hoş geldin' : 'Hesap oluştur.'}</h1>
            <p>{mode === 'login' ? 'Kütüphanene devam et' : 'Hesabını oluştur, müziğin seninle kalsın'}</p>
          </div>

          <form className="login-form" onSubmit={submit} noValidate>
            {mode === 'register' ? (
              <>
                <label htmlFor="display-name">Kullanıcı adı</label>
                <div className="nm-field">
                  <User size={16} aria-hidden="true" />
                  <input
                    id="display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => { setDisplayName(e.target.value); if (error) clearError(); }}
                    placeholder="Adın"
                    autoComplete="name"
                    autoCapitalize="words"
                    spellCheck={false}
                    maxLength={80}
                  />
                </div>
              </>
            ) : null}

            <label htmlFor="email">E-posta</label>
            <div className="nm-field">
              <Mail size={16} aria-hidden="true" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (error) clearError(); }}
                placeholder="ornek@mail.com"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                autoFocus
                aria-invalid={Boolean(error)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <label htmlFor="password">Parola</label>
              {mode === 'login' ? (
                <button
                  type="button"
                  className="login-mini-link"
                  onClick={() => clearError()}
                  title="Destek için yöneticine yaz"
                >
                  Şifremi unuttum
                </button>
              ) : null}
            </div>
            <div className="nm-field">
              <KeyRound size={16} aria-hidden="true" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (error) clearError(); }}
                placeholder={mode === 'register' ? 'En az 8 karakter' : 'Parolan'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                spellCheck={false}
                maxLength={200}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
              />
              <button
                type="button"
                className="nm-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Parolayı gizle' : 'Parolayı göster'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {mode === 'register' ? (
              <>
                <label htmlFor="password-confirm">Parolayı tekrar gir</label>
                <div className="nm-field">
                  <KeyRound size={16} aria-hidden="true" />
                  <input
                    id="password-confirm"
                    type={showPassword ? 'text' : 'password'}
                    value={passwordConfirm}
                    onChange={(e) => { setPasswordConfirm(e.target.value); if (error) clearError(); }}
                    placeholder="Parolanı doğrula"
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={200}
                    aria-invalid={Boolean(passwordConfirm && password !== passwordConfirm)}
                  />
                </div>
                {passwordConfirm && password !== passwordConfirm ? (
                  <p className="form-error" role="alert">Parolalar eşleşmiyor.</p>
                ) : null}
              </>
            ) : null}

            {error ? (
              <p className="form-error" id="login-error" role="alert">{error}</p>
            ) : null}

            <button
              type="submit"
              className="nm-btn nm-btn--primary login-submit"
              disabled={!email.trim() || !password || busy || (mode === 'register' && (!displayName.trim() || password !== passwordConfirm))}
            >
              {busy ? <Loader2 size={18} className="spin" /> : null}
              {busy ? 'Bağlanıyor…' : mode === 'login' ? 'Giriş yap' : 'Hesap oluştur'}
              {!busy ? <ArrowRight size={17} /> : null}
            </button>
          </form>

          <p className="login-switch">
            {mode === 'login' ? (
              <>Hesabın yok mu? <button type="button" onClick={() => { setMode('register'); clearError(); }}>Kayıt ol</button></>
            ) : (
              <>Zaten hesabın var mı? <button type="button" onClick={() => { setMode('login'); clearError(); }}>Giriş yap</button></>
            )}
          </p>

          <p className="login-privacy">30 gün güvenli çerez ile giriş yapılır.</p>
        </section>

        <footer className="login-footer">
          <span>Norie Music {health?.version ? `v${health.version}` : 'v0.8.0'}</span>
        </footer>
      </div>
    </main>
  );
}
