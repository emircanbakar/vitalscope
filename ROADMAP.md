# Yol haritası ve durum

Son güncelleme: 5 Kasım 2026 (main: `14eb5e9`)

Vitalscope, geliştiricinin kendi bilgisayarında çalışan, `devDependencies`'e kurulan açık kaynak bir performans aracıdır. Core Web Vitals ölçümlerini ve JavaScript hatalarını toplar, sonuçları yerel bir panelde ve terminalde gösterir. Sunucu, hesap ve Docker gerektirmez. Üç parçadan oluşur:

- **SDK (`@vitalscope/sdk`):** uygulamaya eklenen, sıfır bağımlılıklı tarayıcı kütüphanesi. Metrikleri, hataları ve sayfa görüntülemelerini toplar.
- **CLI (`@vitalscope/cli`, Node 24.15+):** `vitalscope dev` yerel toplayıcıyı (Hono) başlatır; olayları doğrulayıp projedeki yerel bir dosyaya yazar, sadece `127.0.0.1` üzerinde çalışır. `vitalscope report` sonuçları terminalde gösterir.
- **Panel:** toplanan veriyi gösteren yerel sayfa, CLI paketinden sunulur (henüz yok).

Veri katmanı: proje klasöründe tek SQLite dosyası (`.vitalscope/`).

