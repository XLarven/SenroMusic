# Norie Music — iOS (xtool, Windows'tan derleme)

Bu sarmalayıcı, **Xcode olmadan Windows'tan iOS IPA** üretebilmeniz için [xtool](https://github.com/xtool-org/xtool) (SwiftPM tabanlı, çapraz platformlu Xcode alternatifi) ile çalışır.

## Neden bu var?
Capacitor'ın iOS projesi Xcode (`.pbxproj` + CocoaPods) ister ve Windows'ta derlenemez. Bu SwiftPM sarmalayıcı ise düz SwiftUI + WebKit kullanır; xtool onu Windows/Linux/macOS'tan derleyebilir.

## Kurulum (Windows)
1. xtool kurun: https://xtool.sh/documentation/xtooldocs/installation-linux
2. Apple Developer hesabı (iOS dağıtım için zorunlu): https://developer.apple.com
3. xtool ile giriş: `xtool auth` (Apple Developer hesabı)
4. Bundle ID kaydedin (otomatik oluşturulur, Team ID ile eşleşmeli)

## Derleme
```powershell
cd apps/ios-swiftpm
xtool dev          # derle + cihaza kur + çalıştır (geliştirme)
```
Dağıtım (App Store / TestFlight):
```powershell
xtool build --configuration release
# IPA çıktısı: .xtool/build/... altında oluşur
```

## Çalışma mantığı
- WKWebView, aynı web sürümüyle aynı origin'i yükler (PWA ile birebir aynı UI).
- Sunucu adresi uygulama içinde kaydedilir (`UserDefaults`), Ayarlar ile web sürümüyle aynı adresi kullanın (örn. `https://muzik.ornek.com`).
- Ücretli Apple Developer hesabınız yoksa gerçek cihaz yerine **PWA** kullanın: Safari'de siteyi açın → Paylaş → Ana Ekrana Ekle.

## Not
- Bu sarmalayıcı Native API (push, media-session entegrasyonu) içermez; tüm müzik akışı web sürümündendir.
- Capacitor iOS (`cap add ios`) alternatif sunucusu da vardır, o ise macOS + Xcode ister.
