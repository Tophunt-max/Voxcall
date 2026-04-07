const http = require('http');
const https = require('https');
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

const ADMIN_PORT = 5000;
const USER_APP_PORT = 8080;
const HOST_APP_PORT = 8099;
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '3000');

// Cloudflare Workers API — set CLOUDFLARE_WORKER_URL to use remote, else fallback to local wrangler
const CF_WORKER_URL = process.env.CLOUDFLARE_WORKER_URL || null;
const API_PORT = 8787;

const ROOT = path.resolve(__dirname);

// ── Child process management ───────────────────────────────────────────────
const services = [];

function startService(name, cmd, args, env = {}, cwd = ROOT) {
  const logPath = `/tmp/${name.replace(/\s+/g, '-')}.log`;
  const fs = require('fs');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  proc.stdout.pipe(logStream, { end: false });
  proc.stderr.pipe(logStream, { end: false });

  proc.on('exit', (code, signal) => {
    console.log(`[${name}] exited (code=${code}, signal=${signal})`);
    if (code !== 0 && code !== null && signal !== 'SIGTERM') {
      setTimeout(() => {
        console.log(`[gateway] Restarting ${name}...`);
        startService(name, cmd, args, env, cwd);
      }, 5000);
    }
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

  // Admin Panel (Vite/React on port 5000 — managed here so port 3000 health-check workflow works)
  startService(
    'admin-panel',
    'pnpm',
    ['--filter', '@workspace/admin-panel', 'run', 'dev'],
    {
      PORT: String(ADMIN_PORT),
      BASE_PATH: '/admin-panel/',
    },
    ROOT
  );

  // User App (Expo/Metro on port 8080)
  startService(
    'voxlink-user',
    'pnpm',
    ['exec', 'expo', 'start', '--localhost', '--port', String(USER_APP_PORT), '--web', '--clear'],
    {
      ...commonExpoEnv,
      EXPO_PACKAGER_PROXY_URL: `https://${expoDomain}`,
      PORT: String(USER_APP_PORT),
    },
    path.join(ROOT, 'voxlink')
  );

  // Host App (Expo/Metro on port 8099)
  startService(
    'voxlink-host',
    'pnpm',
    ['exec', 'expo', 'start', '--localhost', '--port', String(HOST_APP_PORT), '--clear'],
    {
      ...commonExpoEnv,
      PORT: String(HOST_APP_PORT),
      EXPO_BASE_URL: '/host',
    },
    path.join(ROOT, 'voxlink-host')
  );

  // API Server — only spawn local wrangler if no remote Cloudflare Worker URL is set
  if (!CF_WORKER_URL) {
    startService(
      'api-server',
      'pnpm',
      ['--filter', '@workspace/api-server', 'run', 'dev'],
      {},
      ROOT
    );
  } else {
    console.log(`[gateway] Using remote Cloudflare Worker: ${CF_WORKER_URL}`);
  }
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
  // Rewrite Origin/Referer for Expo Metro servers so CorsMiddleware
  // does not reject requests coming from the external Replit domain
  if (targetPort === USER_APP_PORT || targetPort === HOST_APP_PORT) {
    h.origin = `http://localhost:${targetPort}`;
    if (h.referer) h.referer = `http://localhost:${targetPort}/`;
  }
  return h;
}

const HOST_BASE_PATH_SCRIPT = `<script>
(function() {
  var base = '/host';
  var p = window.location.pathname;
  if (p === base || p.startsWith(base + '/')) {
    var newPath = p.slice(base.length) || '/';
    history.replaceState(null, '', newPath + window.location.search + window.location.hash);
  }
  var _push = history.pushState.bind(history);
  var _replace = history.replaceState.bind(history);
  function rebase(url) {
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith(base)) {
      return base + url;
    }
    return url;
  }
  history.pushState = function(s,t,u) { return _push(s, t, rebase(u)); };
  history.replaceState = function(s,t,u) { return _replace(s, t, rebase(u)); };
})();
</script>`;

function rewriteHostHtml(html) {
  let result = html.replace('<head>', '<head>' + HOST_BASE_PATH_SCRIPT);
  result = result
    .replace(/src="\/(?!host\/|\/)/g, 'src="/host/')
    .replace(/href="\/(?!host\/|\/)/g, 'href="/host/');
  return result;
}

// ── HTTP proxy ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const targetPort = getTargetPort(req.url);
  const isApiReq = (req.url || '').startsWith('/api');
  const targetPath = rewritePath(req.url, targetPort);

  // Forward API requests to remote Cloudflare Worker if configured
  if (isApiReq && CF_WORKER_URL) {
    const parsed = new URL(CF_WORKER_URL);
    const cfHeaders = { ...req.headers, host: parsed.hostname };
    delete cfHeaders['content-length']; // let Node recalculate

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? Buffer.concat(chunks) : null;
      if (body && body.length) cfHeaders['content-length'] = String(body.length);

      const cfReq = https.request(
        { hostname: parsed.hostname, port: 443, path: targetPath, method: req.method, headers: cfHeaders },
        (cfRes) => {
          const resHeaders = { ...cfRes.headers, 'access-control-allow-origin': '*' };
          res.writeHead(cfRes.statusCode, resHeaders);
          cfRes.pipe(res);
        }
      );
      cfReq.on('error', () => { res.writeHead(502); res.end('Cloudflare Worker unavailable'); });
      if (body && body.length) cfReq.write(body);
      cfReq.end();
    });
    return;
  }

  const headers = buildHeaders(req.headers, targetPort);
  const proxyReq = http.request(
    { hostname: '127.0.0.1', port: targetPort, path: targetPath, method: req.method, headers },
    (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      const isHostApp = targetPort === HOST_APP_PORT;
      const isHtml = contentType.includes('text/html');

      const resHeaders = { ...proxyRes.headers, 'access-control-allow-origin': '*' };

      if (isHostApp && isHtml) {
        delete resHeaders['content-length'];
        res.writeHead(proxyRes.statusCode, resHeaders);
        const respChunks = [];
        proxyRes.on('data', (chunk) => respChunks.push(chunk));
        proxyRes.on('end', () => {
          const original = Buffer.concat(respChunks).toString('utf8');
          const rewritten = rewriteHostHtml(original);
          res.end(rewritten);
        });
      } else {
        res.writeHead(proxyRes.statusCode, resHeaders);
        proxyRes.pipe(res);
      }
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
  if (CF_WORKER_URL) {
    console.log(`  /api/*         -> ${CF_WORKER_URL} (Cloudflare Worker)`);
  } else {
    console.log(`  /api/*         -> localhost:${API_PORT} (API Server local)`);
  }
  console.log(`  /*             -> localhost:${USER_APP_PORT} (User App)`);
});
