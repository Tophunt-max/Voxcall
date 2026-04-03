const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

const ADMIN_PORT = 5000;
const USER_APP_PORT = 8080;
const HOST_APP_PORT = 8099;
const API_PORT = 8787;
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '3000');

const ROOT = path.resolve(__dirname);

// ── Child process management ───────────────────────────────────────────────
const services = [];

function startService(name, cmd, args, env = {}) {
  const logPath = `/tmp/${name.replace(/\s+/g, '-')}.log`;
  const fs = require('fs');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const proc = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  proc.stdout.pipe(logStream, { end: false });
  proc.stderr.pipe(logStream, { end: false });

  proc.on('exit', (code, signal) => {
    console.log(`[${name}] exited (code=${code}, signal=${signal})`);
  });

  services.push({ name, proc });
  console.log(`[gateway] Started ${name} (pid=${proc.pid}) → log: ${logPath}`);
  return proc;
}

function startAllServices() {
  const domain = process.env.REPLIT_DEV_DOMAIN || 'localhost';
  const expoDomain = process.env.REPLIT_EXPO_DEV_DOMAIN || 'localhost';
  const apiUrl = `https://${domain}`;

  const commonExpoEnv = {
    EXPO_PUBLIC_DOMAIN: domain,
    EXPO_PUBLIC_REPL_ID: process.env.REPL_ID || '',
    REACT_NATIVE_PACKAGER_HOSTNAME: domain,
    EXPO_PUBLIC_API_URL: apiUrl,
  };

  // Admin Panel (Vite on port 5000)
  startService('admin-panel', 'pnpm', ['--filter', '@workspace/admin-panel', 'run', 'dev'], {
    BASE_PATH: '/admin-panel/',
    PORT: String(ADMIN_PORT),
  });

  // User App (Expo/Metro on port 8080) — uses expo domain for QR code
  startService('voxlink-user', 'pnpm', ['--filter', '@workspace/voxlink', 'run', 'dev'], {
    ...commonExpoEnv,
    EXPO_PACKAGER_PROXY_URL: `https://${expoDomain}`,
    PORT: String(USER_APP_PORT),
  });

  // Host App (Expo/Metro on port 8099) — no expo domain to avoid conflict with user app
  // Access via Gateway: https://[domain]/host/
  startService('voxlink-host', 'pnpm', ['--filter', '@workspace/voxlink-host', 'run', 'dev'], {
    ...commonExpoEnv,
    PORT: String(HOST_APP_PORT),
  });

  // API Server (Wrangler on port 8787)
  startService('api-server', 'pnpm', ['--filter', '@workspace/api-server', 'run', 'dev'], {});
}

// ── Request routing ────────────────────────────────────────────────────────
function getTargetPort(url) {
  const p = url || '/';
  if (p.startsWith('/admin-panel')) return ADMIN_PORT;
  if (p.startsWith('/host')) return HOST_APP_PORT;
  if (p.startsWith('/api')) return API_PORT;
  return USER_APP_PORT;
}

function rewritePath(url, targetPort) {
  if (targetPort === HOST_APP_PORT) {
    const stripped = url.replace(/^\/host/, '') || '/';
    return stripped.startsWith('/') ? stripped : '/' + stripped;
  }
  return url;
}

function buildHeaders(original, targetPort) {
  const h = { ...original, host: `localhost:${targetPort}` };
  if (targetPort === HOST_APP_PORT) {
    h.origin = `http://localhost:${targetPort}`;
    if (h.referer) h.referer = `http://localhost:${targetPort}/`;
  }
  return h;
}

// ── HTTP proxy ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const targetPort = getTargetPort(req.url);
  const targetPath = rewritePath(req.url, targetPort);
  const headers = buildHeaders(req.headers, targetPort);

  const proxyReq = http.request(
    { hostname: '127.0.0.1', port: targetPort, path: targetPath, method: req.method, headers },
    (proxyRes) => {
      const resHeaders = { ...proxyRes.headers, 'access-control-allow-origin': '*' };
      res.writeHead(proxyRes.statusCode, resHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', () => { res.writeHead(502); res.end('Service unavailable'); });
  req.pipe(proxyReq);
});

// ── WebSocket proxy ────────────────────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  const targetPort = getTargetPort(req.url);
  const targetPath = rewritePath(req.url, targetPort);
  const headers = buildHeaders(req.headers, targetPort);

  const target = net.createConnection({ port: targetPort, host: '127.0.0.1' });
  target.on('connect', () => {
    const reqLine = `${req.method} ${targetPath} HTTP/1.1\r\n`;
    const headerStr = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    target.write(`${reqLine}${headerStr}\r\n\r\n`);
    if (head && head.length) target.write(head);
    target.pipe(socket);
    socket.pipe(target);
  });
  target.on('error', () => socket.destroy());
  socket.on('error', () => target.destroy());
});

// ── Shutdown ───────────────────────────────────────────────────────────────
function shutdown() {
  services.forEach(({ name, proc }) => {
    try { proc.kill('SIGTERM'); } catch (_) {}
  });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ── Start ──────────────────────────────────────────────────────────────────
startAllServices();

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`VoxLink Gateway running on port ${PROXY_PORT}`);
  console.log(`  /admin-panel/* -> localhost:${ADMIN_PORT} (Admin Panel)`);
  console.log(`  /host/*        -> localhost:${HOST_APP_PORT} (Host App)`);
  console.log(`  /*             -> localhost:${USER_APP_PORT} (User App)`);
});
