// ============================================================================
// coin_transactions → R2 archival (financial-ledger cold storage).
// ============================================================================
//
// coin_transactions is the money ledger and is deliberately EXCLUDED from the
// destructive retention sweep (lib/retention.ts) for two reasons:
//   1. Compliance — financial history should be retained, not deleted.
//   2. The coin-reconciliation watchdog asserts
//          SUM(users.coins) == SUM(coin_transactions.amount).
//      Blindly deleting ledger rows breaks that invariant and pages an operator.
//
// This job ARCHIVES the oldest rows to R2 (durable, cheap, queryable cold
// storage) as NDJSON, THEN deletes them from D1 — keeping the hot table bounded
// under D1's ~10 GB ceiling WITHOUT losing the records. To preserve the
// reconciliation invariant, the signed net of every archived batch is
// accumulated into the `coin_tx_archived_net` app_setting; the watchdog and the
// admin dashboard add it back to the live ledger sum, so drift math is unchanged
// after archival (see maybeReconcileCoins in index.ts and GET
// /admin/coin-reconciliation).
//
// SAFETY:
//   • OPT-IN. Disabled by default (`coin_tx_archive_days = 0`). An operator sets
//     it to a retention window (e.g. 730 = keep ~2 years hot) to enable. This is
//     the conservative default for a money table.
//   • Per batch: write R2 object FIRST, then delete + bump archived_net in a
//     SINGLE D1 batch (atomic) so the ledger sum and archived_net always move
//     together. If the R2 write fails we skip (rows stay). If the atomic batch
//     fails after a successful R2 write, the rows simply get re-archived next
//     run (a harmless duplicate object in R2), never lost or double-counted.
//   • Bounded batches + per-run cap so one run never holds a long write lock or
//     blows the Worker budget; leftovers drain on the next run.
// ============================================================================

import type { Env } from '../types';

const BATCH_SIZE = 200;
const MAX_BATCHES_PER_RUN = 10; // ≤ 2000 rows/run
const RUN_INTERVAL_SEC = 24 * 3600; // at most once/day

interface CoinTxRow {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  description: string | null;
  ref_id: string | null;
  created_at: number;
}

async function readIntSetting(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    const n = parseInt(row?.value ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export async function archiveOldCoinTransactions(
  env: Env,
): Promise<{ skipped?: boolean; archived?: number; batches?: number }> {
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);

  // Opt-in: 0 (default) = disabled.
  const days = await readIntSetting(db, 'coin_tx_archive_days', 0);
  if (days <= 0) return { skipped: true };

  // Daily interval gate — claim the slot BEFORE running.
  const last = await readIntSetting(db, 'last_coin_tx_archive_run', 0);
  if (now - last < RUN_INTERVAL_SEC) return { skipped: true };
  await db
    .prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('last_coin_tx_archive_run', ?, unixepoch())")
    .bind(String(now))
    .run();

  const cutoff = now - days * 86400;
  let archived = 0;
  let batches = 0;

  for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
    let rows: CoinTxRow[];
    try {
      const res = await db
        .prepare(
          `SELECT id, user_id, type, amount, description, ref_id, created_at
             FROM coin_transactions
            WHERE created_at < ?
            ORDER BY created_at ASC
            LIMIT ?`,
        )
        .bind(cutoff, BATCH_SIZE)
        .all<CoinTxRow>();
      rows = res.results ?? [];
    } catch (e) {
      console.warn('[archive] coin_transactions select failed (non-fatal):', e);
      break;
    }
    if (rows.length === 0) break;

    // Signed net of this batch — added to archived_net so the reconciliation
    // invariant (wallets == live-ledger + archived_net) is preserved.
    let batchNet = 0;
    for (const r of rows) batchNet += Number(r.amount) || 0;

    // 1. Durable copy to R2 FIRST (NDJSON, one row per line). Partitioned by
    //    UTC date for easy lifecycle/retrieval.
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    const key = `archive/coin_transactions/${day}/${now}-${i}-${crypto.randomUUID().slice(0, 8)}.ndjson`;
    const ndjson = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    try {
      await env.STORAGE.put(key, ndjson, { httpMetadata: { contentType: 'application/x-ndjson' } });
    } catch (e) {
      console.warn('[archive] R2 put failed; leaving rows in D1 for next run:', e);
      break;
    }

    // 2. Atomically delete the archived rows AND advance archived_net so the
    //    ledger sum and its offset never drift apart.
    const prevNet = await readIntSetting(db, 'coin_tx_archived_net', 0);
    const newNet = prevNet + Math.round(batchNet);
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    try {
      await db.batch([
        db.prepare(`DELETE FROM coin_transactions WHERE id IN (${placeholders})`).bind(...ids),
        db
          .prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('coin_tx_archived_net', ?, unixepoch())")
          .bind(String(newNet)),
      ]);
    } catch (e) {
      // R2 object already written; rows remain in D1 → re-archived next run
      // (duplicate R2 object, no data loss, no double-count). Stop this run.
      console.warn('[archive] D1 delete/offset batch failed; rows kept:', e);
      break;
    }

    archived += rows.length;
    batches++;
    if (rows.length < BATCH_SIZE) break; // drained
  }

  if (archived > 0) {
    console.log(`[Cron] coin_transactions archival: ${archived} rows in ${batches} batch(es) to R2`);
  }
  return { archived, batches };
}

/** Cumulative signed net of all coin_transactions rows already archived to R2
 *  and removed from D1. The reconciliation watchdog + admin dashboard add this
 *  to the live ledger sum so drift is measured against the FULL ledger. */
export async function getArchivedLedgerNet(db: D1Database): Promise<number> {
  return readIntSetting(db, 'coin_tx_archived_net', 0);
}
