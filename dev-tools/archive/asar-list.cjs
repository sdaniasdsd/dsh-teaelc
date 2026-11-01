const fs = require('node:fs');
const p = 'C:/Users/AA/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const fd = fs.openSync(p, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const hbuf = Buffer.alloc(headerSize);
fs.readSync(fd, hbuf, 0, headerSize, 16);
const text = hbuf.toString('utf8');
let jsonText = text.slice(0, text.lastIndexOf('}') + 1);
const header = JSON.parse(jsonText);
function walk(node, prefix, out) {
  if (node.files) for (const [k, v] of Object.entries(node.files)) walk(v, prefix + '/' + k, out);
  else out.push(prefix);
}
const out = [];
walk(header, '', out);
console.log('TOTAL', out.length);
const hits = out.filter(f => /web-server|webserver|webServer/i.test(f));
console.log(hits.slice(0, 40).join('\n'));
