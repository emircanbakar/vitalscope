-- Dashboard'daki bir açık veri silemez veya yazamaz; ingest'teki bir açık veri okuyamaz.
-- Kullanıcılar ve şifreleri ortam değişkenlerinden gelir (src/migrate.ts); burada sadece roller var.

CREATE ROLE IF NOT EXISTS vitalscope_ingest;
GRANT INSERT ON vitalscope.vitals TO vitalscope_ingest;
GRANT INSERT ON vitalscope.errors TO vitalscope_ingest;
GRANT INSERT ON vitalscope.pageviews TO vitalscope_ingest;
GRANT INSERT ON vitalscope.custom_events TO vitalscope_ingest;

CREATE ROLE IF NOT EXISTS vitalscope_read;
GRANT SELECT ON vitalscope.vitals TO vitalscope_read;
GRANT SELECT ON vitalscope.errors TO vitalscope_read;
GRANT SELECT ON vitalscope.pageviews TO vitalscope_read;
GRANT SELECT ON vitalscope.custom_events TO vitalscope_read;

CREATE SETTINGS PROFILE IF NOT EXISTS vitalscope_read_limits
  SETTINGS max_execution_time = 10, max_result_rows = 100000
  TO vitalscope_read;
