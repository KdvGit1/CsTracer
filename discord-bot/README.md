# TRACER Discord Botu

TRACER masaüstü CS2 koçunun (v0.53.0) Discord'a taşınmış hâli. Demo analizi, tepki süresi,
düello analisti, T tarafı disiplini, kişisel gelişim ve takım koçu Discord içinde çalışır.
Bot **seni hatırlar**: bağlı hesapların, maç geçmişin, ayarların ve bir demoda hangi oyuncu
olduğun sunucular ve DM'ler arasında seninle gelir.

- **Bireysel kullanım:** Uygulamayı "Kullanıcıya ekle" ile kurarsan her sunucuda ve DM'de
  kendi komutların olur. Sonuçlar gerekirse sana özel (ephemeral) gösterilir.
- **Toplu kullanım:** Sunucuya eklersen maç raporu kanalı, rol bildirimi, liderlik tablosu,
  oyuncu karşılaştırma ve beşli takım koçu (canlı round tahtası dahil) açılır.
- **Oracle Always Free:** Ampere A1 (ARM) üzerinde çalışır; yerel derleme gerektiren paket yok
  (SQLite Node'un içinden, görsel çizici ve demo ayrıştırıcı hazır ARM ikilileriyle gelir).

## Özellikler (v0.53.0 karşılıkları)

| Masaüstü v0.53.0 | Botta |
| --- | --- |
| Discord maç PNG'si (skor alanı, oyuncu satırları, rakip özeti, terim rehberi) | `/mac` → Takım tablosu, sunucu rapor kanalı |
| Takım tepki grafiği (renkli oyuncular, medyan, dağılım; eksik ölçüm sıfır çizilmez) | `/mac` → Tepki |
| Düello Analisti: tüm atışlar, olay yeri radarı, nişangah şeması, filtreler | `/mac` → Düello (önceki/sonraki, filtre, "Tüm atışlar") |
| Silah/mesafe profilleri | `/mac` → Silah/Mesafe |
| T tarafı 10 kural disiplini | `/mac` → T tarafı, `/takim rapor` |
| Veri kapsamı paneli, KAST/ADR/HS açıklamaları | `/mac` → Veri kapsamı, `/sozluk` |
| Son 5 maç (tarih sırası) KAST/ADR/HS + önceki 5 ile kıyas | `/profil`, `/gelisim` |
| Maç kütüphanesi (harita/sonuç/kaynak/arama/sıralama) | `/maclar` |
| FACEIT bağlantısı, maç geçmişi, Downloads API ile demo, .dem/.dem.gz yükleme | `/hesap faceit`, `/faceit`, `/analiz` |
| Steam maç takibi | Resmî paylaşım kodu API'si (`/hesap steam` + kimlik kodu); çerez istenmez |
| Discord raporlayıcı: kalıcı kuyruk, tekrar göndermeme, Retry-After, rol bildirimi, forum | `/sunucu kur` (otomatik), 📣 düğmesi |
| Takım Koçu: roller, T taktikleri (kim nereye, utility zamanı), aşamalı plan | `/takim rapor`, `/takim taktik`, `/takim plan` |
| Canlı takım planı (GSI ile round round güncellenen mesaj) | `/canli kur` + `/takim canli baslat` |
| Kişisel gelişim hafızası | Demodaki **bütün bağlı oyuncuların** geçmişine otomatik eklenir |

Masaüstüne özgü olanlar (Electron penceresi, 1 tık güncelleyici, oyun performans modu,
animasyonlar) botta karşılığı olmadığı için yok. Masaüstündeki yerel yapay zekâ koçu
istenmediği için bota eklenmedi; analizin kanıta dayalı notları rapor görselinde durur.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `/baslat` | Karşılama kartı, hızlı Steam/FACEIT bağlama ve demo yükleme |
| `/hesap steam · dogrula · faceit · durum · kaldir · sil` | Hesap bağlama, Steam OpenID doğrulama, ayarlar, KVKK silme |
| `/analiz [dosya] [baglanti] [paylasim-kodu] [oyuncu]` | Demo analizi; boş bırakırsan büyük dosyalar için tek kullanımlık yükleme bağlantısı |
| `/kuyruk` | Bekleyen analizler ve iptal |
| `/maclar` · `/mac` | Maç kütüphanesi ve sekmeli analiz |
| `/profil` · `/gelisim` · `/karsilastir` · `/faceit` | Oyuncu kartı, eğilim grafikleri, karşılaştırma, ELO kartı |
| `/liderlik` | Sunucu sıralaması (KAST, ADR, HS, K/D, galibiyet, maç sayısı) |
| `/sunucu kur · durum · test · kapat · liderlik` | Rapor kanalı, rol, test görseli (Sunucuyu Yönet izni) |
| `/takim kur · rapor · taktik · plan · canli · liste · sil` | Takım koçu |
| `/canli kur · durum` | Kişisel CS2 GSI dosyası ve canlı durum |
| `/radyo cal [istasyon] · dur` | Bulunduğun ses kanalına gelip Türk radyosu çalar (aşağıya bak) |
| `/sozluk` · `/yardim` · `/premium` · `/admin` | Sözlük, rehber, plan bilgisi, bot sahibi araçları |
| Sağ tık → Uygulamalar | "TRACER profili", "TRACER ile karşılaştır" |

## Radyo

`/radyo cal` yazan kişinin ses kanalına gelir ve seçilen radyoyu çalar. İstasyon listesi
[Radio Browser](https://www.radio-browser.info/) açık veritabanından gelir: Türkiye'deki ve
yurt dışındaki Türkçe yayınların hepsi (yüzlerce istasyon), dinlenme sayısına göre sıralı.
Liste `data/radio-stations.json`'da saklanır ve günde bir yenilenir.

- **İstasyon seçme:** `istasyon:` alanına yazmaya başla (ör. "kral", "trt", "rap"); boş bırakırsan
  popüler istasyonlar menüsü gelir.
- **Panel:** çalan istasyon, logosu ve yayın gönderiyorsa çalan şarkı. Menüden istasyon değiştir,
  🔀 rastgele, ⏹️ durdur. Botla aynı ses kanalındakiler yönetebilir.
- **Kendiliğinden:** yayın koparsa yeniden bağlanır; kanalda kimse kalmayınca 2 dakika sonra çıkar.
- **Bot sahibi** listede olmayan bir yayının bağlantısını (`https://…`) doğrudan çalabilir.
- **Gerekenler:** sunucuda `ffmpeg` (kurulum betiği kurar) ve botun ses kanalında **Bağlan** ve
  **Konuş** izni. Analiz sürerken ses takılmasın diye analiz düşük öncelikte çalışır.

## Demo nasıl gelir?

1. **Discord eki:** `/analiz dosya:` — Nitro'suz hesaplarda Discord sınırı 10 MB olduğundan
   çoğu tam maç demosu için uygun değil.
2. **Yükleme bağlantısı:** `/analiz` (boş) → 1 saatlik tek kullanımlık web sayfası, 800 MB'a kadar.
   `PUBLIC_URL` gerekir.
3. **Bağlantı:** Valve replay (`replayNNN.valve.net/730/...dem.bz2`) veya FACEIT demo bağlantısı.
   Başka sunuculara istek atılmaz (SSRF koruması); her yönlendirme yeniden doğrulanır.
4. **Paylaşım kodu:** `/analiz paylasim-kodu:` — botun ayrı bir Steam hesabı (`STEAM_BOT_*`) varsa
   oyun koordinatöründen demo bağlantısı alınır.
5. **Otomatik takip:** Steam kimlik kodu + son paylaşım kodu veya FACEIT hesabı bağlıysa yeni
   maçlar `TRACKER_INTERVAL_MIN` dakikada bir aranır. CS2 GSI bağlıysa maç biter bitmez bakılır.

Valve demoları yaklaşık 2–4 hafta saklar. Demo dosyaları analizden sonra silinir; yalnız sonuçlar
(sıkıştırılmış analiz + kişisel özet) tutulur.

## Kurulum

### 1. Discord uygulaması

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** sekmesi → **Reset Token** → `.env` içindeki `DISCORD_TOKEN`. Ayrıcalıklı (privileged)
   intent gerekmez.
3. **Installation** sekmesi → hem **Guild Install** hem **User Install** açık; Guild Install
   kapsamları `bot` ve `applications.commands`.
4. Davet bağlantıları (`CLIENT_ID` = Application ID):
   - Sunucuya ekle: `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=309240908800`
     (Kanalı gör, Mesaj gönder, Bağlantı yerleştir, Dosya ekle, Mesaj geçmişi, Gönderi/başlık aç)
   - Kendine ekle: `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&integration_type=1&scope=applications.commands`

Slash komutları bot ilk açıldığında otomatik kaydedilir (`DEV_GUILD_ID` verirsen yalnız o sunucuya,
anında). Elle: `npm run deploy-commands`.

### 2. Oracle Cloud Always Free

1. Oracle hesabında **Compute → Create instance**: şekil **VM.Standard.A1.Flex** (Ampere ARM),
   imaj **Ubuntu 22.04/24.04**. 2 OCPU / 12 GB yeterli (bazı kaynaklara göre Always Free A1
   kotası Haziran 2026'da 4 OCPU/24 GB'tan 2 OCPU/12 GB'a düştü; konsoldaki kotana bak).
   1 GB'lık AMD "micro" şekli **yetmez** — tam maç analizi 2–6 GB RAM kullanır.
2. SSH ile bağlan ve kur:
   ```bash
   # Dal: bot main'e birleştirilene kadar claude/funny-mayer-lrcqy5
   BRANCH=main
   curl -fsSLO https://raw.githubusercontent.com/KdvGit1/CsTracer/$BRANCH/discord-bot/deploy/oracle-setup.sh
   sudo bash oracle-setup.sh https://github.com/KdvGit1/CsTracer.git $BRANCH
   ```
   Betik Node 22, yazı tipleri, 4 GB swap, `tracer` kullanıcısı, bağımlılıklar, radar
   görselleri ve sertleştirilmiş systemd servisini kurar. Sonunda **yalnız bot token'ını** sorar,
   Discord'a sorarak doğrular, botu başlatır ve sunucuya ekleme bağlantısını yazar. Uygulama
   kimliği ve bot sahibi (sen) Discord'dan otomatik öğrenilir.
3. **İsteğe bağlı web adresi** (yükleme bağlantısı, Steam doğrulama, CS2 canlı): ücretsiz bir
   DuckDNS alt alan adını VM'in genel IP'sine yönlendir, `sudo OPEN_HTTP=1 bash oracle-setup.sh`
   ile 80/443'ü aç, Oracle konsolunda VCN **Security List**'e 80 ve 443 ingress kuralı ekle,
   `deploy/Caddyfile.example` ile Caddy kur ve `.env`'de `PUBLIC_URL=https://...` yaz.

**Oracle'a özgü uyarılar:** Always Free A1 bölgelerde sık sık "Out of capacity" verir; tekrar
dene ya da başka bölge seç. Oracle'ın belgelerine göre 7 gün boyunca CPU, ağ ve bellek kullanımı %20'nin altında
kalan Always Free örnekleri geri alabilir; bot boşta çok az kaynak kullandığı için en güvenli yol
hesabı **Pay As You Go**'ya yükseltmektir (Always Free sınırları içinde kaldıkça ücret çıkmaz,
geri alma uygulanmaz).

### 3. Yerelde çalıştırma / geliştirme

```bash
cd discord-bot
npm ci
npm run maps          # radar görselleri (Valve varlıkları; depoya eklenmez)
cp .env.example .env  # doldur
npm run check         # kurulum kontrolü
npm start
npm test              # 45 test; Discord bağlantısı gerektirmez
npm run preview       # kart tasarımlarını preview/ klasörüne çizer
node scripts/e2e-demo.mjs mac.dem.gz   # gerçek demo ile uçtan uca deneme
```

## Ayarlar

Bütün ayarlar `.env.example` içinde açıklamalı. Özet:

| Değişken | Açıklama |
| --- | --- |
| `DISCORD_TOKEN` | Zorunlu (tek gereken) |
| `DISCORD_CLIENT_ID`, `OWNER_IDS` | Boş bırakılabilir; Discord'dan otomatik öğrenilir |
| `PUBLIC_URL`, `HTTP_PORT`, `HTTP_HOST` | Web yükleme, Steam doğrulama, GSI |
| `STEAM_API_KEY` | Özel profil adı çözme, Steam adı/avatarı, paylaşım kodu takibi |
| `STEAM_BOT_USERNAME/PASSWORD/SHARED_SECRET` | Paylaşım kodundan demo (ayrı hesap!) |
| `FACEIT_API_KEY`, `FACEIT_DOWNLOADS_TOKEN` | FACEIT geçmişi; onaylı tokenla otomatik demo |
| `ANALYSIS_CONCURRENCY`, `ANALYSIS_MEMORY_MB`, `MAX_DEMO_MB` | Sunucu kaynakları |
| `FREE_DAILY_ANALYSES`, `PREMIUM_SKU_IDS`, `SUPPORT_URL` | Gelir/limit ayarları (bkz. [GELIR.md](GELIR.md)) |

## Gizlilik ve güvenlik

- Steam şifresi, çerezi veya oturumu **hiç istenmez**. Steam bağlantısı OpenID ile doğrulanır.
- Steam maç geçmişi kimlik kodu AES-256-GCM ile şifreli saklanır; sırlar loglarda maskelenir.
- `/hesap sil` bütün kişisel verileri siler. "Herkese açık profil" kapalıysa kişi liderlik
  tablosunda, karşılaştırmada ve otomatik sunucu raporlarında görünmez.
- Demo indirme yalnız Discord, Valve replay ve FACEIT demo sunucularına yapılır; boyut ve dosya
  imzası (PBDEMS2) doğrulanır. Analiz ve görsel çizimi ayrı süreçlerde çalışır; biri çökse bot ayakta kalır.

## Mimari

```
src/index.mjs          giriş: Discord istemcisi, servisler, bakım
src/bot/               komut tanımları, yönlendirici, işleyiciler, maç görünümü
src/analysis/          güvenli indirme, kalıcı kuyruk, ayrı süreçte analiz, kayıt akışı
src/services/          FACEIT, Steam, web (yükleme/OpenID/GSI), canlı, takip, rapor kutusu, premium
src/render/            SVG kartlar → PNG (resvg, Inter yazı tipi, gerçek glif genişlikleri)
src/db.mjs             SQLite hafıza (kullanıcılar, sunucular, maçlar, gelişim, işler, takımlar)
engine/                TRACER v0.53.0 analiz motoru (bkz. engine/README.md)
```

Yazı tipi: Inter (SIL OFL 1.1, `assets/fonts/OFL.txt`). Harita görselleri ve çarpışma ağları Valve'a aittir.
