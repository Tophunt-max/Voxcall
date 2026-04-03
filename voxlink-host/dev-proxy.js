const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '8099');
const METRO_PORT = PORT - 1; // 8098
const BASE = '/host';

function stripBase(url) {
  if (url.startsWith(BASE + '/')) return url.slice(BASE.length);
  if (url === BASE) return '/';
  return url;
}

let metroReady = false;
let metroProcess = null;

function pollMetro() {
  const sock = net.connect(METRO_PORT, '127.0.0.1', () => {
    sock.destroy();
    if (!metroReady) {
      metroReady = true;
      console.log(`[proxy] Metro ready on port ${METRO_PORT}`);
    }
  });
  sock.on('error', () => {
    if (!metroReady) setTimeout(pollMetro, 2000);
  });
}

function shutdown(code) {
  if (metroProcess) {
    try { metroProcess.kill('SIGKILL'); } catch (_) {}
  }
  process.exit(code || 0);
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  if (url === '/status' || url === BASE + '/status') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end('packager-status:running');
    return;
  }

  const target = stripBase(url);
  const forwardHeaders = { ...req.headers, host: `localhost:${METRO_PORT}` };
  if (forwardHeaders.origin) forwardHeaders.origin = `http://localhost:${METRO_PORT}`;
  if (forwardHeaders.referer) forwardHeaders.referer = `http://localhost:${METRO_PORT}/`;

  const opts = {
    hostname: '127.0.0.1',
    port: METRO_PORT,
    path: target,
    method: req.method,
    headers: forwardHeaders,
  };
  const proxy = http.request(opts, (metroRes) => {
    res.writeHead(metroRes.statusCode, metroRes.headers);
    metroRes.pipe(res, { end: true });
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h2>VoxLink Host loading...</h2><script>setTimeout(()=>location.reload(),3000)</script></body></html>');
    }
  });
  req.pipe(proxy, { end: true });
});

server.on('upgrade', (req, socket, head) => {
  const target = stripBase(req.url);
  const metroSocket = net.connect(METRO_PORT, '127.0.0.1', () => {
    const headers = Object.entries(req.headers)
      .filter(([k]) => k !== 'host')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    metroSocket.write(
      `${req.method} ${target} HTTP/1.1\r\nHost: localhost:${METRO_PORT}\r\n${headers}\r\n\r\n`
    );
    if (head && head.length) metroSocket.write(head);
    socket.pipe(metroSocket);
    metroSocket.pipe(socket);
  });
  metroSocket.on('error', () => socket.destroy());
  socket.on('error', () => metroSocket.destroy());
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[proxy] Port ${PORT} in use, retrying in 2s...`);
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 2000);
  } else {
    console.error('[proxy] Server error:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] VoxLink Host proxy on port ${PORT} -> Metro on ${METRO_PORT}`);

  setTimeout(pollMetro, 1000);

  metroProcess = spawn(
    'pnpm',
    ['exec', 'expo', 'start', '--localhost', '--port', String(METRO_PORT)],
    {
      env: {
        ...process.env,
        PORT: String(METRO_PORT),
        EXPO_PACKAGER_PROXY_URL: `https://${process.env.REPLIT_EXPO_DEV_DOMAIN || 'localhost'}`,
        EXPO_PUBLIC_DOMAIN: process.env.REPLIT_DEV_DOMAIN || 'localhost',
        EXPO_PUBLIC_REPL_ID: process.env.REPL_ID || '',
        REACT_NATIVE_PACKAGER_HOSTNAME: process.env.REPLIT_DEV_DOMAIN || 'localhost',
      },
      stdio: 'inherit',
      cwd: __dirname,
    }
  );

  metroProcess.on('exit', (code) => {
    console.log(`[proxy] Metro exited with code ${code}`);
    shutdown(code || 0);
  });
});

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
