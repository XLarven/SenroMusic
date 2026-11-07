# SenroMusic — Windows'tan tek komutla tüm platformları derle
# Çalıştırma: powershell -ExecutionPolicy Bypass -File scripts/build-all-windows.ps1
# Ürettiği çıktılar:
#   apps/desktop/release/SenroMusic Setup *.exe  (Windows installer, NSIS + portable)
#   apps/web/android/app/build/outputs/apk/debug/app-debug.apk (Android, JDK ister)
#   apps/ios-swiftpm/ -> xtool ile Windows'tan IPA (Apple Developer hesabı gerekir)

$ErrorActionPreference = "Continue"
$root = Resolve-Path "$PSScriptRoot/.."
Write-Host "SenroMusic — tüm platformlar derleniyor: $root" -ForegroundColor Green

# 1) Web (PWA) + Server
Write-Host "`n[1/4] Web + Server derleniyor..." -ForegroundColor Cyan
Push-Location $root
& pnpm build
if ($LASTEXITCODE -ne 0) { Write-Host "Build başarısız" -ForegroundColor Red; exit 1 }
Pop-Location

# 2) Windows masaüstü (Electron NSIS + portable) — Windows'ta tam çalışır
Write-Host "`n[2/4] Windows masaüstü (Electron) derleniyor..." -ForegroundColor Cyan
Push-Location "$root\apps\desktop"
& pnpm build
if ($LASTEXITCODE -ne 0) { Write-Host "Desktop build başarısız" -ForegroundColor Red; exit 1 }
Pop-Location
Write-Host "  Çıktı: apps/desktop/release/" -ForegroundColor Green

# 3) Android (Capacitor) — JDK 17 + Android SDK gerekir
Write-Host "`n[3/4] Android APK derleniyor..." -ForegroundColor Cyan
$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) {
  Write-Host "  Java bulunamadı! Android için JDK 17 kurun: https://www.oracle.com/java/technologies/downloads/" -ForegroundColor Yellow
  Write-Host "  Atlandı — GitHub Actions ile otomatik derleyebilirsiniz (aşağıdaki BUILD-ALL-PLATFORMS.md)." -ForegroundColor Yellow
} else {
  Push-Location "$root\apps\web"
  & npm run cap:sync
  $androidDir = Join-Path $root "apps\web\android"
  if (-not (Test-Path $androidDir)) {
    Write-Host "  Android platform yok, ekleniyor..." -ForegroundColor Yellow
    & npx cap add android
  }
  & npx cap sync android
  Push-Location $androidDir
  & .\gradlew.bat assembleDebug
  $code = $LASTEXITCODE
  Pop-Location
  Pop-Location
  if ($code -ne 0) { Write-Host "  Android build başarısız (JDK/SDK eksik olabilir)" -ForegroundColor Yellow }
  else { Write-Host "  Çıktı: apps/web/android/app/build/outputs/apk/debug/app-debug.apk" -ForegroundColor Green }
}

# 4) iOS (xtool — Windows'tan IPA, Xcode'suz)
Write-Host "`n[4/4] iOS (xtool SwiftPM sarmalayıcı)..." -ForegroundColor Cyan
$xtool = Get-Command xtool -ErrorAction SilentlyContinue
if (-not $xtool) {
  Write-Host "  xtool kurulu değil — https://xtool.sh/documentation/xtooldocs/installation-linux" -ForegroundColor Yellow
  Write-Host "  Atlandı — iPhone için PWA (Safari > Ana Ekrana Ekle) de kullanılabilir." -ForegroundColor Blue
} else {
  Push-Location "$root\apps\ios-swiftpm"
  Write-Host "  xtool mevcut — Apple Developer hesabıyla 'xtool dev' çalıştırın (README bkz)." -ForegroundColor Green
  Pop-Location
}

Write-Host "`nBitti! Çıktılar:" -ForegroundColor Green
Write-Host "  - Windows: apps/desktop/release/*.exe"
Write-Host "  - Android: apps/web/android/app/build/outputs/apk/debug/*.apk"
Write-Host "  - iOS PWA: https://muzik.ornek.com (Safari > Ana Ekrana Ekle)"
Write-Host "  - iOS IPA (xtool): apps/ios-swiftpm/ + 'xtool dev'"
