CREATE TABLE raw_emails (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  envelope_from TEXT NOT NULL,
  envelope_to TEXT NOT NULL,
  message_id TEXT,
  subject TEXT,
  raw_size INTEGER NOT NULL CHECK (raw_size >= 0),
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0)
);

CREATE TABLE raw_email_chunks (
  email_id TEXT NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  raw_chunk BLOB NOT NULL,
  PRIMARY KEY (email_id, chunk_index)
);

CREATE INDEX raw_emails_expires_at_idx ON raw_emails(expires_at);
CREATE INDEX raw_emails_received_at_idx ON raw_emails(received_at DESC);
