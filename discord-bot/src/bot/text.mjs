// Bot metinleri: sözlük, yardım ve kişiyi hatırlayan selamlamalar. Tüm
// açıklamalar masaüstü TRACER'daki terim rehberiyle aynı dili kullanır.
export const GLOSSARY = {
  kast: { title: "KAST · Round katkısı", body: "Öldürme (K), asist (A), hayatta kalma (S) veya takaslanan ölüm (T) içeren roundların yüzdesi. TRACER'ın ana karnesi budur; profesyonel bir rating değildir. %70 üstü iyi, %80 üstü çok yüksek katkı sayılır." },
  adr: { title: "ADR · Round başına hasar", body: "Rakiplere verilen toplam hasarın oynanan round sayısına bölümü. Rol ve silaha göre değişir; tek başına iyi/kötü etiketi almaz." },
  hs: { title: "HS · Kafadan öldürme oranı", body: "Öldürmelerin kafaya isabetle bitenlerinin yüzdesi. Hiç öldürme yoksa ölçülemez (sıfır sayılmaz)." },
  takas: { title: "Takas (trade)", body: "Öldüğün oyuncunun beş saniye içinde takım arkadaşın tarafından öldürülmesi. Takaslanan ölüm KAST'a katkı sayar; takas oranı düşükse takımdan çok uzak oynuyorsundur." },
  tepki: { title: "Tepki süresi (görünürlükten ilk ateşe)", body: "Rakibin görüş hattına girdiği andan ilk atışına kadar geçen süre (ms). Harita geometrisi, duman ve bakış açısı ile yaklaşık hesaplanır; prefire ve belirsiz başlangıçlar ortalamaya katılmaz." },
  duello: { title: "Düello", body: "İki oyuncunun birbirini gördüğü ve biri ölünceye kadar süren temas. Kazanma oranı yalnız sonuçlanan düelloları kapsar; örnek sayısı azsa temkinli yorumla." },
  hareket: { title: "Hareket kontrolü", body: "Ateş anında hızının silahın doğruluk sınırının (max_speed'in %34'ü) altında olduğu atışların oranı. Düşükse koşarak ateş ediyorsun: önce dur (counter-strafe), sonra ateş et." },
  sprey: { title: "Burst / sprey", body: "İlk 3 mermi ile 4. ve sonraki mermilerin isabet oranı. Uzun seride isabet çok düşüyorsa burst'lere bölmeyi dene." },
  acilis: { title: "İlk düello (opening)", body: "Roundun ilk öldürmesi ve ilk ölümü. İlk ölümler takımın round kazanma ihtimalini ciddi düşürür; entry rolündeysen daha yüksek olması normaldir." },
  utility: { title: "Utility etkisi", body: "Bomba hasarı ve rakipleri kör etme süresi. TRACER yalnız rakibe doğrudan etki eden olayları sayar." },
  ekonomi: { title: "Ekonomi", body: "TRACER ekonomiyi puanlamaz; round başı para ve harcama yalnız bilgi olarak gösterilir." },
  olculemedi: { title: "Ölçülemedi / —", body: "Bu metrik için demoda yeterli örnek yok. Eksik ölçüm sıfır değildir ve karşılaştırmalara katılmaz." },
  t: { title: "T tarafı disiplini", body: "Alan al, erken ölme, default oyna, amaçlı utility, takas mesafesi, geç execute yapma, rotasyonu oku, tempoyu değiştir, sayı üstünlüğünü koru, bomba sonrası oyna — on kural demo zaman çizelgesinden ölçülür." },
  gsi: { title: "GSI (Game State Integration)", body: "CS2'nin resmî canlı veri özelliği. /canli kur ile aldığın dosyayı CS2 cfg klasörüne koyarsan maç bitince otomatik analiz ve takım için canlı plan tahtası çalışır." },
};

export function glossaryChoices(query = "") {
  const value = String(query).toLocaleLowerCase("tr-TR");
  return Object.entries(GLOSSARY)
    .filter(([key, item]) => !value || key.includes(value) || item.title.toLocaleLowerCase("tr-TR").includes(value))
    .slice(0, 25)
    .map(([key, item]) => ({ name: item.title.slice(0, 100), value: key }));
}

export const HELP_SECTIONS = [
  ["Başlarken", "`/baslat` karşılama · `/hesap steam` ve `/hesap faceit` bağlantı · `/hesap dogrula` Steam ile doğrulama · `/hesap durum` ayarlar"],
  ["Analiz", "`/analiz` dosya, Valve/FACEIT bağlantısı veya paylaşım kodu; boş bırakırsan büyük dosyalar için tek kullanımlık yükleme bağlantısı · `/kuyruk` bekleyen işler"],
  ["Maçların", "`/maclar` filtreli kütüphane · `/mac` takım tablosu, tepki, düello, silah/mesafe ve T tarafı sekmeleri"],
  ["Gelişim", "`/profil` oyuncu kartı · `/gelisim` eğilim grafikleri · `/karsilastir` iki oyuncu · `/faceit` ELO kartı"],
  ["Sunucu", "`/sunucu kur` maç raporu kanalı ve rol · `/liderlik` sıralama · `/sunucu test` örnek rapor"],
  ["Takım koçu", "`/takim kur` beşlini oluştur · `/takim rapor` roller · `/takim taktik` T taktikleri · `/takim plan` maç öncesi plan · `/takim canli baslat` round round canlı tahta"],
  ["Canlı", "`/canli kur` kişisel GSI dosyası: maç bitince yeni demo otomatik aranır"],
  ["Gizlilik", "Steam şifren veya çerezin istenmez. Kimlik kodun şifreli saklanır. `/hesap sil` bütün kişisel verini siler."],
];

function days(ms) {
  return Math.floor(ms / 86_400_000);
}

/** Kişiyi hatırlayan selamlama satırı. */
export function greeting({ user, previous, newMatches = 0, now = Date.now() }) {
  const name = user?.name || "oyuncu";
  if (!previous) return `Merhaba **${name}**, TRACER'a hoş geldin! Bundan sonra seni hatırlayacağım.`;
  const away = now - Number(previous.last_seen || now);
  const parts = [];
  if (away > 3 * 86_400_000) parts.push(`Tekrar hoş geldin **${name}**! ${days(away)} gündür görüşmüyorduk.`);
  else if (away > 6 * 3_600_000) parts.push(`Yine burada, **${name}** 👋`);
  if (newMatches > 0) parts.push(`O zamandan beri **${newMatches}** yeni maçın analiz edildi.`);
  return parts.join(" ");
}

export function relativeSince(timestamp, now = Date.now()) {
  const diff = now - Number(timestamp || now);
  const day = days(diff);
  if (day >= 365) return `${Math.floor(day / 365)} yıldır`;
  if (day >= 30) return `${Math.floor(day / 30)} aydır`;
  if (day >= 1) return `${day} gündür`;
  return "bugünden";
}

export function memberSince(timestamp, now = Date.now()) {
  const day = days(now - Number(timestamp || now));
  if (day >= 365) return `${Math.floor(day / 365)} yıl`;
  if (day >= 30) return `${Math.floor(day / 30)} ay`;
  if (day >= 1) return `${day} gün`;
  return "bugün";
}
