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
  Server,
  ShieldCheck,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { api } from '../api';
import { useMusicData } from '../MusicDataContext';
import { getAppLanguage, setAppLanguage } from '../lib/i18n';
import { getServerUrl, setServerUrl } from '../lib/serverUrl';
import { useAuthStore } from '../store/auth';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { useToastStore } from '../store/toast';
import {
  formatBytes,
  formatCount,
  formatDate,
  formatLongDuration,
} from '../lib/format';

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
  const demoToken = useAuthStore((state) => state.demoToken);
  const logout = useAuthStore((state) => state.logout);
  const pushToast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [loggingOut, setLoggingOut] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(getServerUrl());
  const [serverUrlSaving, setServerUrlSaving] = useState(false);
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

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: false,
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
        queryClient.invalidateQueries({ queryKey: ['health'] }),
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

  const handleSaveServerUrl = () => {
    setServerUrlSaving(true);
    try {
      setServerUrl(serverUrlInput);
      pushToast('Sunucu adresi kaydedildi. Sayfa yenileniyor…', 'success');
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Kaydedilemedi.', 'error');
    } finally {
      setServerUrlSaving(false);
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

  const health = healthQuery.data;
  const settings = settingsQuery.data?.settings ?? {};
  const online = Boolean(health && !healthQuery.isError);
  const lastScan = health?.lastScanAt ?? library.stats.lastScanAt;

  return (
    <div className="page settings-page">
      <header className="page-heading settings-heading">
        <span className="eyebrow">Uygulama ve sunucu</span>
        <h1>Ayarlar</h1>
        <p>Bağlantıyı, kütüphaneyi ve kurulumu tek yerden yönet.</p>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-icon">
              <Server size={19} />
            </span>
            <div>
              <h2>Sunucu</h2>
              <p>Norie Music sunucunun durumu.</p>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => void healthQuery.refetch()}
              aria-label="Sunucu durumunu yenile"
              title="Yenile"
            >
              <RefreshCw size={16} className={healthQuery.isFetching ? 'spin' : undefined} />
            </button>
          </header>

          <div className={online ? 'connection-pill is-online' : 'connection-pill is-offline'}>
            {online ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span>{online ? 'Bağlı ve çalışıyor' : healthQuery.isPending ? 'Kontrol ediliyor' : 'Bağlantı yok'}</span>
            {health ? <small>v{health.version}</small> : null}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="url"
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
              placeholder="http://192.168.1.10:8787"
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #333)', background: 'var(--surface, #111)', color: 'inherit' }}
            />
            <button
              type="button"
              className="button primary"
              onClick={handleSaveServerUrl}
              disabled={serverUrlSaving}
            >
              {serverUrlSaving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
              Kaydet
            </button>
          </div>
          <p className="settings-hint" style={{ marginTop: 0 }}>
            Mobil veya uzak cihazdan bağlanırken sunucunun adresini gir. Örn: http://192.168.1.10:8787
          </p>

          <dl className="settings-list">
            <div>
              <dt>Sunucu adresi</dt>
              <dd>
                <code>{getServerUrl()}</code>
              </dd>
            </div>
            <div>
              <dt>Sunucu sürümü</dt>
              <dd>{health?.version ?? '—'}</dd>
            </div>
            <div>
              <dt>Son kitaplık taraması</dt>
              <dd>{formatDate(lastScan)}</dd>
            </div>
            <div>
              <dt>Parça sayısı</dt>
              <dd>{formatCount(health?.tracks ?? library.stats.tracks)}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-icon">
              <HardDrive size={19} />
            </span>
            <div>
              <h2>Kitaplık</h2>
              <p>Sunucudaki müzik arşivin.</p>
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
            Yeni dosyaları ekledikten sonra tara. Metadata, kapaklar ve çalma listeleri otomatik
            güncellenir.
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
            <div><dt>Akış kalitesi</dt><dd>Otomatik (kaynak dosya)</dd></div>
            <div><dt>İndirme kalitesi</dt><dd>Otomatik (kaynak dosya)</dd></div>
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
            <div><h2>Görünüm</h2><p>Donanım hızlandırma dostu görsel ayarlar.</p></div>
          </header>
          <dl className="settings-list">
            <div><dt>Dinamik albüm renkleri</dt><dd><input type="checkbox" checked={settings.dynamicColors !== false} onChange={(event) => void saveSetting('dynamicColors', event.target.checked)} /></dd></div>
            <div><dt>Hareketi azalt</dt><dd><input type="checkbox" checked={Boolean(settings.reducedMotion)} onChange={(event) => void saveSetting('reducedMotion', event.target.checked)} /></dd></div>
            <div><dt>Cam efektleri</dt><dd><input type="checkbox" checked={settings.glassEffects !== false} onChange={(event) => void saveSetting('glassEffects', event.target.checked)} /></dd></div>
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
              <p>Norie Music'i her cihazında kullan.</p>
            </div>
          </header>

          <div className="install-row">
            <div className="install-copy">
              <h3>Ana ekrana ekle</h3>
              <p>
                PWA olarak yükle; tarayıcı çerçevesi olmadan, uygulama gibi açılsın. Müzik akışı için
                sunucunun erişilebilir olması gerekir.
              </p>
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
              <span>Tarayıcı veya Electron paketi</span>
            </div>
            <div>
              <Smartphone size={18} />
              <strong>Android</strong>
              <span>PWA · ana ekrana ekle</span>
            </div>
            <div>
              <Smartphone size={18} />
              <strong>iPhone / iPad</strong>
              <span>Safari · Paylaş → Ana Ekrana Ekle</span>
            </div>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-head">
            <span className="settings-icon">
              <ShieldCheck size={19} />
            </span>
            <div>
              <h2>Güvenlik</h2>
              <p>Oturum ve erişim bilgileri.</p>
            </div>
          </header>

          {demoToken ? (
            <div className="settings-warning">
              <KeyRound size={17} />
              <div>
                <strong>Demo anahtarı kullanılıyor</strong>
                <p>
                  Sunucu <code>Norie-demo</code> anahtarıyla çalışıyor. İnternete açmadan önce
                  <code> MUSIC_TOKEN</code> değerini değiştir.
                </p>
              </div>
            </div>
          ) : (
            <div className="settings-ok">
              <Check size={16} />
              Özel sunucu anahtarı kullanılıyor.
            </div>
          )}

          <dl className="settings-list">
            <div>
              <dt>Oturum süresi</dt>
              <dd>30 gün</dd>
            </div>
            <div>
              <dt>Oturum biçimi</dt>
              <dd>HttpOnly çerez</dd>
            </div>
            <div>
              <dt>Sunucu anahtarı</dt>
              <dd>••••••••</dd>
            </div>
          </dl>

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
            <div><h2>Hesap</h2><p>Parola ve hesap gizliliği.</p></div>
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
              <p>Norie Music 0.8 · Yerel öncelikli müzik.</p>
            </div>
          </header>
          <p>
            Norie Music kendi barındırdığın arşivler için tasarlanmıştır. Uygulama DRM koruması
            barındırmaz ve üçüncü taraf platformlardan içerik indirmez. Yalnızca hak sahibi olduğun
            veya kullanım lisansına sahip olduğun dosyaları kullan.
          </p>
          <div className="legal-points">
            <span>
              <Database size={14} /> Yerel SQLite kütüphanesi
            </span>
            <span>
              <ShieldCheck size={14} /> Kendi sunucun, kendi verin
            </span>
            <span>
              <Clock3 size={14} /> Süresiz oturum seçeneği yok
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
