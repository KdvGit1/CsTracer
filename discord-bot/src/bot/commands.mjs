// Slash komut tanımları (Discord API JSON). Komutlar hem sunucuya eklenen bot
// olarak hem de kullanıcıya kurulan uygulama olarak (DM'de, her sunucuda)
// çalışacak şekilde işaretlenir; sunucu yönetimi gerektirenler yalnız sunucuda.
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const USER = 6;
const CHANNEL = 7;
const ROLE = 8;
const ATTACHMENT = 11;
const SUB = 1;
const GROUP = 2;

const EVERYWHERE = { integration_types: [0, 1], contexts: [0, 1, 2] };
const GUILD_ONLY = { integration_types: [0], contexts: [0] };
const MANAGE_GUILD = String(1 << 5);

export const MAP_CHOICES = [
  ["Mirage", "mirage"], ["Inferno", "inferno"], ["Nuke", "nuke"], ["Ancient", "ancient"], ["Anubis", "anubis"],
  ["Dust II", "dust2"], ["Train", "train"], ["Overpass", "overpass"], ["Vertigo", "vertigo"], ["Cache", "cache"],
].map(([name, value]) => ({ name, value }));

const mapOption = (required = false, description = "Harita") => ({ type: STRING, name: "harita", description, required, choices: MAP_CHOICES });
const squadOption = { type: STRING, name: "takim", description: "Takım (boş bırakırsan son takımın)", autocomplete: true };

