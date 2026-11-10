# YKS Net Studio

Import/export web uygulamasi. Kaynak SINIF DERS NETLERI.xlsx dosyasini yukleyin ve guncellenmis YKS Excel'ini disa aktarin.

- Excel okuma, eslestirme ve cikti uretme islemleri tarayicida yapilir.
- MF, TM, TYT sayfalarini okur; TURKCE, MATEMATIK, SOSYAL, FEN sayfalarini doldurur.
- Hedef 1. ve 2. deneme sutunlaridir.
- Hedef dosyadaki dolu hucreler (sayi, metin ve formuller dahil) aynen korunur. Yalnizca bos net hucreleri sinif, ders ve deneme anahtariyla kaynaktan tamamlanir.
- Kaynakta deger yoksa hedefe yazilmaz. Stiller, birlesik hucreler, satir/sutun olculeri, sayfa duzeni ve diger Excel bilesenleri yeniden olusturulmaz.
- Isterseniz kendi hedef .xlsx sablonunuzu yukleyebilirsiniz.
- Mevcut YKS dosyanizdaki degerleri ve bicimi korumak icin o dosyayi hedef olarak secin. Gomulu bos sablon kendi dosyanizin yerine gecmez.
- Gomulu sablon ogrenci netleri icermez.
- .xlsx 15 MB siniri. Backend gerekmez.

## Calistirma

index.html dosyasini bir tarayicida acin.

## Test

`npm install --no-save playwright` ve `npx playwright install chromium` sonrasinda `node tests/engine.test.cjs` calistirin. Mevcut bir Chromium tabanli tarayici icin `BROWSER_EXECUTABLE` tanimlanabilir.

Testler sentetik verilerle sinif/ders/deneme eslestirmesini, dolu hucrelerin korunmasini, XML namespace destegini, mukerrer hucre olusmamasini ve bicim XML'inin degismemesini kontrol eder.

## GitHub Pages

Settings > Pages > Deploy from a branch > main / (root) > Save.

## Lisans

Gomulu JSZip 3.10.1, MIT/GPLv3 lisanslidir; telif bildirimi index.html basindadir.

## Erişim

Giriş sistemi geçici olarak kaldırıldı. Uygulama bağlantısı doğrudan açılır. Uygulamaya yüklenen Excel dosyaları tarayıcı içinde işlenir. Site herkese açık olduğundan hassas dosyaların gizliliği için bağlantı paylaşımını dikkatle yönetin.
