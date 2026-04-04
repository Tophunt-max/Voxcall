# FIX #20: D1 → PostgreSQL Migration Plan

## Why Migrate?

Cloudflare D1 (SQLite) has limitations at scale:
- Write concurrency limits (~1 write at a time per database)
- No native connection pooling
- Limited to 10GB storage per database
- No advanced indexes (partial, GiST, etc.)

At **10,000+ concurrent users**, D1 will become a bottleneck for high-frequency writes (coin transactions, call events, chat messages).

## Recommended Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Database | **Neon (PostgreSQL)** | Serverless, free tier, edge-compatible |
| ORM | **Drizzle ORM** | Already in use, supports PostgreSQL |
| Connection Pooling | **PgBouncer via Neon** | Built-in |
| Deployment | **Cloudflare Workers + Hyperdrive** | Low-latency DB access from edge |

## Migration Steps

### Phase 1: Schema Migration
1. Export current D1 schema to PostgreSQL-compatible SQL
2. Replace `INTEGER DEFAULT (unixepoch())` → `BIGINT DEFAULT extract(epoch from now())`
3. Replace `TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8))))` → `UUID DEFAULT gen_random_uuid()`
4. Add proper `SERIAL` or `UUID` primary keys
5. Replace `REAL` amounts with `NUMERIC(10,2)` for financial precision

### Phase 2: Data Migration
1. Export all D1 data: `wrangler d1 export voxlink-db --output=dump.sql`
2. Transform SQL dialect (SQLite → PostgreSQL)
3. Import to Neon: `psql $NEON_URL < transformed_dump.sql`
4. Verify row counts match

### Phase 3: Dual-Write (Zero Downtime)
1. Add `POSTGRES_URL` secret to Cloudflare Workers
2. Update Drizzle config to use PostgreSQL driver
3. Write to BOTH D1 and PostgreSQL for 1 week
4. Compare query results for consistency

### Phase 4: Cutover
1. Switch reads to PostgreSQL
2. Stop D1 writes
3. Monitor for 48 hours
4. Decommission D1

## Cost Estimate

| Service | Free Tier | Paid |
|---------|-----------|------|
| Neon | 0.5GB storage, 191 compute hours | $19/mo for 10GB |
| Cloudflare Hyperdrive | $0.15/million queries | - |

## Timeline

- Phase 1+2: 1 week
- Phase 3 (dual-write): 1 week  
- Phase 4 (cutover): 1 day

**Trigger point**: Begin migration when DAU > 5,000 or write latency consistently > 200ms.
