const http = require('http');
const net = require('net');

const ADMIN_PORT = 5000;
const USER_APP_PORT = 8080;
const HOST_APP_PORT = 8099;
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '3000');

function getTargetPort(url) {
  const path = url || '/';
  if (path.startsWith('/admin-panel')) return ADMIN_PORT;
  if (path.startsWith('/host')) return HOST_APP_PORT;
  return USER_APP_PORT;
}

const server = http.createServer((req, res) => {
  const targetPort = getTargetPort(req.url);

  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${targetPort}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.writeHead(502);
    res.end('Service unavailable');
  });

  req.pipe(proxyReq);
});

server.on('upgrade', (req, socket, head) => {
  const targetPort = getTargetPort(req.url);
  const target = net.createConnection({ port: targetPort, host: '127.0.0.1' });

  target.on('connect', () => {
    const reqLine = `${req.method} ${req.url} HTTP/1.1\r\n`;
    const headers = Object.entries({ ...req.headers, host: `localhost:${targetPort}` })
      .map(([k, v]) => `${k}: ${v}`).join('\r\n');
    target.write(`${reqLine}${headers}\r\n\r\n`);
    if (head && head.length) target.write(head);
    target.pipe(socket);
    socket.pipe(target);
  });

  target.on('error', () => socket.destroy());
  socket.on('error', () => target.destroy());
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`VoxLink Proxy running on port ${PROXY_PORT}`);
  console.log(`  /admin-panel/* -> localhost:${ADMIN_PORT} (Admin Panel)`);
  console.log(`  /*             -> localhost:${USER_APP_PORT} (User App)`);
  console.log(`  Host App at    -> localhost:${HOST_APP_PORT} (separate preview)`);
});
