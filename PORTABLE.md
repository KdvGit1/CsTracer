# TRACER taşınabilir Windows paketi

Son kullanıcı yalnızca `TRACER-Yerel.cmd` dosyasına çift tıklar. Başlatıcı demo parserını ve arayüzü gizli olarak açar; Microsoft Edge veya Chrome'u adres çubuğu olmayan ayrı bir TRACER penceresi olarak kullanır. Pencere kapandığında başlatıcının açtığı yerel servisler de otomatik olarak tamamen kapanır.

Acil veya manuel durdurma gerektiğinde klasördeki `TRACER-Kapat.cmd` dosyasına çift tıklanarak tüm arka plan servisleri ve tarayıcı profili tek tıkla sonlandırılabilir; CS2 için tüm sistem kaynakları serbest kalır.

## Gömülü koç

Ollama zorunlu değildir. Paket aşağıdaki dosyalarla koçu tamamen çevrimdışı çalıştırır:

- `runtime\llama\llama-server.exe` ve aynı resmî llama.cpp Windows CPU paketindeki DLL dosyaları (güvenli yedek)
- `runtime\llama-cuda\llama-server.exe`, `ggml-cuda.dll` ve paketlenmiş CUDA 12.4 çalışma DLL'leri
- `model\coach.gguf` adıyla Qwen3 1.7B Q4_K_M modeli

Uygulama açılışta paket içindeki CUDA motoruna `--list-devices` cihaz taraması yaptırır. Uyumlu bir NVIDIA ekran kartı ve sürücüsü algılanırsa modelin tüm katmanları otomatik olarak GPU'ya aktarılır (`-ngl all`). CUDA başlatılamazsa veya koç isteği sırasında hata verirse aynı istek CPU motoruyla (`-ngl 0`) yeniden denenir; kullanıcı ayarı gerekmez. Son kullanıcıya tam CUDA Toolkit kurdurulmaz, ancak güncel NVIDIA ekran kartı sürücüsü gerekir.

Model yalnızca “Koçtan tavsiye al” düğmesine basıldığında ayrı bir işlemde yüklenir. Yanıt tamamlanınca bu işlem kapatılır; CUDA kullanılmışsa VRAM, CPU kullanılmışsa RAM bırakılır. Uygulama durum ekranı seçilen motoru ve kaynakların kapatıldığını doğrular. Koç raporunu maç bittikten sonra almak yine en sağlıklı kullanımdır.

Önerilen model yaklaşık 1.28 GB'tır: `ggml-org/Qwen3-1.7B-GGUF` deposundaki `Qwen3-1.7B-Q4_K_M.gguf`. İndirme betiği resmî llama.cpp Windows x64 CPU, CUDA 12.4 ve CUDA çalışma DLL paketlerini GitHub'ın yayımladığı SHA-256 özetleriyle doğrular.

## Discord takım karnesi

Bildirimler düğmesinden **Depolama ve Otomasyon → Discord Maç Raporlayıcısı** açılır. Önerilen kurulum webhook modudur:

1. Discord sunucusunda **Sunucu Ayarları → Entegrasyonlar → Webhook'lar → Yeni Webhook** yolunu açın.
2. Raporların gönderileceği kanalı seçin ve webhook URL'sini kopyalayın.
3. URL'yi TRACER'a yapıştırın, **Maç bitince Discord'a gönder** seçeneğini açın ve **Test görseli gönder** düğmesine basın. Tamamlanmış bir analiz varsa son maçın gerçek tablosu, yoksa örnek tablo PNG olarak gönderilir.

Webhook kurulumunun resmî anlatımı: `https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks`

Gelişmiş bot modu için `https://discord.com/developers/applications` adresinde bir uygulama/bot oluşturulur. Bot sunucuya **Mesaj Gönder** ve **Bağlantı Yerleştir** izinleriyle eklenir; token ve hedef kanal kimliği TRACER'a girilir. Bu yalnız dışarı mesaj atan yerel bir bot olduğundan Gateway ve Message Content Intent gerekmez.

Discord özelliği açıldığında son maçı otomatik indirme de açılır. Analiz tamamlanınca tüm rapor tek bakışta okunabilen PNG tablo olarak gönderilir: kullanıcının kendi takımındaki en fazla beş oyuncu ayrıntılı sütunlarla, rakip oyuncular ise aynı görseldeki tek kısa rakip takım bölümünde gösterilir. Discord yanıt vermese bile demo analizi bitmeye devam eder; kuyruk `%LOCALAPPDATA%\TRACER\data\discord_outbox.json` içinde korunup sonraki açılışta sürdürülür. Webhook URL'si veya bot tokenı `%LOCALAPPDATA%\TRACER\data\discord_config.json` içinde yalnız yerel olarak tutulur; portable ve patch paketlerine dahil edilmez.

