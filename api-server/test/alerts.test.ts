import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { formatAlertText, raiseAdminAlert } from '../src/lib/alerts';
import { createTestDb, type FakeD1 } from './helpers/d1';

describe('formatAlertText', () => {
  it('renders a severity-prefixed one-liner', () => {
    expect(formatAlertText('coin_reconciliation', 'drift 5000', 'critical')).toBe('🔴 [VoxLink CRITICAL] coin_reconciliation: drift 5000');
    expect(formatAlertText('x', 'y', 'warn')).toBe('🟠 [VoxLink WARN] x: y');
    expect(formatAlertText('x', 'y', 'info')).toBe('🔵 [VoxLink INFO] x: y');
  });
  it('defaults to warn', () => {
    expect(formatAlertText('c', 'm')).toContain('WARN');
  });
});

describe('raiseAdminAlert', () => {
  let db: FakeD1;
  const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));

  beforeEach(() => {
    db = createTestDb();
    db.applySchema(`
      CREATE TABLE app_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT, message TEXT, stack TEXT, context TEXT,
        platform TEXT, app_version TEXT, extra TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER);
    `);
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function rows() {
    return (await db.prepare('SELECT * FROM app_errors').all<any>()).results;
  }

  it('always persists an app_errors row', async () => {
    await raiseAdminAlert(db as any, { context: 'coin_reconciliation', message: 'drift', severity: 'critical', platform: 'cron' });
    const r = await rows();
    expect(r.length).toBe(1);
    expect(r[0].context).toBe('coin_reconciliation');
    expect(r[0].app_version).toBe('critical'); // severity stored in app_version
    expect(r[0].platform).toBe('cron');
  });

  it('does NOT call the webhook when none is configured', async () => {
    await raiseAdminAlert(db as any, { context: 'c', message: 'm' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs a Slack-style payload when an HTTPS webhook is configured', async () => {
    db.applySchema("INSERT INTO app_settings (key, value) VALUES ('alert_webhook_url', 'https://hooks.example.com/abc');");
    await raiseAdminAlert(db as any, { context: 'payment_amount_mismatch', message: 'expected 100 got 1', severity: 'critical' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe('https://hooks.example.com/abc');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).text).toContain('payment_amount_mismatch');
  });

  it('refuses a non-HTTPS webhook (SSRF guard) but still persists the row', async () => {
    db.applySchema("INSERT INTO app_settings (key, value) VALUES ('alert_webhook_url', 'http://169.254.169.254/latest');");
    await raiseAdminAlert(db as any, { context: 'c', message: 'm' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await rows()).length).toBe(1);
  });

  it('never throws even if the webhook fetch rejects', async () => {
    db.applySchema("INSERT INTO app_settings (key, value) VALUES ('alert_webhook_url', 'https://hooks.example.com/abc');");
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(raiseAdminAlert(db as any, { context: 'c', message: 'm' })).resolves.toBeUndefined();
    expect((await rows()).length).toBe(1); // row still persisted
  });
});
