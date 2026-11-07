# SenroMusic — Kullanıcı Sistemi + Supabase (v0.4)

## Ne değişti?
- `MUSIC_TOKEN` tek giriş ekranı kaldırıldı. Yerine e-posta + parola ile **Kayıt Ol / Giriş Yap** geldi.
- İlk kayıt olan kullanıcı **admin** olur. Diğerleri normal kullanıcılardır.
- Her istekte `last_active_at` güncellenir. **Çevrimiçi = son 3 dakika içinde aktif**.
- Admin paneli: `/admin` — toplam kullanıcı, şimdi çevrimiçi, son 24 saat aktif, son 7 gün kayıt, kullanıcı listesi (ad, rol, durum, son aktif, kayıt tarihi, IP).
- Eski `MUSIC_TOKEN` ile giriş hâlâ çalışır (geliştirici / acil giriş): Login ekranında "Eski sunucu anahtarı ile gir" seçeneğini açın. Yeni UUID olmayan yerel kullanıcılar Supabase'e senkronlanmaz — hata vermez.

## Supabase opsiyonel — ne zaman lazım?
Müzik dosyaları SQLite'da kalır (VDS). Supabase'e giden tek şey **presence mirror**: `last_active_at`, e-posta, ad. Supabase kurulu değilse sistem %100 kendi DB'siyle çalışır. Analitik / backup için Supabase:

1. https://supabase.com → yeni proje açın (free tier yeterli).
2. Dashboard → Settings → API: `Project URL` ve `service_role` anahtarını kopyalayın.
3. Supabase SQL Editor → `supabase/001_profiles.sql` dosyasını çalıştırın.
4. `server/.env`'e ekleyin:

```ini
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...   # service_role, yalnızca sunucuda tutulur
ALLOW_REGISTRATION=true
```

`SUPABASE_URL` dolu ise health `supabaseEnabled: true` döner. Kullanıcılar UUID ise (ileride Supabase Auth'a tam göçte) `last_active_at` otomatik senkron olur.

## Yayın / ortam özeti (.env)
```ini
NODE_ENV=production
SECURE_COOKIES=true
HOST=127.0.0.1
PORT=8787
CORS_ORIGINS=https://muzik.ornek.com
MUSIC_SESSION_SECRET=<32+ rastgele karakter>
ALLOW_REGISTRATION=true
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
# MUSIC_TOKEN yalnızca legacy acil giriş için; yeni kurulumda boş bırakılabilir
```
İlk kurulumda kayıt açık kalmalı; herkes kaydolsun istemiyorsanız sonra `ALLOW_REGISTRATION=false` yapın.

## Güvenlik notları
- Parolalar `scrypt` ile hashlenir, düz metin saklanmaz.
- Login rate-limit: 15 dk'da 20 deneme → 429.
- Oturum: HttpOnly + Secure (HTTPS) cookie, `SameSite=Lax` (HTTP dev) / `None` (HTTPS mobil).
- Admin istatistikleri sadece `role=admin` kullanıcılara açıktır (`GET /api/admin/*`).
