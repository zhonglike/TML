/**
 * MONO — 通过 GitHub API 增量上传指定文件
 * 用途：本机到 github.com:443 不通（git push 超时/被重置）时，
 * 用 Git Data API 把「当前工作树里若干文件」提交上去，产物与 git push 等价。
 *
 *   $env:GITHUB_TOKEN='...'
 *   node scripts/push-api.mjs                 # 上传与远端 main 有差异的文件
 *   node scripts/push-api.mjs a.js b.js       # 只上传指定文件
 *
 * 令牌只从环境变量读取，绝不写入任何文件。
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = process.env.MONO_OWNER || 'zhonglike';
const REPO = process.env.MONO_REPO || 'TML';
const BRANCH = process.env.MONO_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN;
const API = 'https://api.github.com';

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(1);
}

async function api(path, opt = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opt,
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mono-push-agent',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opt.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${opt.method || 'GET'} ${path} → ${res.status} ${json && json.message ? json.message : ''}`);
    err.body = json;
    throw err;
  }
  return json;
}

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/**
 * 计算「本地工作树 vs 远端树」的差异文件。
 * 不依赖本地 git 历史 —— 因为 API 上传产生的 commit 本地并不存在，
 * `git diff <remoteSha> HEAD` 会直接报 bad object。
 * 做法：取远端每个文件的 blob sha，再用 git hash-object 算本地文件的 blob sha 比对。
 */
async function diffAgainstRemote(remoteTreeSha) {
  const tree = await api(`/repos/${OWNER}/${REPO}/git/trees/${remoteTreeSha}?recursive=1`);
  const remote = new Map();
  for (const e of tree.tree || []) {
    if (e.type === 'blob') remote.set(e.path, e.sha);
  }

  // 本地工作树（跳过不需要发布的目录）
  const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.vscode', '.idea']);
  const files = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(join(dir, e.name));
      } else {
        files.push(relative(ROOT, join(dir, e.name)).split('\\').join('/'));
      }
    }
  }
  await walk(ROOT);

  const changed = [];
  for (const rel of files) {
    const abs = join(ROOT, rel);
    let sha;
    try {
      sha = git(['hash-object', abs]);
    } catch (e) {
      continue;
    }
    if (remote.get(rel) !== sha) changed.push(rel);
  }
  // 远端有、本地没有的文件一律不动（例如仅存在于仓库的配置）
  return changed.sort();
}

async function main() {
  const head = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const remoteSha = head.object.sha;
  const remoteCommit = await api(`/repos/${OWNER}/${REPO}/git/commits/${remoteSha}`);
  const baseTree = remoteCommit.tree.sha;
  console.log(`远端 ${BRANCH} = ${remoteSha.slice(0, 7)}（${remoteCommit.message.split('\n')[0]}）`);

  // 待上传文件：显式参数，或自动按 blob sha 与远端树比对
  let files = process.argv.slice(2);
  if (!files.length) {
    try {
      files = await diffAgainstRemote(baseTree);
    } catch (e) {
      console.error('无法计算差异：' + e.message);
      process.exit(1);
    }
  }
  if (!files.length) {
    console.log('没有需要上传的文件（远端已是最新）');
    return;
  }
  console.log(`待上传 ${files.length} 个文件：\n  ` + files.join('\n  ') + '\n');

  const tree = [];
  for (const rel of files) {
    const abs = join(ROOT, rel);
    let buf;
    try {
      buf = await readFile(abs);
    } catch (e) {
      // 文件被删除 → 从树里移除
      tree.push({ path: rel, mode: '100644', type: 'blob', sha: null });
      console.log(`  - 删除 ${rel}`);
      continue;
    }
    const binary = /\.(png|jpg|jpeg|gif|ico|webp|woff2?|ttf|zip|pdf)$/i.test(rel)
      || buf.includes(0);
    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: binary ? buf.toString('base64') : buf.toString('utf8'),
        encoding: binary ? 'base64' : 'utf-8',
      }),
    });
    tree.push({ path: rel, mode: '100644', type: 'blob', sha: blob.sha });
    console.log(`  + ${rel} (${buf.length}B)`);
  }

  const newTree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree, base_tree: baseTree }),
  });

  // 提交信息取本地 HEAD 的完整信息，保持与 git 提交一致
  let message = process.env.MONO_MESSAGE || '';
  if (!message) {
    try {
      message = git(['log', '-1', '--pretty=%B']);
    } catch (e) {
      message = 'chore: sync via API';
    }
  }

  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [remoteSha] }),
  });

  await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  console.log(`\n已提交：${commit.sha}`);
  console.log(`https://github.com/${OWNER}/${REPO}/commit/${commit.sha}`);
}

main().catch((e) => {
  console.error(`\n上传失败：${e.message}`);
  if (e.body) console.error(JSON.stringify(e.body).slice(0, 500));
  process.exit(1);
});
