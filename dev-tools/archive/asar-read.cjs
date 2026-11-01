const fs = require('node:fs');
const asarPath = 'C:/Users/AA/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const base = 8; // 4 bytes size + 4 bytes headerSize prefix? electron asar: 4 size, 4 header size, then json
const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const dataStart = 8 + headerSize;
const hbuf = Buffer.alloc(headerSize); fs.readSync(fd, hbuf, 0, headerSize, 16);
const text = hbuf.toString('utf8'); const header = JSON.parse(text.slice(0, text.lastIndexOf('}') + 1));
function read(rel) {
  const parts = rel.split('/').filter(Boolean);
  let node = header;
  for (const part of parts) node = node.files[part];
  const b = Buffer.alloc(node.size);
  fs.readSync(fd, b, 0, node.size, dataStart + Number(node.offset));
  return b.toString('utf8');
}
const target = process.argv[2];
process.stdout.write(read(target));
