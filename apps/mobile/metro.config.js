// The shared packages (@ilmora/*) live outside this folder and ship TypeScript source, so Metro must watch and resolve them.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.join(root, 'packages')];
config.resolver.unstable_enableSymlinks = true;
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
module.exports = config;