**Yön kararı (5 Kasım 2026):** Sunuculu gerçek kullanıcı izleme platformu yerine yerel geliştirici aracına geçildi. Kazanç: masraf yok, tek komutla kurulum, çok daha küçük kapsam. Bedel: sadece geliştiricinin kendi tarayıcısından gelen veri görünür; gerçek kullanıcıların cihazları, ülkeleri ve karşılaştıkları hatalar görünmez. SDK'nın `endpoint` ayarı kalır, bu yüzden sunucu seçeneği ileride yeniden eklenebilir. Aşağıdaki "Tamamlananlar" tablosu geçmiş kaydıdır; #28 ve #29'daki ClickHouse ve Postgres kısmı #31'de kaldırıldı.

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
| #13 | E2E: yerel sahte ingest | Olaylar `route` yerine bellekte çalışan yerel bir ingest sunucusuna gider; Chromium yeni headless modda ve bfcache'i kapatan Playwright bayrağı olmadan çalışır; kalan atlamalar her çalışmada kontrol deneyiyle (SDK'sız sayfa, düz `sendBeacon`) kararlaştırılır |
| #15 | Performans bütçeleri | Sadece Chromium'da, diğer testlerden sonra tek başına (`test:perf`): orta seviye mobil CPU'da `init` < 1 ms (sıcak açılışların medyanı ≈ 0,6–0,8 ms; yavaşlatma oranı Lighthouse gibi makinenin hızına göre kalibre edilir, referans makinede ≈ 4×), SDK betiklerinin hiçbiri 50 ms sürmez (long animation frame betik atfı), SDK'lı / SDK'sız 20'şer ölçümde LCP ve INP medyan farkı bir kareden az. Bütçe için `init` hafifletildi: metrik gözlemcileri ayrı bir task'te kurulur (`buffered`), ilk path temizliği ilk gönderime ertelenir. web-vitals 6.2.3 ile karşılaştırma (3 tarayıcı): TTFB, FCP, LCP birebir, CLS ±0,001, INP ±8 ms |
| #16 | Attribution build'i ve boyut bütçeleri | `@vitalscope/sdk/attribution`: çekirdekle aynı API, metrik olaylarına `attr` eklenir. LCP: eleman seçicisi, görsel adresi (sadece http(s), query/hash atılır, path temizlenir), TTFB / yükleme gecikmesi / yükleme süresi / render gecikmesi. INP: hedef seçici, `pointer` / `keyboard`, etkileşimin en uzun olayıyla aynı karede biten olaylarından girdi gecikmesi / işleme / sunum, destekleyen tarayıcıda en uzun betik (long animation frame). CLS: en büyük penceredeki en büyük kaymanın elemanı ve zamanı. Seçiciler sadece etiket, id, sınıf; en fazla 100 karakter. Attribution hatası metriği düşürmez. `size-limit` CI'da (gzip, bağımlılıklar dahil) |
| #17 | Yayın hazırlığı | `dist/vitalscope.iife.js`: tek global, dondurulmuş `window.vitalscope`; etiketin `data-key` / `data-endpoint` / `data-release` / `data-environment` özellikleriyle kendiliğinden başlar. Playground'da SRI ile yüklenir, değiştirilmiş dosyayı tarayıcı engeller (3 tarayıcı). `release.yml`: Changesets sürüm PR'ı; yayınlanmamış sürüm varsa `npm` ortamında (sadece main) trusted publishing (OIDC, token yok; repo private olduğu için provenance kapalı) ve GitHub release'i (dist SHA-384 özetleri + script etiketi SRI'ı). Paketler yayınlanabilir: `private` kalktı, README, LICENSE, `repository`; `npm pack` dosya listesi testte. İlk changeset: iki paket `0.1.0` |
| #18–#20 | İlk yayın: `0.1.0` | `@vitalscope/sdk` ve `@vitalscope/protocol` 4 Kasım'da GitHub Actions'tan trusted publishing ile npm'e çıktı. jsDelivr'daki IIFE dosyasının SRI değeri release notuyla aynı. Repo private olduğu için provenance yok (#19). Trusted publisher tanımında **Allowed actions → `npm publish`** işaretli olmalı; yoksa npm `OIDC permission denied` döner. CHANGELOG artık pakette (#20) |
| #27 | Ingest çekirdeği | `apps/ingest` (Hono), Docker gerektirmeyen kısım: `POST /v1/e` (64 KB sınırı, şema, protokol sürümü, anahtar, Origin, CORS, boş gövdeli yanıtlar), `/healthz`, `/readyz`, 60 sn'lik anahtar önbelleği ("yok" sonucu dahil), toplu yazma tamponu (1 sn / 5.000 olay, 50.000 sınır, üstel geri çekilme), kapanışta tamponu boşaltma. Depo ve anahtar kaynağı arabirim arkasında; henüz çalıştırılabilir süreç yok |
| #28 | Altyapı | `infra/docker-compose.dev.yml` (Postgres 16, ClickHouse 26.8; sadece localhost), `packages/db`: Drizzle şeması (`project`, `public_key`), ClickHouse tabloları (`vitals`, `errors`, `pageviews`, `custom_events`), tekrar çalıştırılabilir `migrate`, sadece INSERT ve salt okunur roller (okuma 10 sn / 100.000 satır sınırlı). CI'da `integration` işi. Better Auth, `secret_key`, `audit_log` dashboard adımında, Redis rate limit adımında gelir |
| #29 | Ingest MVP | Çalışan servis: ClickHouse `EventSink` (tablo başına tek insert, sadece INSERT yetkili kullanıcı), Postgres anahtar çözümleme, `env.ts`, `main.ts` (`SIGTERM`, `SIGINT`), gerçek sorguyla `/readyz`. Yazılamayan parti yeni olaylarla birleşmeden aynen yeniden denenir, ClickHouse tekrarını tekilleştirir. Uç `ts` değerleri (7 günden eski, 1 saatten ileri) sunucu zamanına düşer, bozuk kaçış dizisi partiyi düşürmez, bitmeyen istek kapanışı 2 sn'den fazla bekletmez |
| #30 | Yön kararı | Yol haritası yerel geliştirici aracına göre yeniden yazıldı |
| #31 | Yerel toplayıcı | `apps/ingest` Docker'sız çalışır: olaylar `.vitalscope/vitalscope.db` dosyasına (`node:sqlite`, WAL) tek transaction'da yazılır, klasördeki `.gitignore` ölçümleri git dışında tutar. Sadece `127.0.0.1`'e bağlanır; yerel olmayan `Origin` ve `Host` reddedilir (DNS rebinding dahil). Anahtarın sadece biçimi doğrulanır, proje kavramı ve `/readyz` kalktı. ClickHouse, Postgres, `packages/db`, `infra/` ve CI'daki `integration` işi kaldırıldı. Gerçek SDK ile Chromium, Firefox, WebKit'te elle denendi |
| #32 | CLI | `apps/ingest` → `packages/cli` (`@vitalscope/cli`, henüz yayınlanmıyor). `vitalscope dev`: toplayıcı, dolu port için açıklamalı hata, Ctrl+C'de tamponu boşaltıp kapanma (Windows'ta terminalde denendi). `vitalscope report`: sayfa bazlı p75 (route şablonuyla gruplanır, tekrar gönderilen metriğin son değeri sayılır), renkten bağımsız `~` / `!` işaretleri, gruplanmış hatalar; tarayıcıdan gelen metinlerde kontrol karakterleri temizlenir. Node 24.15 altında anlaşılır hata |
| #33 | SDK yerel kurulum | `init()` ayarsız çalışır: `key` ve `endpoint` isteğe bağlı, varsayılan adres `http://localhost:8787/v1/e`. Yerel olmayan sayfada (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost` dışı) SDK hiçbir şey yapmaz; e2e testi 3 tarayıcıda doğrular. Script etiketi ayarsız başlar, `data-manual` ile `init()` bekler. README kurulum belgesi: geliştirme kontrolü arkasında dinamik import. Vite ve Next.js'te gerçek uygulamayla denendi: paket kurulu değilken build geçer, çıktıda SDK olmaz, dev modunda veri rapora ulaşır |

