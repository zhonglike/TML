/**
 * MONO — 线上部署体检
 * 直接请求自定义域名，逐项确认线上站点真的是可用的游戏（而不是 GitHub 兜底页）。
 *   node scripts/verify-live.mjs [domain]
 */
const DOMAIN = process.argv[2] || 'tml.zhonglike.tech';
const BASE = `http://${DOMAIN}`;
const tls = await import('node:tls');
const { readFileSync } = await import('node:fs');
const { dirname, resolve } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

async function get(url, opt = {}) {
  const t0 = Date.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'manual', ...opt });
  const buf = res.status >= 200 && res.status < 300 ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  return {
    status: res.status,
    text: buf.toString('utf8'),
    /** 字节数：不能用 text.length，中文在 JS 里长度 1、UTF-8 占 3 字节 */
    bytes: buf.length,
    ms: Date.now() - t0,
    headers: res.headers,
  };
}

/** 读本地同名文件（用于逐字节比对） */
function localSize(path) {
  try {
    return readFileSync(resolve(ROOT, '.' + path)).length;
  } catch (e) {
    return null;
  }
}

console.log(`\n== 线上体检 ${BASE} ==\n`);

const home = await get(BASE + '/');
ok(home.status === 200, '首页可访问', `HTTP ${home.status} · ${home.bytes}B · ${home.ms}ms`);
ok(/<title>MONO/.test(home.text), '标题正确');
ok(home.text.includes('src/main.js'), '入口脚本已引用');
ok(home.text.includes('src/styles/main.css'), '设计系统已引用');
ok(home.text.includes('manifest.webmanifest'), 'PWA manifest 已引用');
ok(home.text.includes('id="views"') && home.text.includes('id="tabbar"'), '应用挂载点存在');

const assets = [
  ['/src/main.js', 'createGoal', true],
  ['/src/ui/reel.js', 'export async function playReel', true],
  ['/src/ui/views/draw.js', 'playMultiReel', true],
  ['/src/core/engine.js', 'export function boot', true],
  ['/src/systems/loot.js', 'drawMany', true],
  ['/src/data/catalog-cs2.js', 'export const CS2', true],
  ['/src/data/catalog-compute.js', 'export const COMPUTE', true],
  ['/src/data/catalog-hardware.js', 'export const HARDWARE', true],
  ['/src/data/catalog-assets.js', 'export const ASSETS', true],
  ['/src/styles/main.css', '.reel__marker', true],
  ['/sw.js', 'mono-v', true],
  ['/manifest.webmanifest', 'MONO', true],
  ['/assets/icons/icon-192.png', '', true],
  ['/assets/icons/icon-512.png', '', true],
  ['/CNAME', 'zhonglike.tech', true],
  ['/data/prices.seed.json', 'prices-seed', true],
];
for (const [path, marker, compare] of assets) {
  try {
    const r = await get(BASE + path);
    const good = r.status === 200 && (!marker || r.text.includes(marker));
    const local = compare ? localSize(path) : null;
    const same = local == null ? '' : ` · 本地 ${local}B ${local === r.bytes ? '字节一致 ✓' : '不一致 ✗'}`;
    ok(good && (local == null || local === r.bytes), `资源 ${path}`, `${r.status} · ${r.bytes}B · ${r.ms}ms${same}`);
  } catch (e) {
    ok(false, `资源 ${path}`, e.message);
  }
}

// 数据完整性：线上图鉴条目数（生成的每行形如 `  ["id", ...],`，注意是双引号）
const ENTRY_RE = /^ {2}\["/gm;
for (const [path, name, expect] of [
  ['/src/data/catalog-cs2.js', 'CS2', 224],
  ['/src/data/catalog-compute.js', 'COMPUTE', 93],
  ['/src/data/catalog-hardware.js', 'HARDWARE', 122],
  ['/src/data/catalog-assets.js', 'ASSETS', 96],
]) {
  try {
    const r = await get(BASE + path);
    const count = (r.text.match(ENTRY_RE) || []).length;
    ok(count === expect, `线上 ${name} 条目数`, `${count} / ${expect}`);
  } catch (e) {
    ok(false, `线上 ${name} 条目数`, e.message);
  }
}

// CNAME 是否正确指向自有域名
try {
  const r = await get(BASE + '/CNAME');
  ok(r.text.trim() === 'TML.zhonglike.tech', 'CNAME 内容正确', r.text.trim());
} catch (e) {
  ok(false, 'CNAME', e.message);
}

// TLS 证书
console.log('\n== TLS 证书 ==');
await new Promise((resolve) => {
  const sock = tls.connect({ host: DOMAIN, port: 443, servername: DOMAIN, rejectUnauthorized: false, timeout: 15000 }, () => {
    const c = sock.getPeerCertificate();
    const san = c.subjectaltname || '';
    const covers = san.includes(DOMAIN);
    ok(sock.authorized, 'HTTPS 证书受信任', sock.authorized ? '' : String(sock.authorizationError));
    ok(covers, '证书覆盖自定义域名', covers ? '' : `当前为 ${c.subject && c.subject.CN}（GitHub 兜底证书，签发中）`);
    console.log(`        签发者 ${c.issuer && c.issuer.O} · 有效期至 ${c.valid_to}`);
    sock.end();
    resolve();
  });
  sock.on('error', (e) => {
    ok(false, 'HTTPS 握手', e.code || e.message);
    resolve();
  });
  sock.on('timeout', () => {
    ok(false, 'HTTPS 握手', '超时');
    sock.destroy();
    resolve();
  });
});

console.log(`\n${fails === 0 ? '线上体检全部通过。' : fails + ' 项未通过。'}\n`);
process.exit(fails ? 1 : 0);
