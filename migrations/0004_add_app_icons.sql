ALTER TABLE reviews ADD COLUMN app_icon_url TEXT;

CREATE INDEX idx_reviews_app_store_id
  ON reviews(app_store_id);