| #34 | Ölçüm doğruluğu | `environment` verilmezse bundler'ın `NODE_ENV` değerinden anlaşılır, bundler yoksa `development` (önceden hep `production`). `vitalscope report` her ortamı ayrı tabloda gösterir, geliştirme sayılarını production ile karıştırmaz ve uyarı yazar. README production build ölçümünü anlatır: Vite'ta `--mode vitalscope`, Next.js'te ölçüm süresince kontrolü kaldırma. Vite ve Next.js'te gerçek uygulamayla denendi |

| #36 | Hata gruplama | `vitalscope report` aynı hatayı tek satırda sayar. Anahtar: tür, sayı ve kimliklerden temizlenmiş mesaj, uygulama kodundaki ilk karenin fonksiyonu ve dosyası. Satır, sütun, sunucu adresi, `?t=` ve build özeti anahtara girmez. Okurken hesaplanır, şema değişmez. Vite'ta 3 tarayıcıda ve kod düzenlenerek denendi |

| #37 | Grafik paketi | `packages/charts` (`@vitalscope/charts`, yayınlanmıyor, panele gömülür; `react` dışında bağımlılık yok, 7,9 kB gzip + CSS): `TimeSeriesChart` (1.000 noktadan sonra çizgiler Canvas'ta, eksen ve etkileşim SVG'de), `Histogram` (eşik ve yüzdelik çizgileri), `RatingBar` (renk + desen + etiket). Her grafikte tek cümlelik özet, klavye gezinmesi, açılır tablo; açık ve koyu tema. Tarayıcıda ekran görüntüleriyle kontrol edildi |

