-- Migration 0023: country + currency on users for auto-detection
--
-- Cloudflare Workers expose the visitor's country code via the `cf` request
-- object (request.cf.country) and the equivalent `CF-IPCountry` header. We
-- store this on the user row at first login so:
--   1. Coin plans can be priced in the user's local currency without an
--      extra round-trip to a geolocation service.
--   2. The host app's withdrawal screen and earnings dashboard can show the
--      host's earnings in their own currency.
--   3. The user can override the auto-detected currency in Settings later
--      without losing the original detection.
--
-- country  — ISO 3166-1 alpha-2 code (IN, US, GB, etc.). Nullable until the
--            first request after migration populates it.
-- currency — ISO 4217 code (INR, USD, GBP, etc.). Derived from country via
--            the COUNTRY_TO_CURRENCY map in src/lib/currency.ts. Stored on
--            the row so the user can override it independently of country.

ALTER TABLE users ADD COLUMN country TEXT;
ALTER TABLE users ADD COLUMN currency TEXT;

-- Index for any future analytics dashboard that wants to break down users
-- by country (regulatory reporting, regional growth charts, etc.). Keeping
-- it small since the column has very low cardinality.
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country);
