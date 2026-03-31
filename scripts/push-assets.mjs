import { ReplitConnectors } from "@replit/connectors-sdk";
import { readFileSync } from "fs";

const OWNER = "ssunilkumarmohanta3-debug";
const REPO = "voxlink";
const BRANCH = "main";

// Only the large files that were skipped before
const LARGE_ASSETS = [
  "artifacts/voxlink/assets/audio/ringtone_1.mp3",
  "artifacts/voxlink/assets/icons/ic_amount.png",
  "artifacts/voxlink/assets/images/app_logo.png",
  "artifacts/voxlink/assets/images/call_end_bg.png",
  "artifacts/voxlink/assets/images/chat_bg.png",
  "artifacts/voxlink/assets/images/home_call_person.png",
  "artifacts/voxlink/assets/images/icon.png",
  "artifacts/voxlink/assets/images/onBoarding1.png",
  "artifacts/voxlink/assets/images/onBoarding2.png",
  "artifacts/voxlink/assets/images/onBoarding3.png",
  "artifacts/voxlink/assets/images/onboard_1.png",
  "artifacts/voxlink/assets/images/onboard_2.png",
  "artifacts/voxlink/assets/images/onboard_3.png",
  "artifacts/voxlink/assets/images/payment_methods.png",
  "artifacts/voxlink/assets/images/match_bg.png",
  "artifacts/voxlink/assets/images/match_found_bg.png",
  "artifacts/voxlink/assets/images/random_bg.png",
  "artifacts/voxlink/assets/images/random_match_bg.png",
];

const ROOT = "/home/runner/workspace";
const connectors = new ReplitConnectors();

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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
      await sleep((attempt + 1) * 3000);
      continue;
    }
    return data;
  }
  throw new Error("Max retries exceeded");
}

async function main() {
  console.log(`\nPushing large asset files to GitHub...\n`);

  // Get current branch state
  const refData = await githubApi(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const baseSha = refData.object.sha;
  const commitData = await githubApi(`/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
  const baseTreeSha = commitData.tree.sha;
  console.log(`Current HEAD: ${baseSha.substring(0, 7)}\n`);

  const treeItems = [];

  for (let i = 0; i < LARGE_ASSETS.length; i++) {
    const relPath = LARGE_ASSETS[i];
    const fullPath = `${ROOT}/${relPath}`;
    const sizeMB = (readFileSync(fullPath).length / 1024 / 1024).toFixed(1);
    process.stdout.write(`[${i + 1}/${LARGE_ASSETS.length}] ${relPath} (${sizeMB}MB)... `);

    try {
      const buffer = readFileSync(fullPath);
      const blobData = await githubApi(`/repos/${OWNER}/${REPO}/git/blobs`, {
        method: "POST",
        body: { content: buffer.toString("base64"), encoding: "base64" },
      });
      if (!blobData.sha) throw new Error(JSON.stringify(blobData));
      treeItems.push({ path: relPath, mode: "100644", type: "blob", sha: blobData.sha });
      console.log(`✅ ${blobData.sha.substring(0, 7)}`);
    } catch (e) {
      console.log(`❌ ${e.message?.substring(0, 60)}`);
    }

    // Wait between files to avoid rate limit
    if (i < LARGE_ASSETS.length - 1) await sleep(2000);
  }

  if (treeItems.length === 0) {
    console.log("\nNo files uploaded. Exiting.");
    return;
  }

  console.log(`\n${treeItems.length}/${LARGE_ASSETS.length} assets uploaded. Creating commit...`);

  // Create tree with base
  const treeData = await githubApi(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: { base_tree: baseTreeSha, tree: treeItems },
  });
  console.log(`Tree: ${treeData.sha.substring(0, 7)}`);

  // Create commit
  const newCommit = await githubApi(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: {
      message: `assets: add large image and audio assets (${treeItems.length} files)`,
      tree: treeData.sha,
      parents: [baseSha],
    },
  });
  console.log(`Commit: ${newCommit.sha.substring(0, 7)}`);

  // Update branch
  await githubApi(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: { sha: newCommit.sha, force: true },
  });

  console.log(`\n✅ Assets pushed! https://github.com/${OWNER}/${REPO}\n`);
}

main().catch(e => {
  console.error("❌ Failed:", e.message);
  process.exit(1);
});
