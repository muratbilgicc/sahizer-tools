# YKS Net Studio

Import/export web uygulamasi. Kaynak SINIF DERS NETLERI.xlsx dosyasini yukleyin ve guncellenmis YKS Excel'ini disa aktarin.

- Excel okuma, eslestirme ve cikti uretme islemleri tarayicida yapilir.
- MF, TM, TYT sayfalarini okur; TURKCE, MATEMATIK, SOSYAL, FEN sayfalarini doldurur.
- Hedef 1. ve 2. deneme sutunlaridir.
- Isterseniz kendi hedef .xlsx sablonunuzu yukleyebilirsiniz.
- Gomulu sablon ogrenci netleri icermez.
- .xlsx 15 MB siniri. Backend gerekmez.

## Calistirma

index.html dosyasini bir tarayicida acin.

## GitHub Pages

Settings > Pages > Deploy from a branch > main / (root) > Save.

## Lisans

Gomulu JSZip 3.10.1, MIT/GPLv3 lisanslidir; telif bildirimi index.html basindadir.

## Giriş ve erişim kontrolü

Uygulama üretim ortamında kullanıcı adı / şifre giriş ekranı ile korunur. `middleware.js` tüm uygulama rotalarında imzalı, süreli oturum çerezini doğrular; başarılı girişten sonra 8 saatlik oturum oluşturur ve üst menüden çıkış yapılabilir.

Gizli bilgiler GitHub'a yazılmaz. Vercel proje ortamında şu değişkenler tanımlı olmalıdır:
- `YKS_AUTH_USERNAME` — kullanıcı adı
- `YKS_AUTH_SALT` — PBKDF2 salt (base64url)
- `YKS_AUTH_HASH` — 180.000 iterasyon PBKDF2-SHA256 şifre özeti (base64url)
- `YKS_AUTH_SECRET` — imzalı oturumlar için güçlü rastgele anahtar (base64url)

Şifre hiçbir zaman tarayıcı tarafı JavaScript'e gömülmemelidir. Ortam değişkenleri eksikse doğrulama kapalı bir şekilde başarısız olur (fail-closed). GitHub deposunun public olması, uygulama kodunun görülebileceği anlamına gelir; canlı web erişimi ayrıca sunucu tarafındaki middleware üzerinden korunur.
