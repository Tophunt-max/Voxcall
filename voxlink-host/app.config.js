const base = require('./app.json');

const origin =
  process.env.EXPO_PUBLIC_SITE_URL ||
  'https://voxlink-host-mobile.pages.dev/';

base.expo.plugins = base.expo.plugins.map((plugin) => {
  if (Array.isArray(plugin) && plugin[0] === 'expo-router') {
    return [plugin[0], { ...plugin[1], origin }];
  }
  return plugin;
});

module.exports = base;
