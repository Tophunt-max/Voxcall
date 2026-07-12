// ============================================================================
// Health Check Probes — production uptime monitoring
// ============================================================================
//
// Runs every minute via the cron scheduler. Probes each dependency and records
// a row in health_checks so the admin dashboard can render:
//   - Real-time service status (D1, R2, Agora, FCM, Email)
//   - Uptime percentage (last 1h / 24h / 7d)
//   - Latency percentiles (D1 query time, R2 HEAD time)
//   - Incident history timeline
//   - Error rate trend
//
// Each probe is isolated: a failure in one never prevents the others from
// running. The overall_status is the worst of all individual statuses.
// ============================================================================

import type { Env } from '../types';
import { isAgoraConfigured } from './agoraToken';

export interface HealthProbeResult {
  overall_status: 'ok' | 'degraded' | 'down';
  db_latency_ms: number;
  db_status: 'ok' | 'error';
  r2_latency_ms: number;
  r2_status: 'ok' | 'error';
  agora_status: 'ok' | 'unconfigured' | 'error';
  fcm_status: 'ok' | 'unconfigured' | 'error';
  email_status: 'ok' | 'unconfigured';
  active_calls: number;
  online_hosts: number;
  error_count_hour: number;
  cron_age_sec: number;
  checked_at: number;
}

/**
 * Probe D1 — simple SELECT 1 with latency measurement.
 */
async function probeD1(db: D1Database): Promise<{ latency: number; status: 'ok' | 'error' }> {
  const start = Date.now();
  try {
    await db.prepare('SELECT 1').first();
    return { latency: Date.now() - start, status: 'ok' };
  } catch {
    return { latency: -1, status: 'error' };
  }
}

/**
 * Probe R2 — HEAD request on a known key (or list with limit 1).
 */
async function probeR2(storage: R2Bucket): Promise<{ latency: number; status: 'ok' | 'error' }> {
  const start = Date.now();
  try {
    // list with limit 1 is the cheapest R2 operation that proves connectivity.
    await storage.list({ limit: 1 });
    return { latency: Date.now() - start, status: 'ok' };
  } catch {
    return { latency: -1, status: 'error' };
  }
}

/**
 * Check Agora — just verifies credentials are configured (no network call needed).
 */
function probeAgora(env: Env): 'ok' | 'unconfigured' | 'error' {
  try {
    return isAgoraConfigured(env) ? 'ok' : 'unconfigured';
  } catch {
    return 'error';
  }
}

/**
 * Check FCM — verifies FIREBASE_SERVICE_ACCOUNT is present and parseable.
 */
function probeFCM(env: Env): 'ok' | 'unconfigured' | 'error' {
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT) return 'unconfigured';
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    return parsed?.client_email ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

/**
 * Check Email — verifies RESEND_API_KEY is set.
 */
function probeEmail(env: Env): 'ok' | 'unconfigured' {
  return env.RESEND_API_KEY ? 'ok' : 'unconfigured';
}

/**
 * Run all health probes and return a consolidated result.
 */
