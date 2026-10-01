/**
 * MONO — 价格种子生成
 * 输出 data/prices.seed.json：把图鉴里的锚价与波动率抽成一份「可被 GitHub Actions 定时更新」的
 * 真实价锚文件。游戏在启动时会尝试加载它（离线或 404 时自动退回内置锚价）。
 *   node scripts/gen-seed.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS } from '../src/core/catalog.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const byId = {};
for (const def of ITEMS) {
  byId[def.id] = {
    base: def.base,
    vol: Number(def.volWeek.toFixed(4)),
    min: Number(def.min.toFixed(4)),
    max: Number(def.max.toFixed(4)),
    r: def.rarity,
    c: def.category,
  };
}

const payload = {
  $schema: 'mono/prices-seed@1',
  generatedAt: new Date().toISOString(),
  currency: 'CNY',
  note: '价格锚点来自公开市场行情的人工整理；CI 定时任务可覆盖本文件的 base 字段来刷新锚价。',
  count: ITEMS.length,
  items: byId,
};

mkdirSync(resolve(ROOT, 'data'), { recursive: true });
const out = resolve(ROOT, 'data/prices.seed.json');
writeFileSync(out, JSON.stringify(payload, null, 1), 'utf8');
console.log(`wrote ${out} · ${ITEMS.length} items · ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`);
