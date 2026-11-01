const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const SHOT = path.join(ROOT, 'dev', 'shots');
fs.mkdirSync(SHOT, { recursive: true });
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = process.argv[2] || 'http://127.0.0.1:7911/sim.html';
const OUT = path.join(SHOT, (process.argv[3] || 'shot') + '.png');
const res = spawnSync(EDGE, [
  '--headless=new', '--no-first-run', '--disable-extensions', '--disable-features=CalculateNativeWinOcclusion',
  '--window-size=1400,900', '--hide-scrollbars', '--virtual-time-budget=12000',
  '--user-data-dir=' + path.join(ROOT, 'dev', 'edge-profile'),
  '--screenshot=' + OUT, URL,
], { encoding: 'utf8', timeout: 120000 });
console.log('status', res.status, 'stderr:', (res.stderr || '').slice(-800));
console.log('exists', fs.existsSync(OUT), fs.existsSync(OUT) ? fs.statSync(OUT).size : 0);
