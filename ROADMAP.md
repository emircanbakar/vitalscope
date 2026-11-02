# Yol haritası ve durum

Son güncelleme: 2 Kasım 2026 (main: `0dba173`)

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

Durum: 148 test (protokol 50, SDK 98). SDK boyutu 4,24 KB minify + gzip (brotli 3,84 KB).

## Sıradaki adımlar

### SDK

- [ ] **SPA ve React:** Navigation API ile rota algılama (yoksa `pushState` / `replaceState` sarmalama + `popstate`), `trackSpa`, `setRoute()`, `@vitalscope/sdk/react` (`VitalscopeProvider`, React `peerDependency`)
- [ ] **Playground + Playwright:** `apps/playground` sayfaları (slow-lcp, janky-button, layout-shift, throws, spa, pii, bfcache, CSP / Trusted Types); Chromium, Firefox, WebKit; `init` < 1 ms ve sıfır long task bütçeleri; web-vitals ile karşılaştırma
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

## Ertelenen işler

- [ ] `beforeSend(event)`: dönen olay temizlikten ve protokol sınırlarından tekrar geçmeli; prototype pollution koruması ile birlikte ayrı PR
- [ ] `errorSampleRate`: protokolde tek `sr` alanı var, hatalar için ayrı oran protokol değişikliği gerektirir
- [ ] `init` ikinci kez çağrılınca geliştirme modunda uyarı
- [ ] `sid` için isteğe bağlı `sessionStorage`
- [ ] Çekirdek boyut bütçesi: dokümanda 3 KB, şu an 4,24 KB (attribution / boyut adımında karar)

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
