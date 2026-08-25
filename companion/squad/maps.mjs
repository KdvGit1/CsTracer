import { normalizeMapName } from "./identity.mjs";

function position(id, label, keywords, roleBias = "rifler") {
  return { id, label, keywords, roleBias };
}

function plan(id, label, lane, goal, steps) {
  return { id, label, lane, goal, steps };
}

const CONFIGS = {
  dust2: {
    label: "Dust II",
    ct: [
      position("a_long", "A Long / Pit", ["long", "pit"], "entry"),
      position("a_short", "A Short", ["short", "catwalk"], "rifler"),
      position("mid", "Mid / CT", ["mid", "doors", "ct spawn"], "awp"),
      position("b_anchor", "B Anchor", ["b site", "upper tunnel", "tünel"], "anchor"),
      position("rotator", "B-Mid Rotator", ["b doors", "mid", "lower tunnel"], "support"),
    ],
    t: [
      plan("long_split", "Long kontrolü → A split", "A Long", "Long pit kontrolünü alıp Short ile eşzamanlı A sıkıştırması.", ["Entry takım flashıyla Long kapısını açar.", "Trader en fazla iki adım arkada kalır.", "AWP cross/CT rotasyonunu keser.", "Support cross smoke ve site flashını saklar.", "Lurker Short baskısını zamanlar."]),
      plan("b_split", "Mid kontrolü → B split", "Mid / B", "Mid kapı ve tüneli aynı anda B’ye bağlamak.", ["AWP Mid kapı ilk açısını tutar.", "Support Xbox/Mid dumanını kurar.", "Lurker Upper Tunnels sesini geciktirir.", "Entry kapıdan B temasını açar.", "Trader site takasını tamamlar."]),
      plan("short_exec", "Short geç temas → A", "A Short", "Utility sonrasında kısa mesafe, takaslı A girişi.", ["Support Short çıkış flashını atar.", "AWP Long/CT rotasyonunu kilitler.", "Entry ilk site açısını temizler.", "Trader Entry’nin nişangâh dışında kalan açısını alır.", "Lurker Long rotasyonunu dinler."]),
    ],
  },
  mirage: {
    label: "Mirage",
    ct: [position("a_anchor", "A Anchor", ["a site", "ticket", "default"], "anchor"), position("connector", "Connector / Jungle", ["connector", "jungle"], "rifler"), position("window", "Window / Mid", ["window", "mid"], "awp"), position("short", "Short Rotator", ["short", "catwalk"], "support"), position("b_anchor", "B Anchor", ["b site", "apartments", "bench"], "anchor")],
    t: [
      plan("a_exec", "A utility execute", "A Ramp / Palace", "CT-Jungle dumanlarıyla A girişlerini iki kola bölmek.", ["Support CT/Jungle duman setini yönetir.", "Entry Ramp ilk teması açar.", "Trader Ramp takasını alır.", "AWP Palace/Connector rotasyonunu keser.", "Lurker Mid veya Palace geç zamanlamasını oynar."]),
      plan("mid_b", "Mid kontrolü → B split", "Mid / Short", "Window ve Connector baskısından Short-Apartments B sıkıştırması.", ["AWP Window açısını kilitler.", "Support Window smoke ve Connector molly kullanır.", "Entry Short temasını açar.", "Trader Apartments grubuyla eşzamanlanır.", "Lurker A rotasyonunu tutar."]),
      plan("contact_b", "Sessiz Apartments B", "B Apartments", "İlk temas utility ile patlayıp siteyi takas mesafesinde almak.", ["Lurker Mid’de erken rotasyonu tutar.", "Support çıkış flashını zamanlar.", "Entry pencere/van açısını açar.", "Trader bench-site takasını alır.", "AWP Market rotasyonunu keser."]),
    ],
  },
  inferno: {
    label: "Inferno",
    ct: [position("a_pit", "A Pit / Site", ["pit", "a site", "balcony"], "anchor"), position("a_short", "A Short / Arch", ["short", "arch", "library"], "rifler"), position("mid", "Mid AWP", ["mid", "top mid"], "awp"), position("banana", "Banana Rotator", ["banana", "car"], "support"), position("b_anchor", "B Anchor", ["b site", "coffins", "construction"], "anchor")],
    t: [
      plan("banana_exec", "Banana kontrolü → B", "Banana / B", "Banana utility üstünlüğünden coffins-CT izolasyonlu B execute.", ["Support ilk molly/smoke setini koordine eder.", "Entry car sonrası ilk site açısını alır.", "Trader yakın takası korur.", "AWP CT/coffins geçişini kilitler.", "Lurker Mid rotasyonunu tutar."]),
      plan("bracket_a", "Bracket kontrolü → A split", "Mid / A", "Short ve Long’dan A savunmasını iki yöne döndürmek.", ["AWP Top Mid ilk teması tutar.", "Support Arch/Library utility’sini hazırlar.", "Entry Short’tan Pit temasını açar.", "Trader Site takasını alır.", "Lurker Apartments zamanlamasını oynar."]),
      plan("apps_pop", "Apartments pop", "Apartments / A", "Short baskısıyla eşzamanlı balkon çıkışı.", ["Support Pit flashını zamanlar.", "Entry Balcony’den ilk açıyı kırar.", "Trader Short’tan siteye bağlanır.", "AWP Arch rotasyonunu keser.", "Lurker Banana bilgisini tutar."]),
    ],
  },
  nuke: {
    label: "Nuke",
    ct: [position("outside", "Outside / Yard", ["outside", "yard", "garage"], "awp"), position("a_anchor", "A Hut / Site", ["a site", "hut", "rafters"], "anchor"), position("heaven", "Heaven Rotator", ["heaven", "rafters"], "rifler"), position("ramp", "Ramp", ["ramp", "radio"], "support"), position("b_anchor", "B / Secret", ["b site", "secret", "decon"], "anchor")],
    t: [plan("outside_secret", "Outside smoke → Secret", "Outside / Secret", "Yard görüşünü kesip alt kata sayı üstünlüğü taşımak.", ["Support outside smoke duvarını kurar.", "AWP Garage/Heaven boşluğunu tutar.", "Entry Secret ilk teması açar.", "Trader alt kat takasını korur.", "Lurker Lobby rotasyonunu keser."]), plan("a_pop", "Hut-Squeaky A pop", "Lobby / A", "İki kapıdan aynı anda A temasını patlatmak.", ["Support main/heaven flashını atar.", "Entry Squeaky’den açar.", "Trader Hut’tan bağlanır.", "AWP Main rotasyonunu kilitler.", "Lurker Ramp push’u tutar."]), plan("ramp_b", "Ramp kontrolü → B", "Ramp / B", "Ramp oyuncusunu düşürüp alt siteye kontrollü inmek.", ["Entry ramp close açısını temizler.", "Trader takas mesafesini korur.", "Support molly ve flashla rampayı boşaltır.", "AWP Heaven rotasyonunu keser.", "Lurker Hut sesini korur."])],
  },
  ancient: {
    label: "Ancient",
    ct: [position("a_anchor", "A Anchor", ["a site", "donut"], "anchor"), position("donut", "Donut Rotator", ["donut", "mid"], "rifler"), position("mid", "Mid", ["mid", "elbow"], "awp"), position("cave", "Cave", ["cave", "lane"], "support"), position("b_anchor", "B Anchor", ["b site", "back site"], "anchor")],
    t: [plan("mid_a", "Mid-Donut A split", "Mid / Donut", "Donut ve Main’den A’yı çaprazlamak.", ["AWP Mid ilk açıyı tutar.", "Support Donut utility’sini kurar.", "Entry Donut temasını açar.", "Trader A Main ile eşzamanlanır.", "Lurker B rotasyonunu keser."]), plan("cave_b", "Cave kontrolü → B", "Cave / B", "Cave-Lane kontrolünden utility’li B girişi.", ["Support Cave molly/flash kullanır.", "Entry Lane temasını açar.", "Trader site takasını alır.", "AWP CT rotasyonunu tutar.", "Lurker Mid’i sabitler."]), plan("a_main", "A Main geç execute", "A Main", "Donut tehdidi gösterip A Main’den geç utility patlaması.", ["Lurker Mid-Donut baskısını sürdürür.", "Support Temple/CT dumanını kurar.", "Entry default açısını kırar.", "Trader siteyi temizler.", "AWP rotasyonu keser."])],
  },
  anubis: {
    label: "Anubis",
    ct: [position("a_anchor", "A Anchor", ["a site", "heaven"], "anchor"), position("connector", "Connector", ["connector", "canal"], "rifler"), position("mid", "Mid", ["mid", "bridge"], "awp"), position("b_rotator", "B Connector Rotator", ["connector", "b site"], "support"), position("b_anchor", "B Anchor", ["b site", "pillar"], "anchor")],
    t: [plan("canal_a", "Canal-Mid A split", "Canal / A", "Canal ve Main’den A savunmasını çaprazlamak.", ["Support Heaven/Connector utility’sini kurar.", "Entry Canal temasını açar.", "Trader Main’den eşzamanlanır.", "AWP rotasyon hattını tutar.", "Lurker B bilgisini sabitler."]), plan("mid_b", "Mid kontrolü → B", "Mid / B", "Connector baskısıyla B Main girişini kolaylaştırmak.", ["AWP Mid ilk teması tutar.", "Support Connector dumanını kurar.", "Entry B Main’den açar.", "Trader pillar takasını alır.", "Lurker A rotasyonunu keser."]), plan("contact_b", "B contact", "B Main", "Bilgi vermeden yaklaş, ilk temas sonrası utility patlat.", ["Lurker Mid rotasyonunu dinler.", "Support ilk temas flashını atar.", "Entry yakın açıyı kırar.", "Trader pillar/site takasını alır.", "AWP CT hattını tutar."])],
  },
  vertigo: {
    label: "Vertigo",
    ct: [position("a_ramp", "A Ramp", ["a ramp", "ramp"], "awp"), position("a_anchor", "A Anchor", ["a site", "sandbags"], "anchor"), position("mid", "Mid", ["mid", "elevator"], "rifler"), position("b_rotator", "B Stairs Rotator", ["stairs", "mid"], "support"), position("b_anchor", "B Anchor", ["b site"], "anchor")],
    t: [plan("ramp_a", "Ramp kontrolü → A", "A Ramp", "Ramp utility üstünlüğünü site execute’a çevirmek.", ["Support sandbags/site utility’sini kurar.", "Entry ramp temasını açar.", "Trader close takası korur.", "AWP heaven/side açısını tutar.", "Lurker Mid rotasyonunu keser."]), plan("mid_b", "Mid-B split", "Mid / B", "Mid rotasyonunu sıkıştırıp B girişini iki kola bölmek.", ["AWP Mid ilk teması tutar.", "Support CT dumanını kurar.", "Entry Mid’den B bağlantısını açar.", "Trader B stairs ile eşzamanlanır.", "Lurker A ramp rotasyonunu tutar."]), plan("b_exec", "B merdiven execute", "B Stairs", "Utility sonrasında hızlı, takaslı B girişi.", ["Support site flash/smoke kullanır.", "Entry ilk site açısını açar.", "Trader yakın takası alır.", "AWP CT rotasyonunu keser.", "Lurker Mid’i sabitler."])],
  },
  overpass: {
    label: "Overpass",
    ct: [position("a_long", "A Long", ["long", "park"], "awp"), position("a_anchor", "A Site / Bank", ["a site", "bank"], "anchor"), position("connector", "Connector Rotator", ["connector", "stairs"], "rifler"), position("short_b", "B Short / Water", ["short", "water"], "support"), position("b_anchor", "B Anchor", ["b site", "monster"], "anchor")],
    t: [plan("bathrooms_a", "Bathrooms-Long A split", "Bathrooms / A Long", "Bank savunmasını iki yönden sıkıştırmak.", ["AWP Long ilk açıyı tutar.", "Support Bank/Truck utility’sini kurar.", "Entry Bathrooms’tan açar.", "Trader Long ile eşzamanlanır.", "Lurker Connector rotasyonunu keser."]), plan("water_b", "Water kontrolü → B", "Water / B Short", "Short ve Monster’dan B’yi iki kola bölmek.", ["Support Heaven/Bridge dumanını kurar.", "Entry Short’tan açar.", "Trader Monster grubuyla eşzamanlanır.", "AWP Heaven rotasyonunu tutar.", "Lurker A rotasyonunu keser."]), plan("monster_contact", "Monster contact", "Monster / B", "Sessiz yaklaşım sonrası takım flashıyla patlamak.", ["Lurker Connector bilgisini tutar.", "Support Monster flashını zamanlar.", "Entry pillar açısını kırar.", "Trader site takasını alır.", "AWP Short rotasyonunu keser."])],
  },
  train: {
    label: "Train",
    ct: [position("ivy", "Ivy", ["ivy"], "awp"), position("a_anchor", "A Yard Anchor", ["a site", "yard"], "anchor"), position("connector", "Connector", ["connector"], "rifler"), position("upper_b", "B Upper", ["upper", "b halls"], "support"), position("b_anchor", "B Anchor", ["b site", "lower"], "anchor")],
    t: [plan("a_split", "Ivy-Main A split", "Ivy / A Main", "Yard savunmasını iki uçtan sıkıştırmak.", ["AWP Ivy ilk teması tutar.", "Support Connector dumanını kurar.", "Entry Main’den açar.", "Trader Ivy ile eşzamanlanır.", "Lurker B rotasyonunu tutar."]), plan("b_split", "Upper-Lower B split", "B Halls", "İki yükseklikten eşzamanlı B teması.", ["Support Connector/CT utility’sini kurar.", "Entry Lower’dan açar.", "Trader Upper’dan bağlanır.", "AWP rotasyon hattını tutar.", "Lurker A bilgisini sabitler."]), plan("popdog_a", "Popdog → A baskı", "Popdog / A", "Yakın teması alıp Main grubunu siteye sokmak.", ["Entry Popdog temasını kırar.", "Trader hemen arkasında kalır.", "Support site flashını atar.", "AWP Ivy rotasyonunu tutar.", "Lurker B push’u keser."])],
  },
};

