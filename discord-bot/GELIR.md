# Bu bot bir gelir kapısı olabilir mi?

**Kısa cevap:** Evet, ama ilk aylarda küçük bir yan gelir beklemek gerçekçi; tek başına geçim
kaynağı olması için ciddi bir kullanıcı tabanı gerekir. Sunucu maliyeti Oracle Always Free
sayesinde başta sıfıra yakın. Asıl iş ödeme altyapısında, dağıtımda ve rekabette.

## 1. Türkiye'den ödeme alma (en kritik engel)

| Yol | Durum |
| --- | --- |
| **Discord Premium Apps** (Discord içinde abonelik/SKU) | Discord'un belgelerine göre yalnız **ABD, Birleşik Krallık ve AB**'deki geliştiricilere açık. Türkiye'deki bir geliştirici şu an doğrudan kullanamaz. Bot buna hazır: bölge açılırsa (ya da AB'de bir şirketin olursa) `PREMIUM_SKU_IDS` ile çalışır. |
| **Patreon** | ABD dışı içerik üreticilerine Payoneer ile ödeme seçeneği sunuyor. Kendi hesabında Türkiye'nin listelendiğini kontrol et. |
| **Türk ödeme sağlayıcıları** (Shopier, iyzico, PayTR vb.) | Premium kodu/aylık paket satıp botta `/admin premium kullanici:@kişi gun:30 not:"Shopier #123"` ile elle tanımlayabilirsin. Otomatik webhook entegrasyonu henüz yok. |
| Stripe / PayPal | Stripe Türkiye'deki hesapları desteklemiyor, PayPal 2016'dan beri Türkiye'de çalışmıyor; bunlara dayalı platformlar (Ko-fi vb.) sorun çıkarabilir. |

Kumar/kasa açma (skin gambling) sponsorlukları yaygın ama Türkiye'de hukuken ve Valve
kuralları açısından riskli; önermem.

## 2. Botta hazır olan gelir altyapısı

- `FREE_DAILY_ANALYSES` → ücretsiz planda günlük analiz sınırı (0 = sınırsız). Otomatik takipte
  bulunan maçlar da sayılır.
- Kullanıcı premium'u ve **sunucu premium'u** (sunucuda kullanan herkesin sınırı kalkar):
  `/admin premium` ile süreli tanımlanır.
- Discord SKU hakları (`interaction.entitlements`) otomatik tanınır.
- `/premium` komutu planı ve `SUPPORT_URL` bağlantısını gösterir.

## 3. Örnek paketler

Botta şu an yalnız **günlük analiz sayısı** sınırlanıyor. Takım koçu gibi özellikleri pakete
bağlamak istersen küçük bir kod eklemesi gerekir.

| Paket | İçerik |
| --- | --- |
| Ücretsiz | Günde 2–3 analiz; profil, FACEIT kartı, liderlik, takım koçu |
| Bireysel premium | Sınırsız analiz (otomatik takipte bulunan maçlar dahil) |
| Takım/sunucu paketi | Sunucuda komut kullanan herkese sınırsız analiz; takım/akademi için ideal |

En yüksek ödeme isteği büyük ihtimalle **amatör takımlar, akademiler ve koçlarda**: takım koçu
(demolardan T taktiği, rol dağılımı, canlı round tahtası) rakiplerde nadir bulunan özellik.

Kabaca bir hesap (tahmin değil, örnek): 2.000 aktif kullanıcının %2–3'ü ayda ~75 TL öderse ayda
yaklaşık 3.000–4.500 TL eder. Ödeme sağlayıcı kesintileri ve vergi bundan düşülür.

## 4. Maliyet ve ölçek sınırları

- Oracle A1 (2 OCPU / 12 GB) aynı anda bir demo analiz eder; tam maç 1–4 dakika sürer.
  Saatte kabaca 15–40 analiz. Bunun üstü ücretli işlemci demek.
- Oracle, boşta kalan Always Free örnekleri geri alabilir. Gelir için kullanacaksan hesabı
  Pay As You Go'ya yükselt (ücretsiz sınırlar içinde $0) ve düzenli yedek al
  (`data/tracer-bot.sqlite` + `data/analyses`).
- Discord: bot 100 sunucuyu geçmeden doğrulama ister (75 sunucuda başvurabilirsin). Botun
  ayrıcalıklı intent kullanmaması doğrulamayı kolaylaştırır. Doğrulama ve olası ücretli plan için
  **Hizmet Şartları ve Gizlilik Politikası** sayfası hazırla (KVKK; bot `/hesap sil` ile silmeyi destekliyor).

## 5. Yasal ve kurallar açısından dikkat

- **Steam Web API** şartları günlük 100.000 çağrı sınırı koyuyor; ticari kullanım için şartları
  kendin oku. Leetify ve Scope.gg gibi demo analizi yapan ücretli servisler var, yani alan
  kendi başına yasak değil.
- **FACEIT** Data API'nin ticari kullanım şartlarını FACEIT Developer Portal'da kontrol et.
  Downloads API ayrıca onay istiyor.
- Radar görselleri ve çarpışma ağları Valve'a ait (topluluk araçlarında yaygın kullanılıyor).
- Vergi: Türkiye'de bu gelir ticari kazanç sayılabilir. Patreon bağışlarıyla ilgili bir özelge
  tartışması var. Başlamadan bir mali müşavire danış.

## 6. Rekabet

Ücretsiz ve güçlü alternatifler var: Leetify ve top.gg'deki "CS2 Stats" gibi istatistik
botları. Farkın şunlar olmalı:
**Türkçe**, **demo düzeyinde** tepki/düello/T tarafı analizi, **sunucuya otomatik maç raporu** ve
**takım koçu**. Büyümek için İngilizce desteği (motorun koçluk metinlerinin çevirisi) en büyük kaldıraç.

## 7. Önerilen yol haritası

1. **0–3 ay:** Ücretsiz yayın, Türk CS2 Discord sunucuları ve FACEIT toplulukları, top.gg kaydı.
   Kullanım ve geri bildirim topla.
2. **3–6 ay:** `FREE_DAILY_ANALYSES` aç; Patreon (Payoneer) veya Shopier ile premium; takımlara
   sunucu paketi.
3. **Sonra:** İngilizce, Discord Premium Apps (bölge açılırsa), ödeme webhook entegrasyonu,
   gerekirse ücretli işlemci.

### Kaynaklar

- Discord Premium Apps bölgeleri: https://support-dev.discord.com/hc/en-us/articles/17299902720919-Premium-Apps-Payout ·
  https://docs.discord.com/developers/monetization/enabling-monetization
- Patreon ödeme yöntemleri: https://support.patreon.com/hc/en-us/articles/115004029783-Adding-your-payout-details
- Steam Web API şartları: https://steamcommunity.com/dev/apiterms
- Oracle Always Free: https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm ·
  kota düşüşü haberi: https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/
- Rakip örneği: https://top.gg/bot/1015320963040149555
