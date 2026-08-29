CREATE TABLE IF NOT EXISTS reviews (
  submission_key TEXT PRIMARY KEY,
  app_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  app_store_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('issue', 'success')),
  submitted_at TEXT,
  issue_at TEXT,
  successful_at TEXT,
  latest_event_at TEXT NOT NULL,
  submitted_via TEXT,
  guideline_code TEXT,
  guideline_title TEXT,
  rejection_reason TEXT,
  issue_description TEXT,
  next_steps TEXT,
  verification TEXT NOT NULL CHECK (verification IN ('apple-authenticated', 'forwarded-email')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reviews_latest_event
  ON reviews(latest_event_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_status_latest
  ON reviews(status, latest_event_at DESC);

CREATE TABLE IF NOT EXISTS review_events (
  event_key TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('issue', 'success')),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_key) REFERENCES reviews(submission_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_review_events_submission
  ON review_events(submission_key, occurred_at ASC);
