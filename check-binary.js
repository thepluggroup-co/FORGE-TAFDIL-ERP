// Check better_sqlite3.node ABI - read the PE/ELF header or find NAPI version
var fs = require('fs');
var path = require('path');

// Find the .node file in pnpm store
var storeBase = 'C:/Users/yemgn/TAFDIL FORGE/FORGE-TAFDIL-ERP/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3';
function findNode(dir, depth) {
  if (depth > 5) return null;
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { return null; }
  for (var e of entries) {
    var full = path.join(dir, e.name);
    if (e.name.endsWith('.node')) return full;
    if (e.isDirectory()) { var r = findNode(full, depth+1); if (r) return r; }
  }
  return null;
}
var nodePath = findNode(storeBase, 0);
console.log('Native binary path:', nodePath);
if (nodePath) {
  var buf = fs.readFileSync(nodePath);
  // Check if it's a PE file (starts with MZ)
  var isMZ = buf[0] === 0x4D && buf[1] === 0x5A;
  console.log('Is PE (MZ):', isMZ);
  // Search for NODE_MODULE_VERSION string pattern
  var str = buf.toString('binary');
  var match = str.match(/NODE_MODULE_VERSION=(\d+)/);
  if (match) console.log('NODE_MODULE_VERSION:', match[1]);
  // Search for napi_version
  var napi = str.match(/napi_version.*?(\d+)/);
  // Check file size
  console.log('File size:', buf.length, 'bytes');
}
