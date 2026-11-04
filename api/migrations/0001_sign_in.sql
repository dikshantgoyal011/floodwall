-- Sign-in by emailed one-time code. Times are milliseconds since the epoch.

-- An account: made the first time an address signs in.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_sign_in_at INTEGER NOT NULL
);

-- The one live code per address; a new code replaces the last one. Only an
-- HMAC of the code is kept, keyed with AUTH_SECRET.
CREATE TABLE sign_in_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- A signed-in browser, by the SHA-256 of its cookie's token.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- Requests counted per network or address, in fixed windows.
CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