Durum: 444 birim testi (protokol 53, SDK 173, CLI 163, grafik 55; `SIGTERM` testi Windows'ta atlanır) + 45 e2e testi (15 senaryo × 3 tarayıcı; 38 geçer, 3 kontrol deneyiyle atlanır; Firefox kapanış testi de olay eksik ve kesinti kanıtlıysa ara sıra atlanır) + 3 performans testi (Chromium). Boyut (`size-limit`, minify + gzip, bağımlılıklar dahil) ve bütçe: çekirdek 4,83 / 5 kB, attribution 5,67 / 5,8 kB, `/react` 4,74 / 4,9 kB, `/next` 4,98 / 5,15 kB, IIFE 4,91 / 5,1 kB.

**Boyut bütçesi kararı (#16):** dokümandaki çekirdek < 3 KB ve attribution < 5 KB tutmuyor. Çekirdeği 3 KB'a indirmek için yaklaşık üçte birini (hata yakalama, SPA takibi gibi) ayrı giriş noktalarına taşımak gerekirdi. Bunun yerine bütçeler ölçülen boyutun ≈ %5 üstüne kondu; CI büyümeyi engeller. Not: playground'da attribution sayfası ayrı build edilir; aynı build'de SDK ortak bir parçaya taşınıyor ve `init` sıcak açılışta ≈ 0,2 ms (4× yavaşlatmada) yavaşlıyordu. SDK'yı ayrı bir chunk'a koyan sitelerde de benzer bir fark beklenebilir.

## Sıradaki adımlar

Sırayla:

- [ ] **Panel:** CLI paketinden sunulan statik sayfa (Vite + React), Next.js ve giriş yok. Genel bakış, metrik detayı, sayfa ve cihaz kırılımları, URL filtre state'i. Ortamlar raporda olduğu gibi ayrı gösterilir, geliştirme sayıları için uyarı olur
- [ ] **Hatalar ve release'ler:** hata listesi ve detayı, iki release'in karşılaştırılması
- [ ] **Canlı görünüm:** toplayıcıdan panele SSE; sayfayı yenileyince ölçüm hemen görünür
- [ ] **Kalite:** seed + sorgu süresi testleri, E2E, XSS testi (hata mesajları panelde gösterilir), axe, büyük dosyada davranış
- [ ] **Yayın:** CLI paketi için npm hazırlığı, kök README, tanıtım görselleri. Changesets'in sürüm PR'ı CLI ile birlikte merge edilmeli: SDK'nın yeni README'si henüz npm'de olmayan toplayıcıyı anlatıyor
- [ ] **Dogfooding ve case study:** enflasyon uygulaması ve ecbakar.com'da yerel kullanım, ecbakar.com yazısı

### Karar bekleyen fikirler

Yerel ölçümü DevTools ve Lighthouse da yapıyor. Aracı bunlardan ayırabilecek fikirler, kapsama henüz alınmadı:

- [ ] Sayfa bazlı ölçüm geçmişi ve commit'ler arası karşılaştırma
- [ ] `vitalscope check`: limit aşılırsa CI'da build'i durdurma (CI'da sayfayı açacak bir tarayıcı gerektirir)

### Kapsamdan çıkanlar

Yön kararıyla çıktı, sunucu seçeneği yeniden eklenirse geri gelir: ClickHouse, Postgres, Redis, Docker, Better Auth ve GitHub ile giriş, proje ve anahtar yönetimi, kiracı izolasyonu, rate limit, geo ve UA zenginleştirme, `/metrics`, sunucuda ikinci gizlilik temizliği, k6 yük testi, üretim imajları, GHCR, Caddy, deploy workflow'u, yedekleme, herkese açık `/demo` sayfası.

## Tarayıcı farkları ve atlanan testler

PR #11'deki e2e senaryolarından çıkanlar ve PR #13'teki çözümleri. Hedef: hiçbir senaryonun "atlandı" ile geçmemesi; ya gerçekten doğrulanması ya da neden doğrulanamadığının kanıtlanması.

| Konu | Durum | Neden | Çözüm yönü |
| --- | --- | --- | --- |
| bfcache | Chromium'da doğrulanıyor; Firefox ve WebKit'te atlanıyor | Chromium: Playwright'ın `--disable-back-forward-cache` bayrağı ve headless shell kapatıyordu (CDP `Page.backForwardCacheNotUsed` ile bulundu). Firefox: Playwright derlemesi bfcache'i ayar ve docShell ile kapatıyor, ayar açılınca `goBack` takılıyor. WebKit: SDK'sız kontrol sayfası da geri gelmiyor | Çözüldü (#13): Chromium yeni headless + bayraksız; geri gelen sayfa `load` tetiklemediği için `goBack` sadece `commit` bekler. Firefox / WebKit için test tarafında yapılacak bir şey yok; SDK'nın `unload` dinlemediğini birim testi doğruluyor |
| Sayfadan çıkarken / kapanırken gönderim | Sayfadan çıkış 3 tarayıcıda doğrulanıyor; `page.close()` WebKit'te atlanıyor | Playwright'ın `route` yakalaması Chromium'da pagehide beacon'larını görmüyordu. WebKit `page.close()` sırasında düz bir `sendBeacon`'ı da göndermiyor | Çözüldü (#13): yerel sahte ingest sunucusu; WebKit kapanış testi aynı sayfadaki düz `sendBeacon` kontrolü gelmezse atlanır |
| CLS | Firefox ve WebKit'te ölçülmüyor | Tarayıcılar Layout Instability API'yi desteklemiyor | Test tarafında çözüm yok; test "olay gönderilmez, sayfa kırılmaz" durumunu doğruluyor. Dashboard'da CLS'nin sadece Chromium tabanlı tarayıcılardan geldiği belirtilmeli, README'ye yazılmalı |
| LCP değerlendirmesi | Çözüldü, izlenmeli | Yavaş açılan Firefox'ta 3 sn gecikmeye açılış süresi eklenip 4 sn'yi geçebiliyor | Test sabit `needs-improvement` yerine eşiklerle tutarlılığı kontrol ediyor; daha kararlı hale getirmek için ölçümden önce ısınma (warm-up) navigasyonu düşünülebilir |
| `page.close()` Firefox'ta | Çoğunlukla doğrulanıyor; olay eksik ve kesinti kanıtlıysa atlanıyor (yerelde 40'ta ≈ 5) | Playwright'ın Firefox'u kapanışta o an çalışan pagehide betiğini yarıda kesiyor (`finally` bile çalışmıyor); kesinti SDK'nın dinleyicisine denk gelirse batch hiç gönderilmiyor. Firefox kapanışta önce pagehide, sonra visibilitychange tetikliyor. SDK hatası değil: önüne yoğun bir dinleyici konunca 60/60 geliyor | Çözüldü (#15): test her pagehide dinleyicisini sarar, en sondaki kontrol beacon'ı yarıda kalan olup olmadığını bildirir |
| Firefox'ta `sendBeacon` "başarısız" görünür | Hata değil | Beacon kimlik bilgisiyle gider, toplayıcı bilerek `Allow-Credentials` vermez. Firefox isteği iletir (202), sadece yanıtın okunmasını engeller; Playwright bunu `NS_ERROR_DOM_NETWORK_ERR` olarak raporlar. Her şeyi kabul eden kontrol sunucusunda bu kayıt çıkmadı, farkın nedeni bulunmadı | Olaylar toplayıcıya ulaşıyor, SDK yanıtı okumuyor; yapılacak bir şey yok |
| LCP görseli | Çözüldü | Chromium düşük entropili (tek renk) görselleri LCP adayı saymıyor | Senaryo rastgele pikselli görsel çiziyor; gerçek sitelerde de logo / düz renkli görsellerin LCP sayılmayacağı README'ye not edilmeli |

- [x] Sahte ingest sunucusu ile e2e yakalaması (#13)
- [x] bfcache: Chromium'da gerçek doğrulama; `unload` dinlenmediğine dair birim testi zaten vardı (#13)
- [ ] README'ye tarayıcı desteği tablosu (CLS, LCP entropi kuralı)
- [x] Firefox'ta `page.close()` sırasında kaybolan batch: Playwright kesintisi, kanıtlı atlama (#15)

## Ertelenen işler

- [ ] `beforeSend(event)`: dönen olay temizlikten ve protokol sınırlarından tekrar geçmeli; prototype pollution koruması ile birlikte ayrı PR
- [ ] `errorSampleRate`: protokolde tek `sr` alanı var, hatalar için ayrı oran protokol değişikliği gerektirir
- [ ] `init` ikinci kez çağrılınca geliştirme modunda uyarı
- [ ] `sid` için isteğe bağlı `sessionStorage`
- [ ] SPA içi (soft navigation) metrikler: INP ve CLS sayfa gizlenince raporlanır, o anki rotaya atanır
- [ ] React / Next provider'ları için attribution seçeneği (şu an sadece çekirdek `init`'i çağırıyorlar)

## Güvenlik ve kalite eksikleri

- [x] ESLint ile tehlikeli API yasağı: `eval`, `new Function`, dizgi ile `setTimeout` / `setInterval`, `innerHTML`, `outerHTML`, `srcdoc`, `insertAdjacentHTML`, `createContextualFragment`, `parseFromString`, `document.write`
- [x] Dependabot: haftalık, gruplu, 3 gün bekleme, otomatik merge yok
- [ ] CodeQL ve OpenSSF Scorecard: repo public olunca (private repoda code scanning kapalı, Scorecard public repolar için)
- [x] `SECURITY.md`: bildirim adresi ecbakar.dev@gmail.com, ilk yanıt 72 saat; npm paketlerinde de var. Repo public olunca GitHub private vulnerability reporting eklenebilir
- [x] CI'da `pnpm audit --prod` (boş `dependencies` ve `npm pack` dosya listesi testlerde)
- [x] Kapsam eşikleri (satır): SDK ≥ %95 (şu an %99,55), `transport.ts` ve `privacy.ts` %100. `iife.ts` build çıktısı üzerinden test edilir, ölçüme girmez
- [ ] Kök README ve tam dokümantasyon (paket README'leri #17'de kısa haliyle var; yerel kurulum adımları, referans kütüphaneyle uyum tablosu, tarayıcı desteği)

## Elle yapılacaklar

- [ ] GitHub güvenlik ayarları: secret scanning, push protection, branch protection
- [x] npm: `@vitalscope` organizasyonu ve iki paket için `0.0.0` yer tutucu (3 Kasım, Mac'ten; iş ağında proxy TLS incelemesi ve passkey'in telefonla onayı engelliyor)
- [x] npm: her pakete trusted publisher (`emircanbakar` / `vitalscope` / `release.yml` / ortam `npm`, Allowed actions: `npm publish`)
- [x] npm: iki pakette de "Require two-factor authentication and disallow tokens" (senin onayınla; dışarıdan okunamadığı için doğrulanmadı)
- [x] GitHub: "Allow GitHub Actions to create and approve pull requests" (3 Kasım)
- [x] GitHub: `npm` ortamında dağıtım dalı sadece `main`. Repo private olduğu için ortam onaylayıcısı kurulamıyor ve npm provenance üretmiyor; yayının kontrol noktası sürüm PR'ının merge'ü
- [ ] npm: `@vitalscope/cli` için yer tutucu ve trusted publisher (Yayın adımından önce; ad 5 Kasım'da boştu)

## Açık sorular

- Canvas katmanı gerekli mi? Doküman "SVG ile 10.000 noktada 180 ms, Canvas ile 6 ms" gibi bir fark öngörüyor, ölçüm bunu doğrulamadı (#37; Intel UHD 770, gerçek pencere, sabit çizgi üzerinde hareket eden çapraz çizgi, kare başına ms). 10.000 noktada ikisi de 16,7 (4× CPU'da da). 50.000 noktada SVG 20,2, Canvas 18,7; 4× CPU'da SVG 22,6, Canvas 18,8. İlk çizimde belirgin bir üstünlük yok. Panel en fazla ≈ 2.000 nokta çizeceği için pratikte fark görünmeyebilir. Karar: doküman gereği 1.000 sınırı kaldı; zayıf bir makinede de fark çıkmazsa katman (≈ 40 satır) kaldırılabilir. Case study'de dokümandaki örnek sayılar kullanılmamalı

- `node:sqlite` kararlı olana kadar izlenmeli (Node 24.15'te release candidate). Karar: en düşük sürüm Node 24.15; sıfır bağımlılık, Node 22 kullanıcılarından daha değerli bulundu. Node dokümanının beta sayfası `DatabaseSync`'i `Database`'in eski adı olarak gösteriyor, yayından önce kontrol edilmeli
- Soft navigation (SPA içi LCP): tarayıcı API'si olgunlaşınca v2