export const COMMANDS = [
  {
    name: "baslat",
    description: "TRACER'ı tanı: hesabını bağla, ilk analizini yap, seni hatırlayayım",
    ...EVERYWHERE,
  },
  {
    name: "yardim",
    description: "Komut rehberi ve sık sorulanlar",
    ...EVERYWHERE,
  },
  {
    name: "hesap",
    description: "Steam/FACEIT hesabını bağla, ayarlarını ve verilerini yönet",
    ...EVERYWHERE,
    options: [
      {
        type: SUB, name: "steam", description: "Steam'i bağla: boş bırak, QR'ı Steam uygulamasıyla okut; maçların kendiliğinden gelir",
        options: [
          { type: STRING, name: "profil", description: "Boş bırak: QR ile bağlan (önerilen). Ya da profil bağlantın / SteamID64", max_length: 200 },
          { type: STRING, name: "kimlik-kodu", description: "Maç geçmişi kimlik kodu (XXXX-XXXXX-XXXX) — otomatik takip için", max_length: 20 },
          { type: STRING, name: "son-kod", description: "En son maçının paylaşım kodu (CSGO-...) — otomatik takip için", max_length: 40 },
        ],
      },
      { type: SUB, name: "dogrula", description: "Steam ile giriş yaparak hesabın sana ait olduğunu doğrula" },
      {
        type: SUB, name: "faceit", description: "FACEIT hesabını bağla",
        options: [{ type: STRING, name: "kullanici", description: "FACEIT kullanıcı adın veya profil bağlantın", required: true, max_length: 120 }],
      },
      { type: SUB, name: "durum", description: "Bağlı hesapların, ayarların ve TRACER'ın senin hakkında hatırladıkları" },
      {
        type: SUB, name: "kaldir", description: "Bir hesap bağlantısını kaldır",
        options: [{ type: STRING, name: "hesap", description: "Kaldırılacak bağlantı", required: true, choices: [{ name: "Steam", value: "steam" }, { name: "FACEIT", value: "faceit" }] }],
      },
      { type: SUB, name: "sil", description: "Bütün kişisel verilerini kalıcı olarak sil (KVKK/GDPR)" },
    ],
  },
  {
    name: "analiz",
    description: "CS2 demosu analiz et: dosya, bağlantı, paylaşım kodu ya da yükleme bağlantısı",
    ...EVERYWHERE,
    options: [
      { type: ATTACHMENT, name: "dosya", description: ".dem, .dem.gz veya .dem.bz2 (büyük dosyalar için boş bırak, yükleme bağlantısı vereyim)" },
      { type: STRING, name: "baglanti", description: "Valve replay (replayNNN.valve.net) veya FACEIT demo bağlantısı", max_length: 1500 },
      { type: STRING, name: "paylasim-kodu", description: "CS2 maç paylaşım kodu (CSGO-xxxxx-...)", max_length: 40 },
      { type: STRING, name: "oyuncu", description: "Demodaki oyuncu adın veya SteamID'n (hesap bağlı değilse)", max_length: 80 },
    ],
  },
  { name: "kuyruk", description: "Bekleyen ve süren analizlerini gör, istersen iptal et", ...EVERYWHERE },
  {
    name: "maclar",
    description: "Maç kütüphanen: harita, sonuç ve kaynağa göre filtrele",
    ...EVERYWHERE,
    options: [
      mapOption(false),
      { type: STRING, name: "sonuc", description: "Sonuç", choices: [{ name: "Galibiyet", value: "W" }, { name: "Mağlubiyet", value: "L" }, { name: "Beraberlik", value: "T" }] },
      { type: STRING, name: "kaynak", description: "Kaynak", choices: [{ name: "Steam (Premier/Rekabetçi)", value: "steam" }, { name: "FACEIT", value: "faceit" }, { name: "Yüklenen demo", value: "upload" }] },
      { type: STRING, name: "sirala", description: "Sıralama", choices: [{ name: "En yeni", value: "newest" }, { name: "En eski", value: "oldest" }] },
      { type: STRING, name: "ara", description: "Oyuncu adı veya harita ara", max_length: 60 },
    ],
  },
  {
    name: "mac",
    description: "Bir maçın tam analizi: takım tablosu, tepki, düello, silah/mesafe, T tarafı",
    ...EVERYWHERE,
    options: [{ type: STRING, name: "mac", description: "Maç (boş bırakırsan son maçın)", autocomplete: true }],
  },
  {
    name: "profil",
    description: "Oyuncu kartı: son 5 maç KAST/ADR/HS, harita havuzu, seri",
    ...EVERYWHERE,
    options: [{ type: USER, name: "kullanici", description: "Başka bir oyuncunun profili" }],
  },
  {
    name: "gelisim",
    description: "Son maçlarındaki KAST, ADR, HS ve K/D eğilimi",
    ...EVERYWHERE,
    options: [
      { type: USER, name: "kullanici", description: "Başka bir oyuncu" },
      { type: INTEGER, name: "adet", description: "Kaç maç (5–30)", min_value: 5, max_value: 30 },
    ],
  },
  {
    name: "faceit",
    description: "FACEIT kartı: ELO, seviye ve son maçlar",
    ...EVERYWHERE,
    options: [
      { type: USER, name: "kullanici", description: "Bağlı FACEIT hesabı olan bir oyuncu" },
      { type: STRING, name: "takma-ad", description: "Herhangi bir FACEIT kullanıcı adı", max_length: 100 },
    ],
  },
  {
    name: "karsilastir",
    description: "İki oyuncuyu son maçlarına göre karşılaştır",
    ...EVERYWHERE,
    options: [
      { type: USER, name: "kullanici", description: "Karşılaştırılacak oyuncu", required: true },
      { type: USER, name: "diger", description: "İkinci oyuncu (boşsa sen)" },
    ],
  },
  {
    name: "liderlik",
    description: "Sunucu sıralaması",
    ...GUILD_ONLY,
    options: [
      { type: STRING, name: "olcut", description: "Sıralama ölçütü", choices: [
        { name: "KAST (round katkısı)", value: "kast" }, { name: "ADR", value: "adr" }, { name: "HS %", value: "hs" },
        { name: "K/D", value: "kd" }, { name: "Galibiyet oranı", value: "win" }, { name: "Maç sayısı", value: "matches" },
      ] },
      { type: INTEGER, name: "gun", description: "Son kaç gün (varsayılan 30)", choices: [{ name: "7 gün", value: 7 }, { name: "30 gün", value: 30 }, { name: "90 gün", value: 90 }, { name: "Tümü", value: 3650 }] },
    ],
  },
  {
    name: "radyo",
    description: "Bulunduğun ses kanalında Türk radyosu çal",
    ...GUILD_ONLY,
    options: [
      {
        type: SUB, name: "cal", description: "Ses kanalına gelip radyo çalar (boş bırakırsan popülerlerden seç)",
        options: [{ type: STRING, name: "istasyon", description: "Radyo adı: yazmaya başla, listeden seç", autocomplete: true, max_length: 300 }],
      },
      { type: SUB, name: "dur", description: "Radyoyu kapat ve ses kanalından çık" },
    ],
  },
  {
    name: "sunucu",
    description: "Sunucu ayarları: maç raporu kanalı, rol bildirimi, test",
    ...GUILD_ONLY,
    default_member_permissions: MANAGE_GUILD,
    options: [
      {
        type: SUB, name: "kur", description: "Maç raporlarının gönderileceği kanalı ayarla",
        options: [
          { type: CHANNEL, name: "kanal", description: "Metin, duyuru veya forum kanalı", required: true, channel_types: [0, 5, 15] },
          { type: ROLE, name: "rol", description: "Yeni raporda etiketlenecek rol (isteğe bağlı)" },
          { type: BOOLEAN, name: "otomatik", description: "Üyelerin yeni maçları otomatik paylaşılsın mı? (varsayılan: evet)" },
        ],
      },
      { type: SUB, name: "durum", description: "Rapor kanalı ve gönderim kuyruğu durumu" },
      { type: SUB, name: "test", description: "Rapor kanalına test görseli gönder" },
      { type: SUB, name: "kapat", description: "Otomatik maç raporlarını kapat" },
      {
        type: SUB, name: "liderlik", description: "Liderlik tablosunu aç/kapat",
        options: [{ type: BOOLEAN, name: "acik", description: "Açık mı?", required: true }],
      },
    ],
  },
  {
    name: "takim",
    description: "Takım koçu: beşli raporu, T taktikleri, plan ve canlı round tahtası",
    ...EVERYWHERE,
    options: [
      {
        type: SUB, name: "kur", description: "Takımını oluştur (oyuncuların Steam hesabı bağlı olmalı)",
        options: [
          { type: STRING, name: "ad", description: "Takım adı", required: true, max_length: 60 },
          { ...mapOption(true, "Planın haritası") },
          { type: USER, name: "oyuncu1", description: "Oyuncu", required: true },
          { type: USER, name: "oyuncu2", description: "Oyuncu" },
          { type: USER, name: "oyuncu3", description: "Oyuncu" },
          { type: USER, name: "oyuncu4", description: "Oyuncu" },
          { type: USER, name: "oyuncu5", description: "Oyuncu" },
        ],
      },
      { type: SUB, name: "rapor", description: "Rol dağılımı, CT pozisyonları ve takım T disiplini", options: [squadOption] },
      { type: SUB, name: "taktik", description: "Demolardan T taktiği: kim nereye, utility zamanlaması", options: [squadOption] },
      { type: SUB, name: "plan", description: "Maç öncesi plan: CT tutuşları ve aşamalı round planları", options: [squadOption] },
      {
        type: GROUP, name: "canli", description: "Maç sırasında Discord'da güncellenen canlı plan",
        options: [
          { type: SUB, name: "baslat", description: "Bu kanalda canlı round tahtasını başlat (CS2 GSI gerekir)", options: [squadOption] },
          { type: SUB, name: "durdur", description: "Canlı tahtayı durdur", options: [squadOption] },
        ],
      },
      { type: SUB, name: "liste", description: "Takımların" },
      { type: SUB, name: "sil", description: "Bir takımı sil", options: [{ ...squadOption, required: true }] },
    ],
  },
  {
    name: "canli",
    description: "CS2 canlı bağlantısı (GSI): maç bitince otomatik analiz ve canlı takım planı",
    ...EVERYWHERE,
    options: [
      { type: SUB, name: "kur", description: "Kişisel CS2 GSI dosyanı al" },
      { type: SUB, name: "durum", description: "Canlı maç durumun" },
    ],
  },
  {
    name: "sozluk",
    description: "KAST, ADR, takas, tepki süresi gibi terimlerin açıklaması",
    ...EVERYWHERE,
    options: [{ type: STRING, name: "terim", description: "Terim", autocomplete: true }],
  },
  { name: "premium", description: "Plan, limitler ve projeyi destekleme", ...EVERYWHERE },
  {
    name: "admin",
    description: "Bot sahibi araçları",
    ...EVERYWHERE,
    default_member_permissions: "8",
    options: [
      { type: SUB, name: "istatistik", description: "Bot istatistikleri" },
      {
        type: SUB, name: "premium", description: "Kullanıcıya veya sunucuya premium ver",
        options: [
          { type: INTEGER, name: "gun", description: "Gün", required: true, min_value: 1, max_value: 3650 },
          { type: USER, name: "kullanici", description: "Kullanıcı" },
          { type: STRING, name: "sunucu", description: "Sunucu ID", max_length: 22 },
          { type: STRING, name: "not", description: "Not (ör. Patreon/Shopier ödemesi)", max_length: 120 },
        ],
      },
    ],
  },
];

export const CONTEXT_MENUS = [
  { name: "TRACER profili", type: 2, ...EVERYWHERE },
  { name: "TRACER ile karşılaştır", type: 2, ...EVERYWHERE },
];

export function allCommands() {
  return [...COMMANDS, ...CONTEXT_MENUS];
}
