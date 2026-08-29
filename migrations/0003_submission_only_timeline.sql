DROP TABLE IF EXISTS review_events;

ALTER TABLE reviews RENAME TO reviews_with_verification;

CREATE TABLE reviews (
  submission_id TEXT PRIMARY KEY
    CHECK (
      length(submission_id) = 36
      AND substr(submission_id, 9, 1) = '-'
      AND substr(submission_id, 14, 1) = '-'
      AND substr(submission_id, 19, 1) = '-'
      AND substr(submission_id, 24, 1) = '-'
    ),
  app_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  app_store_id TEXT,
  app_version TEXT,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO reviews (
  submission_id, app_name, platform, organization_id, app_store_id, app_version,
  status, submitted_at, issue_at, successful_at, latest_event_at, submitted_via,
  guideline_code, guideline_title, rejection_reason, issue_description, next_steps,
  created_at, updated_at
)
SELECT
  submission_id, app_name, platform, organization_id, app_store_id, app_version,
  status, submitted_at, issue_at, successful_at, latest_event_at, submitted_via,
  guideline_code, guideline_title, rejection_reason, issue_description, next_steps,
  created_at, updated_at
FROM reviews_with_verification;

DROP TABLE reviews_with_verification;

CREATE INDEX idx_reviews_latest_event
  ON reviews(latest_event_at DESC);

CREATE INDEX idx_reviews_status_latest
  ON reviews(status, latest_event_at DESC);
