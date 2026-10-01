/**
 * MONO — 通过 GitHub REST API 发布
 * 背景：本机到 github.com:443 不通（git push 会超时），但 api.github.com 可用，
 * 因此用 Git Data API 直接把当前工作树推成一个 commit，内容与 git push 完全等价。
 *
 *   node scripts/publish-github.mjs
 * 令牌从环境变量 GITHUB_TOKEN 读取（不要写进任何文件、不要提交）。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = process.env.MONO_OWNER || 'zhonglike';
const REPO = process.env.MONO_REPO || 'TML';
const BRANCH = process.env.MONO_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(1);
}

const API = 'https://api.github.com';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.vscode', '.idea']);
const SKIP_EXT = new Set(['.log', '.tmp', '.bak']);

async function api(path, opt = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opt,
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mono-publish-agent',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opt.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${opt.method || 'GET'} ${path} → ${res.status} ${json && json.message ? json.message : ''}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** 递归收集要提交的文件 */
async function collect(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    const rel = relative(ROOT, p).split('\\').join('/');
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await collect(p, out);
    } else {
      if (SKIP_EXT.has(extname(e.name))) continue;
      const s = await stat(p);
      if (s.size > 4 * 1024 * 1024) {
        console.warn(`  跳过超大文件 ${rel} (${(s.size / 1048576).toFixed(1)}MB)`);
        continue;
      }
      out.push({ rel, abs: p, size: s.size });
    }
  }
  return out;
}

function isBinary(rel, buf) {
  if (/\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|pdf|zip)$/i.test(rel)) return true;
  // 含 NUL 字节即视为二进制
  for (let i = 0; i < Math.min(buf.length, 8000); i++) if (buf[i] === 0) return true;
  return false;
}

async function main() {
  console.log(`发布 ${OWNER}/${REPO} → ${BRANCH}\n`);

  const me = await api('/user');
  console.log(`  身份 : ${me.login}`);

  const repo = await api(`/repos/${OWNER}/${REPO}`);
  console.log(`  仓库 : ${repo.full_name}（默认分支 ${repo.default_branch}）`);

  // 收集文件
  const files = await collect(ROOT);
  console.log(`  待发布文件: ${files.length} 个 · 合计 ${(files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(0)} KB`);

  const message = process.env.MONO_MESSAGE || [
    'feat: MONO 极简黑白抽奖经营模拟游戏（纯前端 / GitHub Pages / WebView 套壳）',
    '',
    '- 图鉴 535 种标的：CS2 饰品 224 / AI 算力 93 / 电脑配件 122 / 虚拟资产 98',
    '- 市场引擎：锚价 + 随机游走 + 趋势动量 + 均值回归 + 玩家冲击 + 29 种事件',
    '- 抽奖：单抽/十连/百连、软硬保底、Float 磨损与模板定价、成批掉落',
    '- 交易：一口价、回收商、限价挂单、拍卖行、熔炼材料',
    '- NPC：6 种人格做市、库存重组、挂单簿、拍卖竞价',
    '- 成长：等级 / 声望 / 任务链 / 每日任务 / 成就 / 签到',
    '- 界面：10 个页面、Canvas K 线与成交量、Liquid Glass 黑白灰设计系统、响应式三端',
    '- 存档：localStorage + IndexedDB 双层、3 存档位、导入导出、离线推进',
    '- 交付：GitHub Pages 工作流 + CNAME + PWA + Electron/Capacitor 套壳',
    '- 测试：引擎冒烟测试 + UI 无头渲染测试 + 发布前总检查（全部零依赖）',
  ].join('\n');

  // 判断仓库是否已有分支：空仓库无法创建 git object（409），
  // 需要用 Contents API 提交第一个文件把仓库「点活」（注意 content 必须是 base64）。
  let headSha = null;
  let baseTree = null;
  let rest = files;
  try {
    const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    headSha = ref.object.sha;
    baseTree = (await api(`/repos/${OWNER}/${REPO}/git/commits/${headSha}`)).tree.sha;
    console.log(`  现有 HEAD: ${headSha.slice(0, 8)}（增量发布）`);
  } catch (e) {
    console.log('  首次发布（空仓库）：用 Contents API 初始化');
    const [first, ...others] = files;
    const firstBuf = await readFile(first.abs);
    await api(`/repos/${OWNER}/${REPO}/contents/${first.rel}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: firstBuf.toString('base64'), branch: BRANCH }),
    });
    rest = others;
    const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    headSha = ref.object.sha;
    baseTree = (await api(`/repos/${OWNER}/${REPO}/git/commits/${headSha}`)).tree.sha;
    console.log(`  已初始化仓库：${first.rel} → ${headSha.slice(0, 8)}`);
  }

  // 其余文件：并发创建 blob → tree → commit → 移动引用（每批一次 commit）
  const BATCH = 40;
  for (let i = 0; i < rest.length; i += BATCH) {
    const slice = rest.slice(i, i + BATCH);
    const tree = await Promise.all(slice.map(async (f) => {
      const buf = await readFile(f.abs);
      const binary = isBinary(f.rel, buf);
      const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({
          content: binary ? buf.toString('base64') : buf.toString('utf8'),
          encoding: binary ? 'base64' : 'utf-8',
        }),
      });
      return { path: f.rel, mode: '100644', type: 'blob', sha: blob.sha };
    }));
    const newTree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ tree, base_tree: baseTree }),
    });
    const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `chore: publish files ${i + 1}~${i + slice.length}`,
        tree: newTree.sha,
        parents: [headSha],
      }),
    });
    await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
    headSha = commit.sha;
    baseTree = newTree.sha;
    console.log(`  已提交 ${Math.min(i + BATCH, rest.length)}/${rest.length} · ${commit.sha.slice(0, 8)}`);
  }

  console.log(`\n完成：https://github.com/${OWNER}/${REPO}/commits/${BRANCH} (HEAD ${headSha.slice(0, 8)})`);
}

main().catch((e) => {
  console.error(`\n发布失败：${e.message}`);
  if (e.body) console.error(JSON.stringify(e.body).slice(0, 600));
  process.exit(1);
});
