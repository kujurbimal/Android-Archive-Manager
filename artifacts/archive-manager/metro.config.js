const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...config.resolver.assetExts, 'wasm'];
const nodeRuntimeStub = path.join(__dirname, 'lib', 'node-runtime-stub.js');
const nodeOnlyModules = new Set(['crypto', 'fs']);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSevenZipModule = /[/\\]node_modules[/\\]7z-wasm[/\\]/.test(context.originModulePath);
  if (isSevenZipModule && nodeOnlyModules.has(moduleName)) {
    return { type: 'sourceFile', filePath: nodeRuntimeStub };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
