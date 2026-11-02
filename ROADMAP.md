# Yol haritası ve durum

Son güncelleme: 2 Kasım 2026 (main: `7d3012c`)

Vitalscope, sitelerin gerçek kullanıcı performansını (Core Web Vitals) ve JavaScript hatalarını izleyen, açık kaynak ve self-host edilebilir bir platformdur. Üç parçadan oluşur:

- **SDK (`@vitalscope/sdk`):** siteye eklenen, sıfır bağımlılıklı tarayıcı kütüphanesi. Metrikleri, hataları ve sayfa görüntülemelerini toplar.
- **Ingest servisi (Hono):** olayları doğrular, zenginleştirir, ClickHouse'a toplu yazar.
- **Dashboard (Next.js):** GitHub ile giriş, proje ve anahtar yönetimi, metrik ve hata analizi, release karşılaştırma, canlı görünüm.

Veri katmanı: ClickHouse (olaylar), Postgres + Drizzle (kullanıcı, proje, anahtar), Redis (önbellek, rate limit, canlı akış).

Kurallar: her adım ayrı branch ve PR, CI yeşil olmadan merge yok, PR'lar squash ile birleşir. Commit'ler Conventional Commits, scope zorunlu (`sdk`, `protocol`, `ingest`, `dashboard`, `charts`, `infra`, `repo`, `deps`), SSH ile imzalı.

## Tamamlananlar

| PR | Adım | İçerik |
| --- | --- | --- |
| #1 | Monorepo iskeleti | pnpm 11 + Turborepo, TypeScript strict, ESLint, Vitest, lefthook + commitlint + gitleaks, Changesets, SHA'ya sabitlenmiş CI, tedarik zinciri ayarları (`saveExact`, `minimumReleaseAge`, `trustPolicy`) |
| #2 | Protokol | `@vitalscope/protocol`: v1 Zod şemaları (`/schema` alt export'u), eşikler, limitler, geçerli/geçersiz fixture'lar |
| #3 | SDK çekirdeği | `init`, kuyruk, batch (50 olay / 60 KB), sendBeacon + fetch keepalive, flush tetikleyicileri, debug modu, örnekleme, `track`, `flush`, `disable` |
| #4 | Metrikler | TTFB, FCP, LCP, CLS, INP bağımlılıksız; prerender ve bfcache desteği; cihaz, bağlantı, navigasyon bağlamı |
| #5 | Hatalar ve gizlilik | `error` / `unhandledrejection` yakalama, `captureError`, eklenti ve `Script error.` filtresi, `ignoreErrors`, fırtına koruması (aynı hata 5, toplam 50); protokolde `scrubText` / `scrubPath`, `keepQuery`, `respectDoNotTrack`; fast-check property testleri |
| #7 | SPA rota takibi | Navigation API (`currententrychange`), yoksa `pushState` / `replaceState` sarmalama + `popstate`; rota değişince önceki sayfanın olayları kendi path'iyle gönderilir, yeni sayfa için pageview; `setRoute()`, `trackSpa` |
| #9 | React ve Next.js | `@vitalscope/sdk/react` (`VitalscopeProvider`, `route` prop'u), `@vitalscope/sdk/next` (şablonu `usePathname` + `useParams` ile çıkarır); React ve Next isteğe bağlı peer dependency, `"use client"` korunur |
| #11 | Playground + Playwright (senaryolar) | `apps/playground`: slow-lcp, janky-button, layout-shift, throws, spa, pii, bfcache, sıkı CSP + Trusted Types; Chromium, Firefox, WebKit'te build edilmiş sitede; her istek protokol şemasıyla doğrulanır; CI'da `e2e` işi. Bulunan iki hata düzeltildi: URL dışındaki `token=` sızıntısı, tekrar eden hatanın farklı hataları düşürmesi |

Durum: 183 birim testi (protokol 52, SDK 131) + 27 e2e senaryosu (9 senaryo × 3 tarayıcı). Boyut minify + gzip (esbuild + gzip -9): çekirdek 4.723 B, `/react` 4.771 B, `/next` 5.017 B (çekirdek dahil).

## Sıradaki adımlar

### SDK

- [ ] **Performans bütçeleri:** `init` < 1 ms (4× CPU yavaşlatma), sıfır long task, sitenin LCP/INP'sine etki (SDK'lı/SDK'sız 20'şer ölçüm), web-vitals ile karşılaştırma
- [ ] **Attribution build'i ve boyut bütçeleri:** attribution < 5 KB, size-limit CI'da; 3 KB çekirdek bütçesi kararı bu adımda verilecek
- [ ] **Yayın:** IIFE build (`window.vitalscope`, dondurulmuş), SRI hash'leri, trusted publishing + provenance, `0.1.0`
- [ ] **Dogfooding:** enflasyon uygulaması ve ecbakar.com'a kurulum

### Platform

