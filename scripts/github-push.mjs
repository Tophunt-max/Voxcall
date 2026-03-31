import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const OWNER = "ssunilkumarmohanta3-debug";
const REPO = "voxlink";
const BRANCH = "main";
const ROOT = "/home/runner/workspace";

// Only push these directories/files (source code only)
const INCLUDE_ROOTS = [
  "artifacts/voxlink",
  "artifacts/api-server",
  "artifacts/admin-panel",
  "lib",
  "scripts",
];

// Root-level files to include
const INCLUDE_ROOT_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "replit.md",
  ".gitignore",
];

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".expo", "dist", ".cache", "__pycache__",
  ".turbo", "build", ".next", ".vercel", "coverage", "tmp", "android", "ios",
  ".gradle", ".kotlin",
]);

const IGNORE_EXTENSIONS = new Set([
  ".tar.gz", ".zip", ".lock", ".db", ".db-wal", ".db-shm",
]);

const IGNORE_FILES = new Set([
  "pnpm-lock.yaml", ".DS_Store", "Thumbs.db",
]);

const MAX_FILE_SIZE = 500 * 1024; // 500KB

const connectors = new ReplitConnectors();

async function githubApi(path, options = {}) {
  const res = await connectors.proxy("github", path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  return data;
}

function shouldIgnoreFile(name, size) {
  if (IGNORE_FILES.has(name)) return true;
  if (size > MAX_FILE_SIZE) return false; // handled separately
  const ext = name.slice(name.lastIndexOf("."));
  if (IGNORE_EXTENSIONS.has(ext)) return true;
  return false;
}

function getAllFiles(dir, base = ROOT) {
  const files = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }

    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, base));
    } else {
      if (shouldIgnoreFile(entry, stat.size)) continue;
      if (stat.size > MAX_FILE_SIZE) {
        console.log(`  Skip large (${Math.round(stat.size/1024)}KB): ${relative(base, fullPath)}`);
        continue;
      }
      files.push({ fullPath, relPath: relative(base, fullPath) });
    }
  }
  return files;
}

function collectFiles() {
  const files = [];

  // Root-level files
  for (const name of INCLUDE_ROOT_FILES) {
    const fullPath = join(ROOT, name);
    try {
      const stat = statSync(fullPath);
      if (stat.isFile()) files.push({ fullPath, relPath: name });
    } catch { /* skip */ }
  }

  // Directories
  for (const dir of INCLUDE_ROOTS) {
    const fullPath = join(ROOT, dir);
    try {
      statSync(fullPath);
      files.push(...getAllFiles(fullPath, ROOT));
    } catch { /* skip */ }
  }

  return files;
}

function isBinary(buffer) {
  const slice = buffer.slice(0, 8000);
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) return true;
  }
  return false;
}

async function createBlob(content, encoding) {
  const data = await githubApi(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: "POST",
    body: { content, encoding },
  });
  if (!data.sha) throw new Error(`Blob creation failed: ${JSON.stringify(data)}`);
  return data.sha;
}

async function main() {
  console.log(`\nPushing VoxLink to GitHub: ${OWNER}/${REPO}\n`);

  // Get branch state
  console.log("1. Checking repo state...");
  let baseSha = null;
  let baseTreeSha = null;

  try {
    const refData = await githubApi(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    if (refData?.object?.sha) {
      baseSha = refData.object.sha;
      const commitData = await githubApi(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
      baseTreeSha = commitData.tree.sha;
      console.log(`   Branch '${BRANCH}' exists. Latest: ${baseSha.substring(0,7)}`);
    }
  } catch { console.log(`   Fresh push to '${BRANCH}'`); }

  // Collect files
  console.log("\n2. Collecting source files...");
  const files = collectFiles();
  console.log(`   Found ${files.length} source files`);

  // Create blobs in parallel batches of 5
  console.log("\n3. Uploading files to GitHub...");
  const treeItems = [];
  const BATCH = 5;

  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async ({ fullPath, relPath }) => {
        const buffer = readFileSync(fullPath);
        const sha = isBinary(buffer)
          ? await createBlob(buffer.toString("base64"), "base64")
          : await createBlob(buffer.toString("utf8"), "utf-8");
        return { path: relPath, mode: "100644", type: "blob", sha };
      })
    );
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        treeItems.push(r.value);
      } else {
        console.log(`   Error: ${batch[idx].relPath}: ${r.reason?.message}`);
      }
    });

    if ((i + BATCH) % 50 === 0 || i + BATCH >= files.length) {
      console.log(`   Progress: ${Math.min(i + BATCH, files.length)}/${files.length}`);
    }
  }

  console.log(`\n   Successfully uploaded ${treeItems.length} files`);

  // Create tree
  console.log("\n4. Creating git tree...");
  const treeBody = { tree: treeItems };
  if (baseTreeSha) treeBody.base_tree = baseTreeSha;
  const treeData = await githubApi(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: treeBody,
  });
  if (!treeData.sha) throw new Error(`Tree creation failed: ${JSON.stringify(treeData)}`);
  console.log(`   Tree: ${treeData.sha.substring(0, 7)}`);

  // Create commit
  console.log("\n5. Creating commit...");
  const commitBody = {
    message: "🚀 VoxLink: Production-grade social audio/video calling app\n\nStack:\n- Mobile: React Native Expo 54 + expo-router\n- Backend: Cloudflare Workers + D1 + R2 + Durable Objects\n- Admin: React + Vite + Tailwind\n\nFeatures:\n- Multi-role auth (user/host) with host KYC\n- Real-time audio/video calling with coin deduction\n- Admin panel with KYC verification\n- Coin wallet system",
    tree: treeData.sha,
    parents: baseSha ? [baseSha] : [],
  };
  const commitData = await githubApi(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: commitBody,
  });
  if (!commitData.sha) throw new Error(`Commit failed: ${JSON.stringify(commitData)}`);
  console.log(`   Commit: ${commitData.sha.substring(0, 7)}`);

  // Update/create branch ref
  console.log("\n6. Updating branch...");
  if (baseSha) {
    await githubApi(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      method: "PATCH",
      body: { sha: commitData.sha, force: true },
    });
  } else {
    await githubApi(`/repos/${OWNER}/${REPO}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${BRANCH}`, sha: commitData.sha },
    });
  }

  console.log(`\n✅ Done! View at: https://github.com/${OWNER}/${REPO}`);
  console.log(`   Files pushed: ${treeItems.length}\n`);
}

main().catch(e => {
  console.error("\n❌ Push failed:", e.message);
  process.exit(1);
});