const GENERIC_LABELS = { office: "Office", italy: "Italy", cache: "Cache", cobblestone: "Cobblestone", thera: "Thera", mills: "Mills", assembly: "Assembly", memento: "Memento", poolday: "Pool Day", baggage: "Baggage", shoots: "Shoots" };

function genericConfig(map) {
  const label = GENERIC_LABELS[map] || map.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  return {
    label,
    generic: true,
    ct: [position("a_anchor", "A / Birinci hedef Anchor", ["a site", "a"], "anchor"), position("a_rotator", "A Rotator", ["a", "mid"], "rifler"), position("mid", "Orta Alan", ["mid", "middle"], "awp"), position("b_rotator", "B Rotator", ["b", "mid"], "support"), position("b_anchor", "B / İkinci hedef Anchor", ["b site", "b"], "anchor")],
    t: [plan("primary", "En güçlü rota execute", "Birincil rota", "Geçmişteki en güçlü takım rotasını takas mesafesinde oynamak.", ["Support giriş utility’sini hazırlar.", "Entry ilk açıyı kırar.", "Trader takas mesafesini korur.", "AWP uzun görüş hattını kilitler.", "Lurker rotasyonu keser."]), plan("alternate", "Alternatif rota split", "Alternatif rota", "Birincil rota okunursa iki koldan hedefe bağlanmak.", ["Lurker zıt tarafta bilgi toplar.", "Support görüşü böler.", "Entry ilk teması açar.", "Trader ikinci girişi temizler.", "AWP rotasyonu keser."]), plan("contact", "Sessiz temas", "Contact", "İlk temasa kadar bilgi vermeden yaklaşmak.", ["Takım takas mesafesini korur.", "Support ilk temasta utility kullanır.", "Entry yakın açıyı kırar.", "AWP geri rotasyonu tutar.", "Lurker erken push’u cezalandırır."])],
  };
}

export const SUPPORTED_SQUAD_MAPS = [...Object.keys(CONFIGS), ...Object.keys(GENERIC_LABELS)];

export function squadMapConfig(mapName) {
  const map = normalizeMapName(mapName);
  return CONFIGS[map] || genericConfig(map);
}
