/**
 * 启动前检查端口：被占用时给一行人话，而不是抛一串 EADDRINUSE 栈。
 * 由 npm 的 predev / prestart 钩子调用；端口空闲时静默通过。
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readPort() {
  if (process.env.PORT) return Number(process.env.PORT);
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = /^\s*PORT\s*=\s*(\d+)\s*$/m.exec(text);
    if (m) return Number(m[1]);
  } catch { /* 没有 .env 就用默认值 */ }
  return 8787;
}

const port = readPort();

function probe() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', (err) => resolve(err.code));
    srv.once('listening', () => srv.close(() => resolve(null)));
    srv.listen(port, '::');
  });
}

function whoIsHolding() {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const hit = out
        .split(/\r?\n/)
        .find((l) => /LISTENING/i.test(l) && new RegExp(`:${port}\\s`).test(l));
      if (!hit) return null;
      const pid = hit.trim().split(/\s+/).pop();
      let name = '未知进程';
      try {
        const csv = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        const m = /^"([^"]+)"/.exec(csv.trim());
        if (m) name = m[1];
      } catch { /* 保持未知 */ }
      return { pid, name };
    }
    const pid = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('\n')[0];
    if (!pid) return null;
    let name = '未知进程';
    try {
      name = execSync(`ps -p ${pid} -o comm=`, {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || name;
    } catch { /* 保持未知 */ }
    return { pid, name };
  } catch {
    return null;
  }
}

const err = await probe();

if (!err) process.exit(0);

if (err !== 'EADDRINUSE') {
  console.error(`\n[x] 端口 ${port} 无法监听：${err}\n`);
  process.exit(1);
}

const holder = whoIsHolding();
const win = process.platform === 'win32';

console.error('');
console.error(`[x] 端口 ${port} 已被占用${holder ? `（PID ${holder.pid} · ${holder.name}）` : ''}。`);
console.error('    多半是上一次 npm run dev / npm start 没有停干净，数据没有任何影响。');
console.error('');
console.error('    结束它：');
if (holder) {
  console.error(win
    ? `      Stop-Process -Id ${holder.pid} -Force`
    : `      kill -9 ${holder.pid}`);
}
console.error(win
  ? `    或者自己查一眼： netstat -ano | findstr :${port}`
  : `    或者自己查一眼： lsof -i tcp:${port}`);
console.error(win
  ? `    另一个办法：换端口启动，$env:PORT=8788; npm run dev`
  : `    另一个办法：换端口启动，PORT=8788 npm run dev`);
console.error('');

process.exit(1);
