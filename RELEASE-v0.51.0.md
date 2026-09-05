# TRACER 0.51.0 — Kişisel Performans Merkezi

## Neler değişti?

- **Son 5 tarih düzeltmesi:** indirme/açılma sırası değil kayıtlı maç tarihi kullanılır. Bildirimden rapor açılması maç kimliğini korur; sunucu yanlış istemci tarihini bilinen maç tarihiyle düzeltir. Manuel demolarda dosya tarihi kullanılır; tarihi bilinmeyen kayıtlar son beş karşılaştırmasına katılmaz.

- **Başlangıç:** kişisel profil, son beş maçın KAST/ADR/HS ortalamaları, önceki beş maçla farklar, son kayıtlar ve hızlı erişimler. Karşılaştırmanın iki grubunda da en az üç geçerli ölçüm gerekir. Ortalamalar maç başınadır; profesyonel derecelendirme değildir.
- **Maç kütüphanesi:** harita, oyuncu, tarih ve sonuçla filtreleme; en yeni/en eski sıralama; aktif indirme/analiz ve bekleyen sıra. Tekrar tıklayarak iptal etme korunur.
- **Steam:** tarama isteği yerel servisten hemen kabul yanıtı alır; Steam'in uzak yanıtı ayrı bir arka plan işidir. Bütün tetikleyiciler aynı işi paylaşır. İkinci ekran fazladan periyodik tarama başlatmaz. Son başarılı tarama tarihi, kısmi sonuç, oturum süresi dolması ve yerel servis kesintisi birbirinden ayrılır.
- **Oturum güvenilirliği:** tarama sırasında çerez yenilenirse eski cevap yeni oturumu ezmez; yeni bilgilerle tekrar taranır. Ağ zaman aşımı otomatik olarak “yeni key gir” anlamına gelmez. Mevcut çerezin boş bırakıldığında korunması devam eder.
- **Analiz:** round katkısı, sprey/burst, hareket ve düello için kanıt kapsamı; kalıcı metrik sözlüğü. Hitbox örneği yoksa yapay %0 dağılımı gösterilmez. Konum verisi yoksa “güçlü” konum yorumu verilmez. Hareket açıklamasındaki “her 10 atış” gerçek silah sınırı ihlalini kullanır; örneksiz silah kategorileri %0 sayılmaz.
- **Kullanım:** gruplanmış menü, sade analiz araç çubuğu, bütün ekranlarda sürüm/ayarlar/kapatma, klavye odağı, küçük ekran düzeni, sınırlı ondalık K/D gösterimi.
- Önceki **Discord PNG takım tablosu**, takım koçu, kişisel gelişim, portable çalışma ve güncelleme kurtarması korunur. Ekonomi puanlanmaz. Analiz için rastgele fallback yoktur.

## Steam hızı hakkında önemli sınır

Uygulamanın gezinmesi ve yerel kayıt işlemleri Steam yanıtını beklemez. Bu değişiklik Steam Community'nin kendisinin veya kullanıcının VPN/DNS/ağının her zaman hızlı olacağını garanti etmez. Yeni `/steam/scan` API'si başlangıç için `202` döner; sonuç ayrı okunur. Mevcut `/steam/scan-now` endpoint'i eski istemciler için korunur.

## Portable sürümü kullanma

1. Açık TRACER'ı kendi **Kapat** düğmesinden tamamen kapat.
2. İlk kurulum / temiz uygulama klasörü için `release/TRACER-Portable-v0.51.0.rar` dosyasını yeni bir klasöre çıkar. RAR içinden çalıştırma; GitHub'ın “Source code” arşivini portable paket sanma.
3. `TRACER-Yerel.cmd` dosyasını aç. Geliştirici bilgisayarındaki açılmış kopya: `release/TRACER-Portable/TRACER-Yerel.cmd`.
4. Aynı Windows kullanıcısının kayıtları `%LOCALAPPDATA%\TRACER\data` içinde kalır. Bu klasörü silme. Başka bilgisayara taşıma ayrı bir veri taşıma işlemidir; portable uygulama paketi hesap bilgilerini içermez.

## Yayımlama

Bu çalışma yalnız yerel paket hazırlar; GitHub'a kendiliğinden yayın yapmaz.

PowerShell'i `D:\CsTracker` klasöründe aç. GitHub CLI kurulu ve hesabına giriş yapılmış olmalı. Hazır olduğunda:

```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\publish-release.ps1 -NewVersion 0.51.0
```

Bu komut test/build/paketleme yapar, ardından Git commit/tag/push ve GitHub Release işlemlerini yürütür. Yayınlamadan yalnız yeniden paketlemek için sonuna `-BuildOnly` ekle. Betiğin Git'e ekleyeceği değişiklikleri önceden `git status` ile gözden geçir.

Release'e eklenen dosyalar:

- `TRACER-Portable-v0.51.0.rar`: model ve çalışma zamanı dahil tam kurulum.
- `TRACER-Patch-v0.51.0.zip`: mevcut portable kullanıcıları için güncel uygulama dosyaları; ara sürümleri tek tek kurmak gerekmez.
- `TRACER-Guncelleyici-Duzeltmesi-v0.51.0.zip`: eski güncelleyicide yedekleme sorunu yaşayanlar için bir defalık kurtarma; normal patch değildir. Ayrıntılar `PORTABLE.md` içindedir.

## Doğrulama kapsamı

Yeni hesaplama/filtre/tek-tarama işi testleri, mevcut regresyon testleri, lint, TypeScript, üretim build'i ve portable paket kontrolleri yayın kapısındadır. Arayüz kontrolü yalnız `work/experience-ui-data` içindeki açıkça etiketlenmiş sentetik maçlarla yapılır; bu veriler dağıtım paketine konmaz. Kullanıcının Steam çereziyle canlı giriş veya gerçek Discord kanalına mesaj gönderme bu testin parçası değildir.
