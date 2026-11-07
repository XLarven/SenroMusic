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
import { getServerUrl, setServerUrl } from '../lib/serverUrl';
import { useAuthStore } from '../store/auth';
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
      pushToast('SenroMusic ana ekranına eklendi.', 'success');
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

  const health = healthQuery.data;
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
              <p>SenroMusic sunucunun durumu.</p>
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

        <section className="settings-card settings-card-wide">
          <header className="settings-card-head">
            <span className="settings-icon">
              <Smartphone size={19} />
            </span>
            <div>
              <h2>Uygulama</h2>
              <p>SenroMusic'i her cihazında kullan.</p>
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
                  Sunucu <code>senro-demo</code> anahtarıyla çalışıyor. İnternete açmadan önce
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

        <section className="settings-card settings-legal">
          <header className="settings-card-head">
            <span className="settings-icon">
              <Info size={19} />
            </span>
            <div>
              <h2>Hakkında</h2>
              <p>SenroMusic 0.4 · Yerel öncelikli müzik.</p>
            </div>
          </header>
          <p>
            SenroMusic kendi barındırdığın arşivler için tasarlanmıştır. Uygulama DRM koruması
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
