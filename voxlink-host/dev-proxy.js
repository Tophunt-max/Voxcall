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

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // Metro packager status - always return immediately (this is the health check)
  if (url === '/status' || url === BASE + '/status') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    });
    res.end('packager-status:running');
    return;
  }

  // Proxy everything else to Metro (or return loading page if Metro not ready)
  const target = stripBase(url);
  const opts = {
    hostname: '127.0.0.1',
    port: METRO_PORT,
    path: target,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${METRO_PORT}` },
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

// WebSocket proxying for Metro HMR
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

server.listen(PORT, '::', () => {
  console.log(`[proxy] VoxLink Host proxy on port ${PORT} -> Metro on ${METRO_PORT}`);
  console.log(`[proxy] /status returns packager-status:running immediately`);

  setTimeout(pollMetro, 1000);

  const metro = spawn(
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

  metro.on('exit', (code) => {
    console.log(`[proxy] Metro exited with code ${code}`);
    process.exit(code || 0);
  });
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
