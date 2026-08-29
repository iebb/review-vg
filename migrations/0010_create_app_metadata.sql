CREATE TABLE app_metadata (
  app_store_id TEXT PRIMARY KEY
    CHECK (
      length(app_store_id) BETWEEN 6 AND 20
      AND app_store_id NOT GLOB '*[^0-9]*'
    ),
  app_icon_url TEXT,
  app_category TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO app_metadata (
  app_store_id, app_icon_url, app_category, last_checked_at
)
SELECT app_store_id, MAX(app_icon_url), MAX(app_category), CURRENT_TIMESTAMP
  FROM reviews
 WHERE app_store_id IS NOT NULL
   AND (app_icon_url IS NOT NULL OR app_category IS NOT NULL)
 GROUP BY app_store_id;

CREATE INDEX idx_app_metadata_last_checked
  ON app_metadata(last_checked_at);

PRAGMA optimize;