- [ ] **Altyapı:** `infra/docker-compose.dev.yml`, ClickHouse tabloları ve kullanıcıları, Postgres + Drizzle şeması, migration akışı (Docker gerekli)
- [ ] **Ingest MVP:** doğrulama, anahtar çözümleme, Origin kontrolü, tampon + toplu yazma, graceful shutdown, entegrasyon testleri
- [ ] **Ingest sertleştirme:** rate limit, geo (DB-IP Lite) ve UA zenginleştirme, hata fingerprint'i, backpressure, `/metrics`; protokoldeki temizleme kuralları sunucuda ikinci kez
- [ ] **Dashboard iskeleti:** Better Auth + GitHub, proje CRUD, anahtar yönetimi, `scoped-query` + kiracı izolasyonu testleri
- [ ] **Grafik paketi:** `packages/charts`, SVG + yoğun serilerde Canvas
- [ ] **Vitals ekranları:** genel bakış, metrik detayı, kırılımlar, URL filtre state'i
- [ ] **Hatalar ve release'ler:** hata listesi / detayı, materialized view, release karşılaştırma
- [ ] **Canlı görünüm:** Redis pub/sub → SSE
- [ ] **Kalite:** seed + sorgu bütçe testleri, E2E, XSS testi, axe, Lighthouse
- [ ] **Yük testi:** k6 senaryoları, sonuç grafikleri (hedef: 2.000 olay/sn, p99 < 50 ms)
- [ ] **Paketleme ve deploy:** üretim Dockerfile'ları, GHCR, imaj imzalama, compose + Caddy, deploy workflow'u, yedekleme
- [ ] **Demo ve case study:** `/demo` sayfası, ecbakar.com yazısı

## Tarayıcı farkları ve atlanan testler

PR #11'deki e2e senaryolarından çıkanlar. Hedef: hiçbir senaryonun "atlandı" ile geçmemesi; ya gerçekten doğrulanması ya da neden doğrulanamadığının kanıtlanması.

| Konu | Durum | Neden | Çözüm yönü |
| --- | --- | --- | --- |
| bfcache | 3 tarayıcıda atlanıyor | SDK'sız kontrol sayfası bile Playwright'ın tarayıcılarında bfcache'ten geri gelmiyor; nedeni bilinmiyor (Playwright kaynağında bfcache'i kapatan bir bayrak bulunamadı) | Chromium'da `PerformanceNavigationTiming.notRestoredReasons` ile neden okunup SDK'nın engelleyici olmadığı kanıtlanabilir; ek olarak SDK'nın `unload` / `beforeunload` dinlemediğini doğrulayan birim testi |
| Sayfadan çıkarken gönderim | Chromium'da atlanıyor | `pagehide` içinde gönderilen düz bir `sendBeacon` bile `true` dönüyor ama Playwright'ın `route` yakalamasına düşmüyor; SDK değil, test altyapısı sınırı | Yakalamayı `route` yerine gerçek bir yerel sahte ingest sunucusuna taşımak (`http://localhost`); ileride gerçek ingest'le uçtan uca teste de temel olur |
| CLS | Firefox ve WebKit'te ölçülmüyor | Tarayıcılar Layout Instability API'yi desteklemiyor | Test tarafında çözüm yok; test "olay gönderilmez, sayfa kırılmaz" durumunu doğruluyor. Dashboard'da CLS'nin sadece Chromium tabanlı tarayıcılardan geldiği belirtilmeli, README'ye yazılmalı |
| LCP değerlendirmesi | Çözüldü, izlenmeli | Yavaş açılan Firefox'ta 3 sn gecikmeye açılış süresi eklenip 4 sn'yi geçebiliyor | Test sabit `needs-improvement` yerine eşiklerle tutarlılığı kontrol ediyor; daha kararlı hale getirmek için ölçümden önce ısınma (warm-up) navigasyonu düşünülebilir |
| LCP görseli | Çözüldü | Chromium düşük entropili (tek renk) görselleri LCP adayı saymıyor | Senaryo rastgele pikselli görsel çiziyor; gerçek sitelerde de logo / düz renkli görsellerin LCP sayılmayacağı README'ye not edilmeli |

- [ ] Sahte ingest sunucusu ile e2e yakalaması (Chromium'da sayfadan çıkış testi açılır)
- [ ] bfcache: `notRestoredReasons` ile kanıt + `unload` dinlenmediğine dair birim testi
- [ ] README'ye tarayıcı desteği tablosu (CLS, LCP entropi kuralı)
## Ertelenen işler

- [ ] `beforeSend(event)`: dönen olay temizlikten ve protokol sınırlarından tekrar geçmeli; prototype pollution koruması ile birlikte ayrı PR
- [ ] `errorSampleRate`: protokolde tek `sr` alanı var, hatalar için ayrı oran protokol değişikliği gerektirir
- [ ] `init` ikinci kez çağrılınca geliştirme modunda uyarı
- [ ] `sid` için isteğe bağlı `sessionStorage`
- [ ] SPA içi (soft navigation) metrikler: INP ve CLS sayfa gizlenince raporlanır, o anki rotaya atanır
- [ ] Çekirdek boyut bütçesi: dokümanda 3 KB, şu an 4.646 B (attribution / boyut adımında karar)

## Güvenlik ve kalite eksikleri

- [ ] ESLint ile tehlikeli API yasağı (`eval`, `new Function`, `innerHTML`, `document.write` vb.)
- [ ] CodeQL, Dependabot (haftalık, gruplu), OpenSSF Scorecard
- [ ] `SECURITY.md`
- [ ] CI'da `pnpm audit --prod`, boş `dependencies` kontrolü, `pnpm pack --dry-run` snapshot'ı
- [ ] Kapsam eşikleri: SDK ≥ %95, temizleme ve taşıma %100
- [ ] README (kurulum, gizlilik notu, SPA sınırlaması)

## Elle yapılacaklar

- [ ] GitHub güvenlik ayarları: secret scanning, push protection, branch protection
- [ ] npm'de `@vitalscope` organizasyonu
- [ ] İki GitHub OAuth uygulaması (geliştirme ve canlı)
- [ ] Alan adı ve VPS (ClickHouse için en az 8 GB RAM)
- [ ] Docker kurulumu (altyapı adımı için)

## Açık sorular

- Better Auth mı Auth.js mi (dashboard iskeletinden önce)
- Soft navigation (SPA içi LCP): tarayıcı API'si olgunlaşınca v2
