# Norie Music — Güvenli VDS Kurulumu

Amaç: Kendi VDS'inizde, yalnızca HTTPS üzerinden, yalnızca güçlü anahtarla girişe izin veren, dış ağa minimum port açarak yayına alma.

## Mimari (önerilen)

```
İnternet → 443 (Caddy, Let's Encrypt) → 127.0.0.1:8787 (Norie Music/Fastify)
```

- **8787 doğrudan internete açılMAZ.** `HOST=127.0.0.1` ile dinlenir.
- **80 → 443:** Caddy otomatik yönlendirir (HTTP→HTTPS).
- **RDP (3389) yalnızca kendi IP'nize** açılır veya VPN üzerinden bağlanılır.
- **Kullanıcı/oturum:** Tek güçlü `MUSIC_TOKEN` + HttpOnly oturum çerezi, 30 gün geçerli, brute-force korumalı.

## 1. VDS sertleştirme
1. Windows Update'i güncel tutun.
2. RDP'yi küresel açmayın. Kendi IP'nizi allowlist'e alın (aşağıdaki script).
3. Kullanılmayan servisleri kapatın (IIS, FTP vb. gerek yoksa).
4. `server/data` ve `server/music` klasörlerini düzenli yedekleyin.

## 2. Uygulama tarfı (zaten uygulandı)
- `POST /api/auth/login` : başarısız denemelerde **15 dk'da 10 deneme → 429**, `Retry-After` başlığı. Kaynak IP `X-Forwarded-For` üzerinden okunur (Caddy arkasında doğru).
- Üretimde `MUSIC_TOKEN` **en az 32 karakter**, `MUSIC_SESSION_SECRET` **zorunlu**. Token kısa ise sunucu başlamaz.
- Üretimde varsayılan `HOST=127.0.0.1` (dışarıdan doğrudan erişim yok).
- Başlıklar: `CSP`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HTTPS'de `HSTS`.
- `SECURE_COOKIES=true` iken çerez `Secure` ve `SameSite=None` (mobil çapraz site için) / `Lax` (HTTP dev).

## 3. `.env` (üretim)
```ini
NODE_ENV=production
MUSIC_TOKEN=xxxxxxxx-32+-karakter-rastgele
MUSIC_SESSION_SECRET=yyyyyyyy-32+-karakter-rastgele
SECURE_COOKIES=true
HOST=127.0.0.1
PORT=8787
CORS_ORIGINS=https://muzik.ornek.com
```
Üretimi için:
```powershell
# güçlü üretici (PowerShell)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]]) -replace '[\/:*?"<>|+=]',''
```
veya Windows Terminal'de `openssl rand -base64 32`.

## 4. Güvenlik duvarı (Windows VDS, yönetici PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\firewall-windows.ps1
```
Script: 80/443 açar, 8787'yi açmaz, tüm profilleri etkinleştirir.
RDP'yi kendi IP'nize kilitlemek için script içindeki örnek satırı aktif edin.

## 5. Ters proxy (Caddy)
1. `Caddyfile.example`'ı `C:\Caddy\Caddyfile` yapın, alan adınızı yazın.
2. Çalıştırın:
   ```powershell
   caddy run --config C:\Caddy\Caddyfile --adapter caddyfile
   ```
   Sertifika otomatik alınır, 443 dinlenir.
3. Alan adının `A` kaydının VDS IP'nize işaret ettiğinden emin olun.

## 6. Uygulamayı servis yapma (PM2)
```powershell
npm i -g pm2 pm2-windows
pnpm build
pm2 start pnpm --name Norie Music -- start
pm2 save
pm2 startup
```

## 7. Doğrulama
```powershell
# Yerel:
curl.exe http://127.0.0.1:8787/api/health
# Dışarıdan (kendi makinenizden):
curl.exe -i https://muzik.ornek.com/api/auth/me   # 401 bekleyin
curl.exe -i https://muzik.ornek.com/api/library   # 401 bekleyin
# Kendi anahtarınızla giriş yapmadan kütüphane görünmemeli.
```

## 8. Operasyon notları
- Token'ı sızdırırsanız hemen değiştirin ve `MUSIC_SESSION_SECRET`'i yenileyin (tüm oturumları geçersiz kılar).
- `yt-dlp`'yi güncel tutun: `pip install -U yt-dlp`
- Günlüklerde başarısız girişleri izleyin (`warn` seviyesinde).
