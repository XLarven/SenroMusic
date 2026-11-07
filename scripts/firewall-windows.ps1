# Norie Music – Windows VDS güvenlik duvarı (PowerShell, Yönetici çalıştırın)
# Gerekli portları açar, uygulama portunu yalnızca localhost'a kilitler.

# 1) Windows Güvenlik Duvarı profilleri etkin
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True

# 2) HTTP/HTTPS (Caddy veya Cloudflare Tunnel kullanıyorsanız 80/443; doğrudan app kullanıyorsanız sadece 443)
New-NetFirewallRule -DisplayName "Norie HTTPS 443" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -Profile Any -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "Norie HTTP 80 (redirect)" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -Profile Any -ErrorAction SilentlyContinue

# 3) Tanner/Minecraft gibi gereksiz servisler kapalı kalsın diye doğrudan 8787'yi açMAYIN.
#    Uygulama 127.0.0.1:8787'de dinlenir, Caddy 443 üzerinden proxy eder.
#    (Yanlışlıkla açıldıysa silin:)
Remove-NetFirewallRule -DisplayName "Norie Music 8787" -ErrorAction SilentlyContinue | Out-Null

# 4) RDP (3389) – yalnızca kendi ev IP'nizi ekleyin! Örnek:
#    New-NetFirewallRule -DisplayName "RDP VPN-Only" -Direction Inbound -Protocol TCP -LocalPort 3389 -RemoteAddress 203.0.113.42 -Action Allow
#    Küresel RDP asla açık bırakılmamalı.

# 5) Doğrulama
Get-NetFirewallRule | Where-Object DisplayName -like "Norie*" | Get-NetFirewallPortFilter | Format-Table LocalPort, Protocol
Write-Host "Firewall hazır. Norie'nun 8787'si dışarıya kapalı, 443 üzerinden erişiliyor." -ForegroundColor Green

# Uygulama tarafında HOST=127.0.0.1 ve SECURE_COOKIES=true, güçlü MUSIC_TOKEN + MUSIC_SESSION_SECRET kullanın.
