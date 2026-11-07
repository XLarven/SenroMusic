# Norie Music

Norie Music, kendi barındırdığınız müzik arşivini telefon, tablet ve bilgisayarlardan dinlemenizi sağlayan yerel öncelikli bir müzik uygulamasıdır. Tek bir kod tabanı; web (PWA), Windows (Electron) ve Docker ile kendi sunucunuzda çalışır.

## Özellikler

- Fastify + SQLite yerel kopya + MySQL senkronu (kayıtlar, şarkılar, playlistler)
- E-posta + parola ile kayıt/giriş, yönetici paneli (çevrimiçi + son aktif)
- Arama her zaman YouTube'da da arar; Spotify bağlantısını playlist olarak içe aktarır
- Metadata ve kapak resmi otomatik tarama
- Albüm, sanatçı, parça ve çalma listesi yönetimi
- Queue, karışık çalma, tekrar, ses, medya tuşları ve Media Session
- Range istekleri ile kesintisiz akış ve indirme
- PWA: ana ekrana ekleme, çevrimdışı arayüz, Service Worker
- Windows için Electron sarmalayıcı
- Türkçe arayüz, koyu tema, duyarlı tasarım

## Yasal kullanım

Norie Music yalnızca **hak sahibi olduğunuz veya kullanım lisansına sahip olduğunuz** dosyalar için tasarlanmıştır. Lütfen yalnızca kendi arşivinizdeki veya lisanslı müzik dosyalarınızı kullanın. Kütüphane dosyaları SQLite'da, MySQL senkronu opsiyoneldir.

## Gereksinimler

- Node.js 22+
- pnpm 10+
- (İsteğe bağlı) Docker / Docker Compose
- (İsteğe bağlı, Windows paketleme) Electron bağımlılıkları

## Hızlı başlangıç

```bash
pnpm install
pnpm demo          # demo kütüphane oluşturur (9 parça)
pnpm dev           # sunucu + web arayüzü
```

- Web arayüzü: http://localhost:5174
- API: http://127.0.0.1:8787
- İlk kayıt yönetici olur; sonrası normal kullanıcı

## Üretim derlemesi

```bash
pnpm build
pnpm start
```

Üretimde `server/.env` içinde `MUSIC_SESSION_SECRET` (32+ karakter) ve `SECURE_COOKIES=true` + `CORS_ORIGINS=https://music.norie.app` kullanın. MySQL için `mysql/schema.sql` dosyasını çalıştırıp `MYSQL_*` değişkenlerini doldurun.

## Yapılandırma

`server/.env` (veya ortam değişkenleri):

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `MUSIC_TOKEN` | Sunucu erişim anahtarı | `Norie-demo` (geliştirme) |
| `MUSIC_DIR` | Müzik klasörü | `server/music` |
| `DATA_DIR` | Veritabanı ve kapaklar | `server/data` |
| `PORT` | Sunucu portu | `8787` |
| `HOST` | Dinlenecek adres | `0.0.0.0` |
| `SECURE_COOKIES` | HTTPS çerezi (`true`/`false`/boş=otomatik) | otomatik |
| `CORS_ORIGINS` | İzin verilen originler | `http://localhost:5173,...` |
| `SCAN_ON_START` | Başlangıçta tarama | `true` |
| `MAX_SCAN_FILES` | Maksimum tarama dosyası | `50000` |

## Docker

```bash
cp server/.env.example .env   # gerekirse düzenleyin
docker compose up -d --build
```

- Müzik: `./music` → `/music`
- Veri: `./data` → `/data`
- Adres: http://localhost:8787

## Mobil (Android / iOS)

Web arayüzü Capacitor ile native mobil uygulamaya sarılabilir.

### Android (Windows/macOS/Linux)
```bash
pnpm --filter @Norie/web build
pnpm --filter @Norie/web cap:add:android   # ilk seferde
pnpm --filter @Norie/web cap:sync
pnpm --filter @Norie/web cap:open:android   # Android Studio'da aç
```
Android Studio'dan APK/AAB derleyip Play Store'a yükleyin. Sunucu adresini uygulama içi Ayarlar → Sunucu adresi alanından girin.

### iOS (yalnızca macOS)
```bash
pnpm --filter @Norie/web build
pnpm --filter @Norie/web cap:add:ios      # ilk seferde (macOS gerekir)
pnpm --filter @Norie/web cap:sync
pnpm --filter @Norie/web cap:open:ios     # Xcode'da aç
```
Xcode ile archive alıp App Store Connect'e yükleyin. Apple Developer hesabı ($99/yıl) gerekir.

### Sunucu adresi
Mobil uygulama ilk açılışta `http://127.0.0.1:8787` varsayar. Ayarlar sayfasından kendi sunucunuzun adresini (örn. `https://muzik.example.com`) girin ve kaydedin.

## Windows masaüstü (Electron)

```bash
pnpm desktop       # geliştirme
pnpm desktop:build # NSIS kurulum paketi (apps/desktop/release)
```

Masaüstü uygulama kendi sunucunuza bağlanır. İlk açılışta sunucu adresini girebilirsiniz.

## Mobil kullanım (PWA)

- Android: Chrome menüsünden “Ana ekrana ekle”
- iOS: Safari → Paylaş → “Ana Ekrana Ekle”
- Windows: Edge/Chrome ile “Uygulamayı yükle”

Native Android/iOS mağaza sürümleri Faz 2’de (Capacitor/EAS) planlanmaktadır.

## Testler

```bash
pnpm test          # sunucu testleri
pnpm --filter @Norie/web build
pnpm --filter @Norie/server build
```

## Proje yapısı

```
apps/
  web/        React + Vite PWA
  desktop/    Electron sarmalayıcı
server/       Fastify + SQLite + tarayıcı
```

## Lisans

Bu proje kişisel/kurumsal kendi barındırma kullanımına uygundur. Kullandığınız müzik dosyalarının lisans koşullarına uymak sizin sorumluluğunuzdadır.
