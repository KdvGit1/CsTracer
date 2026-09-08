# Test, portable ve yayın akışı

Hazırlığı Codex tamamlar: üretim derlemesi, tüm testler, lint, tür kontrolü, portable açılış kontrolü ve RAR bütünlük kontrolü.
Mevcut `release/TRACER-Portable` klasörü güncellenir; sürüm başına yeni çalıştırma klasörü açılmaz.

Hazırlık komutu (yayın yapmaz):

```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\publish-release.ps1 -NewVersion 0.51.3 -BuildOnly
```

Kullanıcının çalıştıracağı yayın komutu:

```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\publish-release.ps1 -NewVersion 0.51.3 -PublishOnly
```

`TRACER-Patch-Yayinla.cmd` de korunur. Hazır sürüm bulunduğunda aynı paketleri doğrulayarak yayınlar; tekrar test/derleme/RAR üretmez. Kaynak veya paket hazırlıktan sonra değişirse yayın durur.

Çıktılar: patch ZIP, güncelleyici düzeltme ZIP'i ve model/Node/CPU/CUDA dahil portable RAR.
Uygulamayı her zamanki `release/TRACER-Portable/TRACER-Yerel.cmd` üzerinden aç.
Kişisel veriler `%LOCALAPPDATA%/TRACER` altında kalır.