## Dağıtım klasörünü hazırlama

Geliştirici bilgisayarında PowerShell ile `launcher\package-portable.ps1` çalıştırılır. Sonuç `release\TRACER-Portable` altında oluşur. Bu klasör RAR/ZIP yapılabilir; kaynak kodu veya kurulu Node.js gerektirmez.

Model ve llama.cpp dosyaları kaynak klasörde yoksa önce `launcher\download-embedded-ai.ps1`, ardından `launcher\package-portable.ps1` çalıştırılır. İlk betik yalnızca llama.cpp'nin resmî GitHub sürümünü ve Hugging Face üzerindeki ggml-org dönüştürmesini indirir. Büyük dosyalar repoya eklenmez; dağıtım arşivine eklenir.

## Yerel yayın doğrulaması

Git'e veya GitHub'a hiçbir şey göndermeden testleri, lint kontrolünü, üretim build'ini, patch ZIP'i ve model dahil portable RAR'ı üretmek için:

```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\publish-release.ps1 -NewVersion 0.51.0 -BuildOnly
```

Komut başarılı olduğunda şu üç dosya hazır olmalıdır:

- `release\TRACER-Patch-v0.51.0.zip`
- `release\TRACER-Guncelleyici-Duzeltmesi-v0.51.0.zip`
- `release\TRACER-Portable-v0.51.0.rar`

`release\TRACER-Portable` klasörü de RAR ile aynı sürümün açılmış, doğrudan çalıştırılabilir kopyasıdır. `BuildOnly` hiçbir commit, tag, push veya GitHub Release oluşturmaz.

## Arkadaşlara dağıtım ve tek tık güncelleme

GitHub CLI bir kez kurulup `gh auth login` ile giriş yapıldıktan sonra yeni sürüm tek komutla yayınlanır:

```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\publish-release.ps1 -NewVersion 0.51.0
```

Betik sürümü senkronize eder; test, lint ve TypeScript kontrollerini geçmeden devam etmez; üretim build'ini alır ve GitHub Release'e üç dosya yükler:

- `TRACER-Portable-vX.Y.Z.rar`: uygulamayı ilk kez kuracaklar için model ve runtime dahil tam paket.
- `TRACER-Patch-vX.Y.Z.zip`: uygulaması bulunanlar için hafif güncelleme.
- `TRACER-Guncelleyici-Duzeltmesi-vX.Y.Z.zip`: eski v0.50.3/v0.50.4 güncelleyicisi yedekleme hatası veren kullanıcılar için bir defalık kurtarma.

Kullanıcı ilk kurulumu yalnızca bir kez `https://github.com/KdvGit1/CsTracer/releases/latest` adresinden indirir. Daha sonraki sürümlerde TRACER içindeki **Güncelle → 1-Tıkla Şimdi Güncelle** düğmesi doğru patch asset'ini indirir, SHA-256 bütünlüğünü doğrular, yedek alır, yamayı uygular ve uygulamayı yeniden başlatır. Güncelleme deposu herkese açık olmalıdır; özel repoya erişim anahtarı uygulamaya gömülmez.

### v0.50.3/v0.50.4 güncelleyici geçiş düzeltmesi

İlk v0.50.3 ve v0.50.4 portable paketlerindeki yedekleyici kök dosyaları klasör gibi kopyaladığı için otomatik yama güvenlik amacıyla durabiliyordu. Bu eski kurulumlar için bir defaya mahsus düzeltme paketi oluşturulur:

```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\create-updater-hotfix.ps1
```

Oluşan `release\TRACER-Guncelleyici-Duzeltmesi-v0.50.6.zip` dosyası GitHub'daki v0.50.6 sürümüne eklenir. v0.50.3 veya v0.50.4 kullanan kişi TRACER'ı kapatır, ZIP içeriğini mevcut portable klasörünün üzerine çıkarır ve yalnızca `companion\updater.mjs` dosyasının değiştirilmesini onaylar. Ardından uygulamayı açıp normal Güncelle düğmesiyle doğrudan v0.50.6'ya geçer. Oyuncu verileri ile model pakete dahil değildir.

## Yerel veriler

Oyuncu seçimi, son 90 maçın analiz geçmişi, Bildirim Merkezi verileri ve Discord gönderim ayar/kuyruğu `%LOCALAPPDATA%\TRACER\data` altında saklanır. Steam'den indirilen ham `.dem` dosyalarının adedi kullanıcı tarafından 3-50 arasında ayarlanır; kota aşılınca yalnızca en eski ham demolar temizlenir, analiz ve Takım Koçu kanıtları korunur. Tarayıcı pencere profili ve hata logları da `%LOCALAPPDATA%\TRACER` altındadır.
