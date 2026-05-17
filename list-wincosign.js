var fs = require('fs');
var path = require('path');

function listDir(dir, depth) {
  if (depth > 3) return;
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { return; }
  for (var e of entries) {
    var full = path.join(dir, e.name);
    if (e.isDirectory()) {
      console.log(' '.repeat(depth*2) + '[D] ' + e.name);
      listDir(full, depth + 1);
    } else {
      console.log(' '.repeat(depth*2) + e.name);
    }
  }
}

var base = 'C:/Users/yemgn/AppData/Local/electron-builder/Cache/winCodeSign';
console.log('Cache dir exists:', fs.existsSync(base));
try {
  var dirs = fs.readdirSync(base);
  console.log('Subdirs:', dirs.join(', '));
  // Check specifically for winCodeSign-2.6.0
  var target = base + '/winCodeSign-2.6.0';
  console.log('winCodeSign-2.6.0 exists:', fs.existsSync(target));
  // Look for rcedit anywhere
  function findRcedit(dir, depth) {
    if (depth > 4) return;
    var entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { return; }
    for (var e of entries) {
      var full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes('rcedit')) console.log('FOUND rcedit:', full);
      if (e.isDirectory()) findRcedit(full, depth + 1);
    }
  }
  findRcedit(base, 0);
} catch(e) { console.log('Error:', e.message); }
