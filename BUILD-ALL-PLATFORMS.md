# Norie Music — Windows'tan Tüm Platformlara Derleme

Hedef: **Tambir Windows makinesi** ile tüm çıktıları üretmek.
GitHub'a push edince CI otomatik derler, yerel isterseniz aşağıdaki adımları izleyin.

| Hedef | Windows'ta yerel derleme | GitHub Actions (push) |
|-------|---------------------------|------------------------|
| **Web (PWA)** | `pnpm build` → `apps/web/dist` | `build-web` job |
| **Windows masaüstü (Electron)** | `pnpm desktop:build` → NSIS + portable | `build-desktop-windows` (windows-latest) |
| **Android (Capacitor APK)** | JDK 17 + SDK ile `pnpm mobile:android:build` | `build-android` (ubuntu-latest) |
| **iOS (Capacitor, Xcode)** | ❌ Windows'ta Xcode yok — macOS ister | `build-ios-macos` (macos-latest, Windows'tan push ile çalışır) |
| **iOS (xtool, Xcode'suz — önerilen Windows yolu)** | ✅ `xtool dev` (SwiftPM) | — |
| **iOS (PWA Ana Ekrana Ekle)** | ✅ Hiç derlemesiz — Safari | — |

## 1. Tek komutla (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-all-windows.ps1
```
Script sırayla yapar:
1. Web + server derlenir
2. Windows Electron NSIS + portable (`apps/desktop/release/`)
3. Android APK (JDK varsa, yoksa uyarır)
4. xtool kontrolü (kurulu değilse PWA önerir)

## 2. Windows masaüstü
```powershell
pnpm install
pnpm desktop:build:win
# Çıktı: apps/desktop/release/Norie Music Setup *.exe (+ portable)
```
Ek: macOS/Linux derlemek için `build:mac` / `build:linux` hazır ama **o OS'te** çalıştırılmalı.

## 3. Android (yerel Windows)
Gereksinim: JDK 17 + Android Studio (SDK).
```powershell
pnpm --filter @Norie/web cap:add:android   # ilk sefer
pnpm mobile:android:build                  # debug APK
```
CI'da hiç bunlara gerek yok — push edin, GitHub Actions APK üretir.

## 4. iOS — iki yol
### A) PWA (ücretsiz, anında)
1. Siteyi `https://muzik.ornek.com` yayınlayın (Caddy/VDS)
2. Safari (iPhone) → aç → Paylaş → Ana Ekrana Ekle → uygulama gibi açılır.

### B) xtool — Windows'tan IPA (Apple Developer hesabı gerekir)
[xtool](https://github.com/xtool-org/xtool) Xcode'un çapraz platformlu (Linux/Windows/macOS) yerine geçen SwiftPM aracıdır. Capacitor'ın Xcode projesi (`.pbxproj` + CocoaPods) xtool ile derlenemez, bu yüzden `apps/ios-swiftpm/` altına **SwiftPM sarmalayıcı** yazıldı (SwiftUI + WebKit, sunucu adresi aynı).

```powershell
# xtool kurulumu:
# https://xtool.sh/documentation/xtooldocs/installation-linux
xtool auth
cd apps/ios-swiftpm
xtool dev          # cihaza kur + çalıştır
xtool build --configuration release
```
Apple Developer hesabı olmadan gerçek cihaza imza atılamaz; hesabınız yoksa PWA kullanın veya CI'daki `build-ios-macos` job'ını kullanın (o da imzalı dağıtım için hesabını ister).

### C) Capacitor + Xcode (klasik yol)
`npx cap add ios` **macOS + Xcode** ister — Windows'ta çalışmaz. Bunu GitHub'daki `build-ios-macos` job'ı sizin için yapar: push edin, artifact'i indirin.

## 5. GitHub Actions
`.github/workflows/build.yml` push'ta çalışır:
- `build-desktop-windows` → `desktop-windows` artifact (NSIS)
- `build-android` → `android-debug` artifact (APK)
- `build-ios-macos` → `ios-build` artifact
Actions sekmesinden indirebilirsiniz — Windows'tan derlemiş gibi olursunuz.

## 6. Hızlı kontrol
```powershell
node -v # 22+
pnpm -v # 10+
java -version # Android için 17 (yoksa CI kullanın)
xtool --version # iOS xtool için
```
