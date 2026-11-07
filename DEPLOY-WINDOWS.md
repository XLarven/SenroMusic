# Norie Music'i Windows Sunucuda Genel Yayına Alma

Bu kılavuz, Norie Music'i Windows sunucunuzdan (VPS / ev PC'si / VPN makinesi) herkese açık bir web sitesi olarak yayınlamanızı sağlar.

## 1. Gereksinimler (sunucular)
- Node.js 22+ (`node -v`)
- pnpm 10+ (`pnpm -v`)
- Python 3.10+ ve gerekli paketler (YouTube indirici için):
  ```powershell
  pip install -U yt-dlp imageio-ffmpeg
  ```
- `python -m yt_dlp --version` ile kontrol edin.

## 2. Uygulamayı üretim modunda kurun
Sunucu makinesinde proje klasöründe:
```powershell
cd Norie Music
pnpm install
pnpm build
```
Not: `pnpm build` hem sunucuyu (`server/dist`) hem web arayüzünü (`apps/web/dist`) derler. Sunucu üretimde web dosyasını kendisi sunar — ayrı Vite sunucusu (5173) gerekmez, tek port (8787) yeter.

## 3. `.env` yapılandırması
`server/.env` dosyası oluşturun (yoksa `server/.env.example`'ı kopyalayın):
```ini
MUSIC_TOKEN=çok-güçlü-rastgele-bir-parola-32-karakterden-uzun
SECURE_COOKIES=true
HOST=0.0.0.0
PORT=8787
CORS_ORIGINS=https://muzik.ornek.com
MUSIC_SESSION_SECRET=başka-bir-güçlü-rastgele-parola
```
- `MUSIC_TOKEN` boş bırakılırsa `Norie-demo` kullanılır — **asla genel yayında boş bırakmayın**.
- `SECURE_COOKIES=true` HTTPS arkasında gereklidir.
- `CORS_ORIGINS` içine sitenizin tam adresini yazın.
- Müzik klasörü varsayılan: `server/music`. Başka bir yol için `MUSIC_DIR=C:\Muzikler` ekleyin.

## 4. Servis olarak çalışma (yeniden başlatmada otomatik açılsın)
Önerilen: PM2 for Windows
```powershell
npm i -g pm2 pm2-windows
cd Norie Music
pm2 start pnpm --name Norie Music -- start
pm2 save
pm2 startup
```
Alternatif: NSSM ile `node dist/index.js` komutunu servis olarak kurabilirsiniz. Çalışma dizini: `server` klasörü olmalı. Gerekirse `PYTHON_PATH=py` veya `PYTHON_PATH=C:\Python311\python.exe` ortam değişkeni ekleyin.

Kontrol:
```
curl http://127.0.0.1:8787/api/health
```

## 5. İnternete açma seçenekleri

### A) Cloudflare Tunnel (önerilen — port açmadan HTTPS)
VPN/router arkasındaysanız en kolayı budur. Port yönlendirme gerekmez.
```powershell
# cloudflared kurun: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
cloudflared tunnel login
cloudflared tunnel create Norie Music
cloudflared tunnel route dns Norie Music muzik.ornek.com
cloudflared tunnel run --url http://localhost:8787 Norie Music
```
Ardından `CORS_ORIGINS=https://muzik.ornek.com` yapıp servisleri yeniden başlatın. iPhone PWA için HTTPS zorunludur — Tunnel bunu ücretsiz verir.

### B) Caddy ters proxy + Let's Encrypt (doğrudan IP/host)
Alan adınız ve genel IP'niz varsa:
1. Yönlendiricide / VPN sağlayıcısında 80 ve 443 portlarını bu Windows makinesine yönlendirin.
2. Caddy kurup `Caddyfile` (örneğin `C:\Caddy\Caddyfile`):
   ```
   muzik.ornek.com {
       reverse_proxy 127.0.0.1:8787
   }
   ```
   `caddy run --config C:\Caddy\Caddyfile --adapter caddyfile` çalıştırın (sertifika otomatik alınır).
3. Windows Güvenlik Duvarı izni:
   ```powershell
   New-NetFirewallRule -DisplayName "Norie 8787" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow
   New-NetFirewallRule -DisplayName "Caddy 80-443" -Direction Inbound -LocalPort 80,443 -Protocol TCP -Action Allow
   ```

### C) Mevcut VPN'iniz üzerinden port yönlendirme
VPN sunucunuz (SoftEther / OpenVPN / WireGuard / Windows RRAS) zaten genel IP'ye sahipse, router/VPN panelinde 443 → Windows makinesi 8787 (veya Caddy üzerinden 443) yönlendirmesi yapın. Tercihen Caddy ile HTTPS ekleyin, doğrudan HTTP'ye açık bırakmayın.

## 6. Yayın sonrası test
- Giriş anahtarı = `.env` içindeki `MUSIC_TOKEN`
- Arama → YouTube sonuçları → İndir → MP3 `server/music/YouTube` altına düşmeli ve kütüphane güncellenmeli.
- Dış ağdan tarayıcıda `https://muzik.ornek.com` açın, giriş yapıp bir şarkı çalın.

## 7. Güvenlik / işletme notları
- `server/data` ve `server/music` klasörlerini yedekleyin (SQLite + müzikler).
- Windows Update ve sunucu güvenlik duvarını güncel tutun.
- Paylaşımlı sunucuda yalnızca bu uygulama için ayrı bir kullanıcı hesabı kullanın.
- YouTube indirme, yt-dlp'nin sunucuda güncel olması gerekir; periyodik `pip install -U yt-dlp` yapın.
