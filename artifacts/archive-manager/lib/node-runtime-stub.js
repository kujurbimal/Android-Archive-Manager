// 7z-wasm only uses these Node built-ins in its Node.js execution branch.
// Metro aliases them for native/web bundles, where the 7z engine uses WASM APIs.
module.exports = {};
