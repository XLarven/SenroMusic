import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Clock3,
  Database,
  Download,
  HardDrive,
  Info,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { api } from '../api';
import { useMusicData } from '../MusicDataContext';
import { getAppLanguage, setAppLanguage } from '../lib/i18n';
import { useAuthStore } from '../store/auth';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import { formatBytes, formatCount, formatLongDuration } from '../lib/format';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function SettingsPage() {
  const { library, refreshLibrary, refreshPlaylists } = useMusicData();
  const logout = useAuthStore((state) => state.logout);
  const pushToast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [loggingOut, setLoggingOut] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    staleTime: 30_000,
  });

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const scanMutation = useMutation({
    mutationFn: api.scan,
    onSuccess: async (result) => {
      await refreshLibrary();
      await refreshPlaylists();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['playlist'] }),
      ]);
      pushToast(
        result.failed > 0
          ? `${result.scanned} dosya tarandı; ${result.failed} dosya okunamadı.`
          : `Kitaplık güncellendi: ${result.scanned} dosya tarandı.`,
        result.failed > 0 ? 'info' : 'success',
      );
    },
    onError: (error) => {
      pushToast(error instanceof Error ? error.message : 'Kitaplık taranamadı.', 'error');
    },
  });

  const install = async () => {
    if (!installPrompt || installed) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstalled(true);
      pushToast('Norie Music ana ekranına eklendi.', 'success');
    }
    setInstallPrompt(null);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const saveSetting = async (key: string, value: string | number | boolean) => {
    try {
      await api.updateSetting(key, value);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      if (key === 'historyEnabled') localStorage.setItem('Norie.historyEnabled', value ? 'true' : 'false');
      if (key === 'autoplay') localStorage.setItem('Norie.autoplay', value ? 'true' : 'false');
      if (key === 'appLanguage') {
        setAppLanguage(value as 'tr' | 'en');
        window.setTimeout(() => window.location.reload(), 300);
      }
      if (key === 'wifiOnly') localStorage.setItem('Norie.wifiOnly', value ? 'true' : 'false');
      if (key === 'dynamicColors') document.documentElement.classList.toggle('dynamic-colors-off', !value);
      if (key === 'reducedMotion') document.documentElement.classList.toggle('reduced-motion', Boolean(value));
      if (key === 'glassEffects') document.documentElement.classList.toggle('glass-off', !value);
      if (key === 'shuffle') usePlayer.setState({ shuffle: Boolean(value) });
      if (key === 'repeat') usePlayer.setState({ repeat: value as 'off' | 'all' | 'one' });
      if (key === 'volume') usePlayer.setState({ volume: Number(value) });
      pushToast('Ayar kaydedildi.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Ayar kaydedilemedi.', 'error');
    }
  };

  const changePassword = async () => {
    setPasswordBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      pushToast('Parola güncellendi.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Parola güncellenemedi.', 'error');
    } finally {
      setPasswordBusy(false);
    }
  };

  const deleteAccount = async () => {
    setDeleteBusy(true);
    try {
      await api.deleteAccount(deletePassword);
      await logout();
      pushToast('Hesap silindi.', 'info');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Hesap silinemedi.', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  const clearCache = async () => {
    setClearingCache(true);
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      pushToast('Uygulama önbelleği temizlendi.', 'success');
    } catch {
      pushToast('Önbellek temizlenemedi.', 'error');
    } finally {
      setClearingCache(false);
    }
  };

  const settings = settingsQuery.data?.settings ?? {};

  return (
    <div className="page settings-page">
      <header className="page-heading settings-heading">
        <span className="eyebrow">Ayarlar</span>
        <h1>Kendine göre ayarla</h1>
        <p>Çalma, indirme ve görünüm tercihlerin burada.</p>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-icon">
              <HardDrive size={19} />
            </span>
            <div>
              <h2>Kütüphane</h2>
              <p>Müzik arşivin.</p>
            </div>
          </header>

          <div className="settings-stat-grid">
            <div>
              <strong>{formatCount(library.stats.tracks)}</strong>
              <span>parça</span>
            </div>
            <div>
              <strong>{formatLongDuration(library.stats.totalDuration)}</strong>
              <span>toplam süre</span>
            </div>
            <div>
              <strong>{formatBytes(library.stats.totalSize)}</strong>
              <span>disk</span>
            </div>
            <div>
              <strong>{formatCount(library.stats.albums)}</strong>
              <span>albüm</span>
            </div>
          </div>

          <button
            type="button"
            className="button secondary full"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            {scanMutation.isPending ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            {scanMutation.isPending ? 'Kitaplık taranıyor…' : 'Kitaplığı yeniden tara'}
          </button>
          <p className="settings-hint">
            Yeni şarkı eklediysen tara; kapaklar ve bilgiler kendiliğinden yenilenir.
          </p>
        </section>

        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-icon"><Clock3 size={19} /></span>
            <div><h2>Oynatma</h2><p>Varsayılan çalma davranışı.</p></div>
          </header>
          <dl className="settings-list">
            <div><dt>Varsayılan karıştırma</dt><dd><input type="checkbox" checked={Boolean(settings.shuffle)} onChange={(event) => void saveSetting('shuffle', event.target.checked)} /></dd></div>
            <div><dt>Tekrar</dt><dd><select value={String(settings.repeat ?? 'off')} onChange={(event) => void saveSetting('repeat', event.target.value)}><option value="off">Kapalı</option><option value="all">Tümü</option><option value="one">Tek parça</option></select></dd></div>
            <div><dt>Başlangıç sesi</dt><dd><input type="range" min={0} max={100} value={Math.round(Number(settings.volume ?? 80))} onChange={(event) => void saveSetting('volume', Number(event.target.value) / 100)} /></dd></div>
            <div><dt>Dinleme geçmişi kaydı</dt><dd><input type="checkbox" checked={settings.historyEnabled !== false} onChange={(event) => void saveSetting('historyEnabled', event.target.checked)} /></dd></div>
            <div><dt>Otomatik devam (benzer parçalar)</dt><dd><input type="checkbox" checked={settings.autoplay === true || localStorage.getItem('Norie.autoplay') === 'true'} onChange={(event) => void saveSetting('autoplay', event.target.checked)} /></dd></div>
          </dl>
          <p className="settings-hint">Oynatma, sayfalar arasında gezinirken aynı oyuncuda devam eder.</p>
        </section>

        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-icon"><Download size={19} /></span>
            <div><h2>İndirmeler ve depolama</h2><p>Yalnızca bu cihazın çevrimdışı dosyaları.</p></div>
          </header>
          <dl className="settings-list">
            <div><dt>Yalnızca Wi-Fi ile indir</dt><dd><input type="checkbox" checked={Boolean(settings.wifiOnly)} onChange={(event) => void saveSetting('wifiOnly', event.target.checked)} /></dd></div>
            <div><dt>Akış kalitesi</dt><dd>Otomatik</dd></div>
            <div><dt>İndirme kalitesi</dt><dd>Otomatik</dd></div>
          </dl>
          <div className="settings-actions">
            <button type="button" className="button secondary" onClick={() => void clearCache()} disabled={clearingCache}>{clearingCache ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Önbelleği temizle</button>
            <button type="button" className="button ghost" onClick={() => void (async () => { const downloads = useDownloads.getState(); for (const record of Object.values(downloads.records)) await downloads.remove(record.trackId); pushToast('Yerel indirilenler kaldırıldı.', 'success'); })()}>İndirilenleri kaldır</button>
          </div>
          <p className="settings-hint">İndirilenleri kaldırmak çalma listelerini veya favorileri silmez.</p>
        </section>

        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-icon"><Smartphone size={19} /></span>
            <div><h2>Görünüm</h2><p>Ekran ve dil tercihleri.</p></div>
          </header>
          <dl className="settings-list">
            <div><dt>Dinamik albüm renkleri</dt><dd><input type="checkbox" checked={settings.dynamicColors !== false} onChange={(event) => void saveSetting('dynamicColors', event.target.checked)} /></dd></div>
            <div><dt>Hareketi azalt</dt><dd><input type="checkbox" checked={Boolean(settings.reducedMotion)} onChange={(event) => void saveSetting('reducedMotion', event.target.checked)} /></dd></div>
            <div><dt>Uygulama dili</dt><dd><select value={String(settings.appLanguage ?? getAppLanguage())} onChange={(event) => void saveSetting('appLanguage', event.target.value)}><option value="tr">Türkçe</option><option value="en">English</option></select></dd></div>
          </dl>
        </section>

        <section className="settings-card settings-card-wide">
          <header className="settings-card-head">
            <span className="settings-icon">
              <Smartphone size={19} />
            </span>
            <div>
              <h2>Uygulama</h2>
              <p>Her cihazında kullan.</p>
            </div>
          </header>

          <div className="install-row">
            <div className="install-copy">
              <h3>Ana ekrana ekle</h3>
              <p>Tarayıcı çerçevesi olmadan, uygulama gibi açılsın.</p>
            </div>
            {installed ? (
              <span className="installed-pill">
                <Check size={15} />
                Yüklü
              </span>
            ) : installPrompt ? (
              <button type="button" className="button primary" onClick={() => void install()}>
                <Download size={16} />
                Yükle
              </button>
            ) : (
              <span className="install-tip">Tarayıcı menüsünden “Ana ekrana ekle” seçeneğini kullan.</span>
            )}
          </div>

          <div className="platform-grid">
            <div>
              <Monitor size={18} />
              <strong>Windows</strong>
              <span>Tarayıcıdan aç</span>
            </div>
            <div>
              <Smartphone size={18} />
              <strong>Android</strong>
              <span>Ana ekrana ekle</span>
            </div>
            <div>
              <Smartphone size={18} />
              <strong>iPhone / iPad</strong>
              <span>Paylaş → Ana Ekrana Ekle</span>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-icon">
              <ShieldCheck size={19} />
            </span>
            <div>
              <h2>Oturum</h2>
              <p>30 gün boyunca açık kalır.</p>
            </div>
          </header>

          <p className="settings-hint">
            Bu cihazda oturumun açık kaldığı sürece şifre girmen gerekmez.
          </p>

          <button
            type="button"
            className="button ghost full"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            {loggingOut ? <Loader2 size={16} className="spin" /> : <LogOut size={16} />}
            Oturumu kapat
          </button>
        </section>

        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-icon"><KeyRound size={19} /></span>
            <div><h2>Hesap</h2><p>Parolanı değiştir veya hesabını sil.</p></div>
          </header>
          <label className="field"><span>Mevcut parola</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label className="field"><span>Yeni parola</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <button type="button" className="button secondary full" onClick={() => void changePassword()} disabled={passwordBusy || !currentPassword || newPassword.length < 8}>{passwordBusy ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />} Parolayı değiştir</button>
          <div className="danger-zone">
            <label className="field"><span>Hesabı silmek için parolayı gir</span><input type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} /></label>
            <button type="button" className="button danger full" onClick={() => void deleteAccount()} disabled={deleteBusy || !deletePassword}>{deleteBusy ? <Loader2 size={16} className="spin" /> : <LogOut size={16} />} Hesabı sil</button>
          </div>
        </section>

        <section className="settings-card settings-legal">
          <header className="settings-card-head">
            <span className="settings-icon">
              <Info size={19} />
            </span>
            <div>
              <h2>Hakkında</h2>
              <p>Kişisel müzik arşivin.</p>
            </div>
          </header>
          <p>Kendi müziğini bir arada tutan sade bir oynatıcı. Reklam yok, abonelik yok.</p>
          <div className="legal-points">
            <span>
              <Database size={14} /> Kendi arşivin
            </span>
            <span>
              <ShieldCheck size={14} /> Reklamsız
            </span>
            <span>
              <Clock3 size={14} /> Çevrimdışı dinle
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
