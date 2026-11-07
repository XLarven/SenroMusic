# Norie Music — Windows VDS + Cloudflare Tunnel (Node.js, Docker yok)

Domain: https://music.norie.app
Mimari: `İnternet → Cloudflare Tunnel (443/HTTPS) → 127.0.0.1:8787 (Norie Music)`

## 0) Ön hazırlık (yalnızca bir kez)
1. https://www.cloudflare.com → alan adı `norie.app` Cloudflare'de olmalı. "DNS Records" sayfasında kayıt gerekmez — Tunnel komutu oluşturur.
2. Windows VDS'e RDP ile bağlanın. İlk kuruluma kadar SSH/RDP'yi kendi IP'nize kilitleyin.

## 1) Node.js + Python kur (Windows sanal sunucusu)
1. https://nodejs.org → **LTS 22.x** indir, kurulumda **"Add to PATH"** işaretli olsun.
2. Yeni PowerShell (normal kullanıcı yeterli, yönetici değil):
   ```powershell
   node -v    # v22.x
   npm -v
   npm install -g pnpm@10.15.1
   pnpm -v
   ```
3. Python (YouTube indirici için):
   ```powershell
   # https://www.python.org/downloads/ → "Add python.exe to PATH" işaretli kurun, sonra:
   pip install -U yt-dlp imageio-ffmpeg
   python -m yt_dlp --version
   ```

## 2) Kodu getirip kur (pnpm workspace)
```powershell
cd C:\
git clone https://github.com/XLarven/Norie Music norie-music
cd norie-music
pnpm install
pnpm build
```
Not: Klasör adı `norie-music` olsa da repo `XLarven/Norie Music` — bu normal, proje adı "Norie Music"tir.

## 3) .env oluştur (server klasöründe)
`server\.env` dosyası açıp şunu yazın (anahtarları kendiniz üretin):

```ini
NODE_ENV=production
SECURE_COOKIES=true
HOST=127.0.0.1
PORT=8787
CORS_ORIGINS=https://music.norie.app
MUSIC_SESSION_SECRET=PASTE-32+KARAKTER-RASTGELE
ALLOW_REGISTRATION=true
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
MUSIC_TOKEN=
```

Güçlü gizli üretimi (PowerShell):
```powershell
[System.Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]]) -replace '[\/:*?"<>|+=]',''
```
İki kez çalıştırın: biri `MUSIC_SESSION_SECRET`, diğeri ileride bir kullanıcının parolası için saklayın (parolalar sunucuda hashlenir, burada tutmaya gerek yok).

Test:
```powershell
cd server
pnpm start
# Başka PowerShell: curl.exe http://127.0.0.1:8787/api/health
```

## 4) Windows servisi (yeniden başlatmada otomatik)
```powershell
npm i -g pm2 pm2-windows
cd C:\norie-music
pm2 start pnpm --name norie-music -- start
pm2 save
pm2 startup
pm2 logs norie-music
```
Müzik dosyaları: `C:\norie-music\server\music\` altına atın, siteye girip Ayarlar → Kitaplığı tara.

## 5) Cloudflare Tunnel (port açmadan HTTPS)
1. https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/downloads/windows/ → `cloudflared.exe` indirip `C:\Caddy\` yerine `C:\Cloudflare\` klasörüne koyun (ya da PATH'e ekleyin).
2. PowerShell (yönetici gerekmez):
   ```powershell
   cd C:\Cloudflare
   .\cloudflared.exe tunnel login     # tarayıcıda Cloudflare hesabınızla giriş yapın
   .\cloudflared.exe tunnel create norie-music
   .\cloudflared.exe tunnel route dns norie-music music.norie.app
   ```
   Komut çıktısında verdiği `<TUNNEL-ID>` not edin.
3. `config.yml` açın (`C:\Users\<user>\.cloudflared\config.yml`):
   ```yaml
   tunnel: <TUNNEL-ID>
   credentials-file: C:\Users\<user>\.cloudflared\<TUNNEL-ID>.json
   ingress:
     - hostname: music.norie.app
       service: http://127.0.0.1:8787
     - service: http_status:404
   ```
4. Servis yapın (yönetici PowerShell):
   ```powershell
   .\cloudflared.exe service install
   Get-Service cloudflared
   ```
   Veya geçici test için: `.\cloudflared.exe tunnel run --url http://localhost:8787 norie-music`

## 6) Güvenlik duvarı (yalnızca gerekli portlar)
VDS sağlayıcı panelinde + Windows Defender'da **sadece 443 (HTTPS)** ve **3389 (RDP, kendi IP'nizle)** açık kalsın. **8787'yi dışarıya açmayın** — Tunnel zaten 127.0.0.1'e bağlanır.
```powershell
New-NetFirewallRule -DisplayName "Norie 443" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
# RDP örneği (kendi IP'niz):
# New-NetFirewallRule -DisplayName "RDP VPN-Only" -Direction Inbound -Protocol TCP -LocalPort 3389 -RemoteAddress 203.0.113.42 -Action Allow
```

## 7) Test
- Tarayıcı: https://music.norie.app → Kayıt Ol (ilk kullanıcı admin olur) → Giriş yap.
- YouTube: Arama → İndir → `server\music\YouTube` altında oluşmalı.
- Admin: `/admin` → kullanıcı sayısı + çevrimiçi (son 3 dk).

> Supabase opsiyonel: `SUPABASE-SETUP.md` bakın. Boş bırakırsanız sistem SQLite ile çalışır.
