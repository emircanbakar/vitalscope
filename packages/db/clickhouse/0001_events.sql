-- Her dosya tekrar çalıştırılabilir olmalı: kayıt yazılmadan süreç ölürse dosya baştan çalışır.
-- Aynı bloğun yeniden yazılması (tamponun yeniden denemesi) `non_replicated_deduplication_window` ile tekilleşir.
-- Tarayıcı, işletim sistemi, ülke ve parmak izi sertleştirme adımına kadar varsayılan değerde kalır.

CREATE TABLE IF NOT EXISTS vitals (
  project_id   UUID,
  ts           DateTime64(3, 'UTC'),
  received_at  DateTime64(3, 'UTC'),
  name         LowCardinality(String),
  metric_id    String,
  value        Float64,
  rating       LowCardinality(String),
  sample_rate  Float32,
  sdk          LowCardinality(String),
  path         String,
  route        LowCardinality(String),
  release      LowCardinality(String),
  env          LowCardinality(String),
  device       LowCardinality(String),
  browser      LowCardinality(String),
  browser_ver  UInt16,
  os           LowCardinality(String),
  country      LowCardinality(String),
  conn         LowCardinality(String),
  nav_type     LowCardinality(String),
  session_id   String,
  attr_target  String,
  attr_url     String,
  attr_script  String,
  attr_type    LowCardinality(String),
  attr         Map(LowCardinality(String), Float64)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (project_id, name, ts)
TTL toDateTime(ts) + INTERVAL 90 DAY
SETTINGS non_replicated_deduplication_window = 1000;

CREATE TABLE IF NOT EXISTS errors (
  project_id   UUID,
  ts           DateTime64(3, 'UTC'),
  received_at  DateTime64(3, 'UTC'),
  fingerprint  UInt64,
  type         String,
  message      String,
  stack        Array(String),
  handled      Bool,
  sample_rate  Float32,
  sdk          LowCardinality(String),
  path         String,
  route        LowCardinality(String),
  release      LowCardinality(String),
  env          LowCardinality(String),
  device       LowCardinality(String),
  browser      LowCardinality(String),
  browser_ver  UInt16,
  os           LowCardinality(String),
  country      LowCardinality(String),
  conn         LowCardinality(String),
  nav_type     LowCardinality(String),
  session_id   String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (project_id, fingerprint, ts)
TTL toDateTime(ts) + INTERVAL 90 DAY
SETTINGS non_replicated_deduplication_window = 1000;

CREATE TABLE IF NOT EXISTS pageviews (
  project_id   UUID,
  ts           DateTime64(3, 'UTC'),
  received_at  DateTime64(3, 'UTC'),
  sample_rate  Float32,
  sdk          LowCardinality(String),
  path         String,
  route        LowCardinality(String),
  release      LowCardinality(String),
  env          LowCardinality(String),
  device       LowCardinality(String),
  browser      LowCardinality(String),
  browser_ver  UInt16,
  os           LowCardinality(String),
  country      LowCardinality(String),
  conn         LowCardinality(String),
  nav_type     LowCardinality(String),
  session_id   String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (project_id, ts)
TTL toDateTime(ts) + INTERVAL 90 DAY
SETTINGS non_replicated_deduplication_window = 1000;

CREATE TABLE IF NOT EXISTS custom_events (
  project_id   UUID,
  ts           DateTime64(3, 'UTC'),
  received_at  DateTime64(3, 'UTC'),
  name         String,
  value        Nullable(Float64),
  sample_rate  Float32,
  sdk          LowCardinality(String),
  path         String,
  route        LowCardinality(String),
  release      LowCardinality(String),
  env          LowCardinality(String),
  device       LowCardinality(String),
  browser      LowCardinality(String),
  browser_ver  UInt16,
  os           LowCardinality(String),
  country      LowCardinality(String),
  conn         LowCardinality(String),
  nav_type     LowCardinality(String),
  session_id   String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (project_id, name, ts)
TTL toDateTime(ts) + INTERVAL 90 DAY
SETTINGS non_replicated_deduplication_window = 1000;
