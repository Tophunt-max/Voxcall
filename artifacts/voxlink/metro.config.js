const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Allow monorepo packages
config.watchFolders = [workspaceRoot];

// Exclude workerd, firebase tmp test dirs, and Replit internal skill dirs from Metro watcher
config.resolver.blockList = [
  /node_modules\/.pnpm\/workerd@.*/,
  /node_modules\/workerd\/.*/,
  /.*app_tmp_.*/,
  /.*_tmp_[0-9]+.*/,
  /.*\.local\/skills\/.*/,
  /.*\.local\/tasks\/.*/,
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
