# TRACER taşınabilir Windows paketi

Son kullanıcı yalnızca `TRACER-Yerel.cmd` dosyasına çift tıklar. Başlatıcı demo parserını ve arayüzü gizli olarak açar; Microsoft Edge veya Chrome'u adres çubuğu olmayan ayrı bir TRACER penceresi olarak kullanır. Pencere kapandığında başlatıcının açtığı yerel servisler de kapanır.

## Gömülü koç

Ollama zorunlu değildir. Paket aşağıdaki dosyalarla koçu tamamen çevrimdışı çalıştırır:

- `runtime\llama\llama-server.exe` ve aynı resmî llama.cpp Windows CPU paketindeki DLL dosyaları (güvenli yedek)
- `runtime\llama-cuda\llama-server.exe`, `ggml-cuda.dll` ve paketlenmiş CUDA 12.4 çalışma DLL'leri
- `model\coach.gguf` adıyla Qwen3 1.7B Q4_K_M modeli

Uygulama açılışta paket içindeki CUDA motoruna `--list-devices` cihaz taraması yaptırır. Uyumlu bir NVIDIA ekran kartı ve sürücüsü algılanırsa modelin tüm katmanları otomatik olarak GPU'ya aktarılır (`-ngl all`). CUDA başlatılamazsa veya koç isteği sırasında hata verirse aynı istek CPU motoruyla (`-ngl 0`) yeniden denenir; kullanıcı ayarı gerekmez. Son kullanıcıya tam CUDA Toolkit kurdurulmaz, ancak güncel NVIDIA ekran kartı sürücüsü gerekir.

Model yalnızca “Koçtan tavsiye al” düğmesine basıldığında ayrı bir işlemde yüklenir. Yanıt tamamlanınca bu işlem kapatılır; CUDA kullanılmışsa VRAM, CPU kullanılmışsa RAM bırakılır. Uygulama durum ekranı seçilen motoru ve kaynakların kapatıldığını doğrular. Koç raporunu maç bittikten sonra almak yine en sağlıklı kullanımdır.

Önerilen model yaklaşık 1.28 GB'tır: `ggml-org/Qwen3-1.7B-GGUF` deposundaki `Qwen3-1.7B-Q4_K_M.gguf`. İndirme betiği resmî llama.cpp Windows x64 CPU, CUDA 12.4 ve CUDA çalışma DLL paketlerini GitHub'ın yayımladığı SHA-256 özetleriyle doğrular.

## Dağıtım klasörünü hazırlama

Geliştirici bilgisayarında PowerShell ile `launcher\package-portable.ps1` çalıştırılır. Sonuç `release\TRACER-Portable` altında oluşur. Bu klasör RAR/ZIP yapılabilir; kaynak kodu veya kurulu Node.js gerektirmez.

Model ve llama.cpp dosyaları kaynak klasörde yoksa önce `launcher\download-embedded-ai.ps1`, ardından `launcher\package-portable.ps1` çalıştırılır. İlk betik yalnızca llama.cpp'nin resmî GitHub sürümünü ve Hugging Face üzerindeki ggml-org dönüştürmesini indirir. Büyük dosyalar repoya eklenmez; dağıtım arşivine eklenir.

## Yerel veriler

Oyuncu seçimi ve son 90 maçın küçük özetleri `%LOCALAPPDATA%\TRACER\data` altında saklanır. Demo dosyaları kopyalanmaz. Tarayıcı pencere profili ve hata logları da `%LOCALAPPDATA%\TRACER` altındadır.
