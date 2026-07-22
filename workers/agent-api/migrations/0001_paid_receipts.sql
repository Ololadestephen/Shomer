CREATE TABLE IF NOT EXISTS paid_receipts (
  receipt_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'report_ready', 'settled')),
  response_status INTEGER,
  response_json TEXT,
  payment_response_header TEXT,
  transaction_hash TEXT,
  report_id TEXT,
  network TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS paid_receipts_state_updated_idx
  ON paid_receipts (state, updated_at);
