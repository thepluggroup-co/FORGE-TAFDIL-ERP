var fs = require('fs');
var path = require('path');

// Read ZIP and look for key files
var zipPath = 'C:/Users/yemgn/TAFDIL FORGE/FORGE-TAFDIL-ERP/release/FORGE-by-TAFDIL-1.0.0-win-x64.zip';
var buf = fs.readFileSync(zipPath);

// Find End of Central Directory record to count entries
var size = buf.length;
var eocd = -1;
for (var i = size - 22; i >= 0; i--) {
  if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
    eocd = i; break;
  }
}
if (eocd < 0) { console.log('Not a valid ZIP'); process.exit(1); }

var totalEntries = buf.readUInt16LE(eocd + 10);
var cdOffset = buf.readUInt32LE(eocd + 16);
console.log('Total entries:', totalEntries);

// Walk central directory
var pos = cdOffset;
var found = [];
for (var n = 0; n < totalEntries; n++) {
  if (buf.readUInt32LE(pos) !== 0x02014B50) break;
  var fnLen = buf.readUInt16LE(pos + 28);
  var extraLen = buf.readUInt16LE(pos + 30);
  var commentLen = buf.readUInt16LE(pos + 32);
  var name = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');
  if (name.includes('package.json') || name.includes('out/main') || name.includes('out\\main')) {
    found.push(name);
  }
  pos += 46 + fnLen + extraLen + commentLen;
}
console.log('Key files in ZIP:');
found.forEach(f => console.log(' ', f));
