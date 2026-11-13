-- The name an account goes by, given at sign-up or on the account page. NULL
-- until it is given: the site shows the address instead.

ALTER TABLE users ADD COLUMN name TEXT;
