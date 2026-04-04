const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Allow monorepo packages
config.watchFolders = [workspaceRoot];

// Exclude workerd, firebase tmp test dirs, Replit internal skill dirs, and sibling apps from Metro watcher
config.resolver.blockList = [
  /node_modules\/.pnpm\/workerd@.*/,
  /node_modules\/workerd\/.*/,
  /.*app_tmp_.*/,
  /.*_tmp_[0-9]+.*/,
  /.*\.local\/skills\/.*/,
  /.*\.local\/tasks\/.*/,
  /.*\/voxlink-host\/.*/,
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Persistent bundle cache to speed up restarts
const { FileStore } = require('metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join('/tmp', 'metro-bundle-cache', 'voxlink') }),
];

module.exports = config;
