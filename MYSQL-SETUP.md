# Norie Music — MySQL Kurulumu

Veriler iki yerde tutulur:
- **SQLite** (`server/data/library.db`) — her zaman çalışan yerel kopya, müzik taraması buraya yazar.
- **MySQL** (`norie_music`) — kayıtlar, şarkılar, playlistler aynalanır (sql enjeksiyonuna kapalı, `?` placeholder).

MySQL kurulu değilse uygulama yine çalışır; `MYSQL_HOST` boşken aynalama atlanır.

## 1. MySQL kur (Windows)
MySQL Server kurucusunu çalıştırın, `norie` kullanıcısı + `norie_music` veritabanı oluşturun. Veya Workbench'te:
```sql
CREATE DATABASE norie_music CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'norie'@'localhost' IDENTIFIED BY 'guclu-parola';
GRANT ALL PRIVILEGES ON norie_music.* TO 'norie'@'localhost';
FLUSH PRIVILEGES;
```
Sonra `mysql/schema.sql` dosyasını çalıştırın.

## 2. `.env` (server)
```ini
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=norie
MYSQL_PASSWORD=guclu-parola
MYSQL_DATABASE=norie_music
```

## 3. Doğrulama
Sunucu başlayınca logda `MySQL bağlantısı kuruldu` görürsünüz. Kayıt olunca `users` tablosuna düşer, tarama sonrası `tracks` MySQL'de belirir.

## Güvenli SQL
- Tüm sorgular `?` placeholder ile hazırlanır.
- `execFile` ve `child_process` argüman dizisiyle çalışır (shell enjeksiyonu yok).
- `CORS_ORIGINS` yalnızca izinli originler.
