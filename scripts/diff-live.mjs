/**
 * MONO — 线上与本地逐文件比对（SHA-256）
 * 比“体积对比”更硬：只要有一个字节不同就会报出来。
 *   node scripts/diff-live.mjs [domain]
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOMAIN = process.argv[2] || 'tml.zhonglike.tech';
const BASE = `http://${DOMAIN}`;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'desktop', 'mobile', '.github', 'scripts', 'tests']);
/** 不参与网页运行时的文件：Pages 对「点开头」的文件有保留规则，文档类也不需要部署 */
const SKIP_FILES = new Set([
  '.gitignore', '.gitattributes', '.nojekyll',
  'README.md', 'LICENSE', 'package.json', 'package-lock.json',
  'BUILD-INFO.txt',
]);

async function collect(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await collect(p, out);
    } else {
      out.push(relative(ROOT, p).split('\\').join('/'));
    }
  }
  return out;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

const files = (await collect(ROOT)).filter((f) => !f.startsWith('dist/') && !SKIP_FILES.has(f));
console.log(`\n比对 ${files.length} 个文件：本地工作树  vs  http://${DOMAIN}\n`);

let same = 0;
let diff = 0;
let err = 0;
for (const rel of files) {
  const localBuf = await readFile(join(ROOT, rel));
  const localHash = sha(localBuf);
  try {
    const res = await fetch(`${BASE}/${rel}?cb=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.log(`  HTTP ${res.status}  ${rel}`);
      err++;
      continue;
    }
    const remoteBuf = Buffer.from(await res.arrayBuffer());
    const remoteHash = sha(remoteBuf);
    if (remoteHash === localHash) {
      same++;
    } else {
      diff++;
      console.log(`  不一致  ${rel}`);
      console.log(`          本地 ${localBuf.length}B ${localHash}  /  线上 ${remoteBuf.length}B ${remoteHash}`);
    }
  } catch (e) {
    err++;
    console.log(`  请求失败  ${rel} — ${e.message}`);
  }
}

console.log(`\n一致 ${same} · 不一致 ${diff} · 失败 ${err}`);
console.log(diff === 0 && err === 0
  ? '\n线上内容与本地工作树逐字节一致。\n'
  : '\n存在差异，请看上面的清单。\n');
process.exit(diff || err ? 1 : 0);
