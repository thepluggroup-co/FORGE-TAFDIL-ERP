var fs = require('fs');
var asarPath = 'C:/Users/yemgn/TAFDIL FORGE/FORGE-TAFDIL-ERP/apps/desktop/dist/win-unpacked/resources/app.asar';
try {
  var buf = fs.readFileSync(asarPath);
  var headerSize = buf.readUInt32LE(12);
  var header = JSON.parse(buf.slice(16, 16 + headerSize));
  var files = header.files;
  process.stdout.write('Top level: ' + JSON.stringify(Object.keys(files)) + '\n');
  if (files.node_modules) {
    process.stdout.write('node_modules: ' + JSON.stringify(Object.keys(files.node_modules.files || {})).slice(0,200) + '\n');
  } else {
    process.stdout.write('NO node_modules in asar\n');
  }
} catch(e) {
  process.stdout.write('ERROR: ' + e.message + '\n');
}
