# TRACER 0.51.1 — Daha doğal Türkçe, daha akıcı arayüz

- Discord PNG raporu yeniden tasarlandı: büyük harita/skor, alt satırlı takım tablosu, seçili oyuncu vurgusu ve kısa rakip özeti. Bütün bilgiler yine tek PNG'de; yeni sunucu veya harici görsel servisi yoktur. Eksik ölçümler sıfır sayılmaz ve bilinmeyen tarih bugünün tarihiyle doldurulmaz.

- Başlangıç, analiz, gelişim ve takım koçu ekranlarında uzun ve yapay ifadeler sadeleştirildi. KAST ve diğer terimlerin açıklamaları yenilendi.
- Ekran açılışları, sıralı kart girişleri, grafik çizimi, pencereler ve butonlar için kısa animasyonlar eklendi. İstatistikler animasyon uğruna değiştirilmez.
- Menüdeki **Hareketi azalt** tercihi cihazda saklanır. Sistemin hareket azaltma tercihi ve canlı maç performans modu korunur; görünmeyen sekmede animasyonlar duraklar.
- Yeni ücretli servis, sunucu veya animasyon kütüphanesi yoktur. Mevcut Steam bağlantısı, analizler ve son 5 maç tarih düzeltmesi korunur.

## Portable ve yayın

Tam kurulum: `release/TRACER-Portable-v0.51.1.rar`. Yeni klasöre çıkarıp `TRACER-Yerel.cmd` dosyasını çalıştır. Mevcut kayıtların `%LOCALAPPDATA%\TRACER\data` içinde kalır; bu klasörü silme.

Mevcut kullanıcılar: `TRACER-Patch-v0.51.1.zip`. Eski güncelleyicide yedekleme hatası varsa `TRACER-Guncelleyici-Duzeltmesi-v0.51.1.zip` kurtarma paketi için `PORTABLE.md` rehberini izle.

Hazır olduğunda PowerShell'i `D:\CsTracker` içinde aç:

```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\publish-release.ps1 -NewVersion 0.51.1
```

Bu komut test, build ve paketlemeden sonra commit/tag/push ve GitHub Release işlemlerini yapar. Yalnız yerel paket üretmek için `-BuildOnly` ekle. Kod değişiklikleri yayın öncesi `git status` ile gözden geçirilmelidir.

Eski kaydedilmiş koç raporlarının metni otomatik değiştirilmez. Yeni koç raporları sade Türkçe yönergesiyle üretilir; modelin her cümlesinin kusursuz olması garanti edilmez.