export async function runHealthProbes(env: Env): Promise<HealthProbeResult> {
  const now = Math.floor(Date.now() / 1000);
  const hourAgo = now - 3600;

  // Run probes in parallel
  const [d1Result, r2Result] = await Promise.all([
    probeD1(env.DB),
    probeR2(env.STORAGE),
  ]);

  const agoraStatus = probeAgora(env);
  const fcmStatus = probeFCM(env);
  const emailStatus = probeEmail(env);

  // Fetch live metrics (best-effort — don't let metrics failure affect probe)
  let activeCalls = 0;
  let onlineHosts = 0;
  let errorCountHour = 0;
  let cronAgeSec = 0;

  try {
    const [callsRow, hostsRow, errorsRow, cronRow] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n FROM call_sessions WHERE status = 'active'").first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM hosts WHERE is_online = 1').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM app_errors WHERE created_at > ?').bind(hourAgo).first<{ n: number }>().catch(() => ({ n: 0 })),
      env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_cron_run'").first<{ value: string }>().catch(() => null),
    ]);
    activeCalls = Number(callsRow?.n ?? 0);
    onlineHosts = Number(hostsRow?.n ?? 0);
    errorCountHour = Number(errorsRow?.n ?? 0);
    const lastCron = cronRow?.value ? parseInt(cronRow.value, 10) : 0;
    cronAgeSec = lastCron > 0 ? Math.max(0, now - lastCron) : 999999;
  } catch {
    // Metrics collection failed — non-fatal
  }

  // Compute overall status
  let overall_status: 'ok' | 'degraded' | 'down' = 'ok';
  if (d1Result.status === 'error') {
    overall_status = 'down'; // Can't do anything without the database
  } else if (
    r2Result.status === 'error' ||
    agoraStatus === 'error' ||
    fcmStatus === 'error' ||
    errorCountHour > 50 ||
    cronAgeSec > 300
  ) {
    overall_status = 'degraded';
  }

  return {
    overall_status,
    db_latency_ms: d1Result.latency,
    db_status: d1Result.status,
    r2_latency_ms: r2Result.latency,
    r2_status: r2Result.status,
    agora_status: agoraStatus,
    fcm_status: fcmStatus,
    email_status: emailStatus,
    active_calls: activeCalls,
    online_hosts: onlineHosts,
    error_count_hour: errorCountHour,
    cron_age_sec: cronAgeSec,
    checked_at: now,
  };
}

/**
 * Store a health probe result in the health_checks table.
 * Best-effort — never throws.
 */
export async function storeHealthCheck(db: D1Database, result: HealthProbeResult): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO health_checks (checked_at, overall_status, db_latency_ms, db_status, r2_latency_ms, r2_status, agora_status, fcm_status, email_status, active_calls, online_hosts, error_count_hour, cron_age_sec)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      result.checked_at,
      result.overall_status,
      result.db_latency_ms,
      result.db_status,
      result.r2_latency_ms,
      result.r2_status,
      result.agora_status,
      result.fcm_status,
      result.email_status,
      result.active_calls,
      result.online_hosts,
      result.error_count_hour,
      result.cron_age_sec,
    ).run();
  } catch (e) {
    console.warn('[health] storeHealthCheck failed:', e);
  }
}

/**
 * Prune health check records older than retention days.
 * Best-effort — never throws.
 */
export async function pruneHealthChecks(db: D1Database, retentionDays = 7): Promise<void> {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
    await db.prepare('DELETE FROM health_checks WHERE checked_at < ?').bind(cutoff).run();
  } catch (e) {
    console.warn('[health] pruneHealthChecks failed:', e);
  }
}

/**
 * Calculate uptime percentage from health check history.
 */
export async function getUptimeStats(db: D1Database, periodSec: number): Promise<{
  total_checks: number;
  ok_checks: number;
  degraded_checks: number;
  down_checks: number;
  uptime_pct: number;
}> {
  const cutoff = Math.floor(Date.now() / 1000) - periodSec;
  try {
    const rows = await db.prepare(
      `SELECT overall_status, COUNT(*) AS cnt FROM health_checks WHERE checked_at > ? GROUP BY overall_status`
    ).bind(cutoff).all<{ overall_status: string; cnt: number }>();
    
    let ok = 0, degraded = 0, down = 0;
    for (const r of rows.results ?? []) {
      if (r.overall_status === 'ok') ok = r.cnt;
      else if (r.overall_status === 'degraded') degraded = r.cnt;
      else down = r.cnt;
    }
    const total = ok + degraded + down;
    // Uptime = (ok + degraded) / total — "degraded" still means the service is reachable
    const uptime_pct = total > 0 ? ((ok + degraded) / total) * 100 : 100;
    return { total_checks: total, ok_checks: ok, degraded_checks: degraded, down_checks: down, uptime_pct: Math.round(uptime_pct * 100) / 100 };
  } catch {
    return { total_checks: 0, ok_checks: 0, degraded_checks: 0, down_checks: 0, uptime_pct: 100 };
  }
}
