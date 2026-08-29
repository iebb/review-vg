ALTER TABLE reviews ADD COLUMN app_category TEXT;

CREATE INDEX idx_reviews_app_store_submission
  ON reviews(app_store_id, submitted_at DESC, latest_event_at DESC);
