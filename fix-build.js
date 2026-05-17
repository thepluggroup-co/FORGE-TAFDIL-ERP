// Step 1: Copy winCodeSign-2.6.0 cache
var fs = require('fs');
var path = require('path');

var src = 'C:\\Users\\yemgn\\AppData\\Local\\electron-builder\\Cache\\winCodeSign\\040144227';
var dst = 'C:\\Users\\yemgn\\AppData\\Local\\electron-builder\\Cache\\winCodeSign\\winCodeSign-2.6.0';

function copyDir(from, to) {
  if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
  var entries = fs.readdirSync(from, { withFileTypes: true });
  for (var e of entries) {
    var s = path.join(from, e.name);
    var d = path.join(to, e.name);
    if (e.isDirectory()) {
      copyDir(s, d);
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
    }
    // skip symlinks (the macOS ones that caused problems)
  }
}

if (fs.existsSync(dst)) {
  console.log('winCodeSign-2.6.0 cache already exists, skipping copy');
} else {
  console.log('Copying winCodeSign to cache...');
  copyDir(src, dst);
  console.log('Done copying winCodeSign');
}

// Verify rcedit is there
var rcedit = path.join(dst, 'windows', 'rcedit-x64.exe');
console.log('rcedit exists:', fs.existsSync(rcedit));
