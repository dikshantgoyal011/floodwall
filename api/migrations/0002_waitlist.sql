-- The waitlist. While SIGNUP_MODE is "waitlist", a new account waits until
-- an admin approves it. Accounts made before this migration are approved.

ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE users ADD COLUMN approved_at INTEGER;
ALTER TABLE users ADD COLUMN approved_by TEXT;

CREATE INDEX users_status ON users (status, created_at);
