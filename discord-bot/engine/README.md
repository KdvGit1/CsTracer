# Analiz motoru (TRACER v0.53.0)

Bu klasördeki modüller, **GitHub Releases'teki en son sürüm olan v0.53.0** paketinden
(`TracerCS2-0.53.0-full.nupkg` → `lib/app/resources/app/`) alındı. Depodaki
`companion/` klasörü v0.51.5'te kaldığı için (v0.52.0 ve v0.53.0 etiketleri aynı
commit'i gösteriyor) bot, sürümdeki güncel kodu kullanır:

| Dosya | v0.51.5'e göre |
| --- | --- |
| `companion/analyze.mjs` | Utility atış konumları, round olayları (bomba kurulumu), elde kalan utility |
| `companion/faceit.mjs`, `faceit_demo.mjs` | **Yeni** — FACEIT maç geçmişi ve demo indirme |
| `companion/tside.mjs` | **Yeni** — T tarafı 10 kural disiplin raporu |
| `companion/radar_calibration.mjs` | **Yeni** — radar kalibrasyonu |
| `companion/squad/strats.mjs`, `tactics.mjs`, `strat_render.mjs`, `discord_live.mjs` | **Yeni** — T taktikleri, aşamalı planlar, Discord canlı plan mesajları |
| `companion/squad/planner.mjs`, `live.mjs`, `maps.mjs` | Güncellendi |
| `companion/discord_reporter.mjs` | Güncellendi (yalnız görsel modeli kullanılır) |
| `shared/*` | v0.51.5 ile aynı (+ `radar-manifest.json`) |

## Bottaki tek değişiklik

`companion/map_geometry.mjs`: çarpışma ağları (48 MB) ikinci kez depoya eklenmesin diye
dosyalar önce `engine/companion/geometry/`, yoksa depodaki `companion/geometry/`
klasöründen okunur (`TRACER_GEOMETRY_DIR` ile değiştirilebilir). Analiz mantığına
dokunulmadı.

Windows'a özgü PowerShell çizicileri (`render_*.ps1`) bota alınmadı; aynı görseller
`src/render/cards/` altında SVG → PNG (resvg) ile Linux/ARM'da çizilir.

## Güncelleme

Masaüstü uygulamasının yeni bir sürümü çıktığında aynı dosyaları sürüm paketinden
(veya güncel `companion/` kaynağından) buraya kopyala, sonra `npm test` çalıştır.
