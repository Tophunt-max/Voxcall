import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const OWNER = "ssunilkumarmohanta3-debug";
const REPO = "voxlink";
const BRANCH = "main";
const ROOT = "/home/runner/workspace";

const INCLUDE_ROOTS = [
  "artifacts/voxlink",
  "artifacts/api-server",
  "artifacts/admin-panel",
  "lib",
  "scripts",
];

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

const IGNORE_FILES = new Set([
  "pnpm-lock.yaml", ".DS_Store", "Thumbs.db",
]);

const MAX_FILE_SIZE = 490 * 1024; // 490KB — large assets handled by push-assets.mjs

const connectors = new ReplitConnectors();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function githubApi(path, options = {}, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await connectors.proxy("github", path, {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json();

    if (data?.error?.message?.includes("Rate limit")) {
      await sleep(1500);
      continue;
    }
    return data;
  }
  throw new Error("Max retries exceeded");
}

function shouldIgnore(name) {
  return IGNORE_FILES.has(name);
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
      if (shouldIgnore(entry)) continue;
      if (stat.size > MAX_FILE_SIZE) {
        console.log(`  Skip too large (${Math.round(stat.size/1024/1024)}MB): ${relative(base, fullPath)}`);
        continue;
      }
      files.push({ fullPath, relPath: relative(base, fullPath), size: stat.size });
    }
  }
  return files;
}

function collectFiles() {
  const files = [];

  for (const name of INCLUDE_ROOT_FILES) {
    const fullPath = join(ROOT, name);
    try {
      const stat = statSync(fullPath);
      if (stat.isFile()) files.push({ fullPath, relPath: name, size: stat.size });
    } catch { }
  }

  for (const dir of INCLUDE_ROOTS) {
    const fullPath = join(ROOT, dir);
    try {
      statSync(fullPath);
      files.push(...getAllFiles(fullPath, ROOT));
    } catch { }
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
  if (!data.sha) throw new Error(`Blob failed: ${JSON.stringify(data)}`);
  return data.sha;
}

async function main() {
  console.log(`\nPushing VoxLink to GitHub: ${OWNER}/${REPO}\n`);

  console.log("1. Checking repo state...");
  let baseSha = null;
  let baseTreeSha = null;

  try {
    const refData = await githubApi(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    if (refData?.object?.sha) {
      baseSha = refData.object.sha;
      const commitData = await githubApi(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
      baseTreeSha = commitData.tree.sha;
      console.log(`   Branch '${BRANCH}' exists. Latest: ${baseSha.substring(0, 7)}`);
    }
  } catch { console.log(`   Fresh push.`); }

  console.log("\n2. Collecting files...");
  const files = collectFiles();
  console.log(`   Found ${files.length} files`);

  // Sort: small files first, large assets last
  files.sort((a, b) => a.size - b.size);

  console.log("\n3. Uploading files (with retry on rate limit)...");
  const treeItems = [];
  const failed = [];
  const BATCH = 8; // larger batch, rely on retry for rate limit

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
        console.log(`   ❌ Failed: ${batch[idx].relPath} — ${r.reason?.message}`);
        failed.push(batch[idx]);
      }
    });

    if ((i + BATCH) % 60 === 0 || i + BATCH >= files.length) {
      console.log(`   Progress: ${Math.min(i + BATCH, files.length)}/${files.length} (${treeItems.length} uploaded)`);
    }
  }

  // Retry failed files one by one with longer delays
  if (failed.length > 0) {
    console.log(`\n   Retrying ${failed.length} failed files...`);
    for (const { fullPath, relPath } of failed) {
      await sleep(2000);
      try {
        const buffer = readFileSync(fullPath);
        const sha = isBinary(buffer)
          ? await createBlob(buffer.toString("base64"), "base64")
          : await createBlob(buffer.toString("utf8"), "utf-8");
        treeItems.push({ path: relPath, mode: "100644", type: "blob", sha });
        console.log(`   ✅ Retry OK: ${relPath}`);
      } catch (e) {
        console.log(`   ❌ Still failed: ${relPath}`);
      }
    }
  }

  console.log(`\n   Total uploaded: ${treeItems.length}/${files.length}`);

  console.log("\n4. Creating git tree...");
  const treeBody = { tree: treeItems };
  if (baseTreeSha) treeBody.base_tree = baseTreeSha;
  const treeData = await githubApi(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: treeBody,
  });
  if (!treeData.sha) throw new Error(`Tree failed: ${JSON.stringify(treeData)}`);
  console.log(`   Tree: ${treeData.sha.substring(0, 7)}`);

  console.log("\n5. Creating commit...");
  const commitData = await githubApi(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: {
      message: "chore: push all source files including assets",
      tree: treeData.sha,
      parents: baseSha ? [baseSha] : [],
    },
  });
  if (!commitData.sha) throw new Error(`Commit failed: ${JSON.stringify(commitData)}`);
  console.log(`   Commit: ${commitData.sha.substring(0, 7)}`);

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

  console.log(`\n✅ Done! https://github.com/${OWNER}/${REPO}`);
  console.log(`   Files: ${treeItems.length} pushed\n`);
}

main().catch(e => {
  console.error("\n❌ Push failed:", e.message);
  process.exit(1);
});
