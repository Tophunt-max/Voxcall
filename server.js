/**
 * Combined production server — serves all three Replit apps:
 *   /              → VoxLink User App  (voxlink/static-build/)
 *   /host/*        → VoxLink Host App  (voxlink-host/static-build/)
 *   /admin-panel/* → Admin Panel       (admin-panel/dist/)
 *
 * The Expo web export hard-codes /_expo/ asset paths.  When the host app is
 * served under /host/, those absolute paths would resolve to the user-app's
 * _expo/ folder.  We fix this transparently:
 *   - Requests to /host/_expo/* are rewritten → voxlink-host/static-build/_expo/*
 *   - The host app's index.html is served with /_expo/ replaced by /host/_expo/
 *
 * Zero external dependencies — pure Node.js built-ins.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "5000", 10);

const USER_ROOT  = path.resolve(__dirname, "voxlink/static-build");
const HOST_ROOT  = path.resolve(__dirname, "voxlink-host/static-build");
const ADMIN_ROOT = path.resolve(__dirname, "admin-panel/dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".otf":  "font/otf",
  ".map":  "application/json",
  ".txt":  "text/plain",
  ".webp": "image/webp",
};

function sendFile(filePath, res, rewrite) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  let content = fs.readFileSync(filePath);
  if (rewrite && ext === ".html") {
    // Rewrite absolute /_expo/ asset paths → /host/_expo/ so the browser
    // fetches from the host-app's own asset tree, not the user-app's.
    content = Buffer.from(
      content.toString("utf8").replace(/\/_expo\//g, "/host/_expo/"),
    );
  }
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
  return true;
}

function serveApp(root, urlPath, res, rewrite = false) {
  const safe = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidate = path.join(root, safe);
  if (!candidate.startsWith(root)) { res.writeHead(403); res.end("Forbidden"); return; }

  if (sendFile(candidate, res, rewrite)) return;
  if (sendFile(candidate + ".html", res, rewrite)) return;

  // SPA fallback — serve index.html
  const index = path.join(root, "index.html");
  if (fs.existsSync(index)) {
    sendFile(index, res, rewrite);
  } else {
    res.writeHead(404); res.end("Not Found");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const pathname = url.pathname;

  // Health check
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  if (pathname.startsWith("/admin-panel")) {
    // Admin Panel
    const sub = pathname.slice("/admin-panel".length) || "/";
    serveApp(ADMIN_ROOT, sub, res);

  } else if (pathname.startsWith("/host/_expo/")) {
    // Host app's Expo asset bundle (rewritten from /_expo/ in index.html)
    const sub = pathname.slice("/host".length); // → /_expo/...
    serveApp(HOST_ROOT, sub, res);

  } else if (pathname.startsWith("/host")) {
    // Host App pages — serve index.html with path rewriting
    const sub = pathname.slice("/host".length) || "/";
    serveApp(HOST_ROOT, sub, res, true /* rewrite /_expo/ → /host/_expo/ */);

  } else {
    // User App (root)
    serveApp(USER_ROOT, pathname, res);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`VoxLink combined server running on port ${PORT}`);
  console.log(`  User App    → http://localhost:${PORT}/`);
  console.log(`  Host App    → http://localhost:${PORT}/host/`);
  console.log(`  Admin Panel → http://localhost:${PORT}/admin-panel/`);
});
