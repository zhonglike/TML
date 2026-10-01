/**
 * MONO — 设置
 * 音效 / 触感 / 亮度 / 动效 / 交易确认 / 存档管理（多档、导入导出）/ 关于与公式说明。
 */
import {
  h, mount, icon, fmtPrice, sectionTitle, toast, confirmDialog, modal, segmented, emptyState,
} from '../ui.js';
import { S, newPlayer } from '../../core/state.js';
import { APP, TIME, ECON } from '../../core/const.js';
import * as save from '../../core/save.js';
import { setSound, sfx } from '../sound.js';
import { thousands, dateTimeStr, durStr } from '../../core/util.js';
import { ITEMS } from '../../core/catalog.js';

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'settings' } });
  let body = null;

  function applySettings() {
    document.documentElement.setAttribute('data-lum', S.settings.lum || 'default');
    document.documentElement.setAttribute('data-motion', S.settings.motion || 'on');
    setSound(S.settings.sound !== false);
    ctx.saveSettings();
  }

  function render() {
    mount(el, h('div.content', null,
      h('div.view__head', null,
        h('div', null,
          h('div.view__title', { text: '设置' }),
          h('div.view__sub', { text: `MONO ${APP.version} · 存档格式 v${APP.saveSchema} · 种子 ${S.__seed || '—'}` })),
        h('div.row', null,
          h('button.btn.btn--sm', { onclick: () => save.save(S.meta.slot).then(() => toast('已保存', { kind: 'good' })) }, icon('save', 14), '立即保存'))),
      (body = h('div', { id: 'settings-body' }))));
    paint();
  }

  function paint() {
    mount(body,
      h('div.grid.grid--2', null,
        // 表现
        h('div.card.card--pad', null,
          sectionTitle('表现'),
          row('音效', '极简合成音：交易、揭晓、成交', toggle(S.settings.sound !== false, (v) => {
            S.settings.sound = v;
            setSound(v);
            if (v) sfx('ding');
            applySettings();
          })),
          row('触感反馈', '移动端 / WebView 支持时震动（light）', toggle(S.settings.haptics !== false, (v) => {
            S.settings.haptics = v;
            applySettings();
          })),
          row('数字滚动动画', '资产与价格变化时做插值动画', toggle(S.settings.numbersRoll !== false, (v) => {
            S.settings.numbersRoll = v;
            applySettings();
          })),
          row('动效', '关闭后所有过渡立即生效', toggle(S.settings.motion !== 'off', (v) => {
            S.settings.motion = v ? 'on' : 'off';
            applySettings();
          })),
          row('亮度', '只调整明度，不改变配色', segmented([
            { id: 'dim', label: '暗' }, { id: 'default', label: '标准' }, { id: 'bright', label: '亮' },
          ], S.settings.lum || 'default', (id) => {
            S.settings.lum = id;
            applySettings();
          }))),
        // 经营
        h('div.card.card--pad', null,
          sectionTitle('经营偏好'),
          row('交易二次确认', '卖出与批量操作前弹窗确认', toggle(S.settings.confirmTrade !== false, (v) => {
            S.settings.confirmTrade = v;
            applySettings();
          })),
          row('时间倍速', `${TIME.speeds[S.clock.speed] ? TIME.speeds[S.clock.speed].label : '1×'} · ${TIME.speeds[S.clock.speed] ? TIME.speeds[S.clock.speed].cn : ''}`, segmented(
            TIME.speeds.map((s) => ({ id: String(s.id), label: s.label })),
            String(S.clock.speed),
            (id) => {
              ctx.setSpeed(Number(id));
              paint();
            },
          )),
          row('一 tick 时长', `${TIME.hoursPerTick} 游戏小时 · 挂单 ${TIME.listingHours}h · 拍卖 ${TIME.auctionHours}h`, h('span.hint', { text: '固定' })),
          row('离线推进上限', `${TIME.offlineCapDays} 游戏天（超出部分不再计算）`, h('span.hint', { text: '防时间穿越' }))),
        // 存档
        h('div.card.card--pad', null,
          sectionTitle('存档'),
          h('div.stack--tight.stack', { style: { marginTop: '8px' } }, ...slotRows()),
          h('div.btn-group', { style: { marginTop: '10px' } },
            h('button.btn.btn--sm', { onclick: () => save.downloadSave() }, icon('download', 14), '导出 JSON'),
            h('button.btn.btn--sm', { onclick: importDialog }, icon('upload', 14), '导入 JSON')),
          h('div.hint', { style: { marginTop: '8px' }, text: '存档同时写入 localStorage（快路径）与 IndexedDB（完整快照）；每 30 秒与跨日自动保存。' })),
        // 关于
        h('div.card.card--pad', null,
          sectionTitle('关于'),
          h('div.stack--tight.stack', { style: { marginTop: '8px' } },
            kv('工程', '纯前端单机 · 无后端 · 无账号'),
            kv('图鉴', ITEMS.length + ' 种标的'),
            kv('价格', '锚价 + 随机游走 + 均值回归 + 玩家冲击 + 事件'),
            kv('存档位', '3 个 + 导入导出'),
            kv('部署', 'GitHub Pages / WebView 套壳'),
            kv('数据', '全部本地计算，不上传任何信息')),
          h('div.divider'),
          h('div.hint', { text: '抽奖期望回收低于成本，市场是唯一的长期盈利来源：低买高卖、等待事件、控制仓位。' })),
        h('div.card.card--pad', null,
          sectionTitle('本地最佳记录'),
          bestList())),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.card.card--pad', null,
        sectionTitle('公式速查'),
        h('div.kv-grid', { style: { marginTop: '8px' } },
          kv('单抽价格', '¥' + fmtPrice(ECON.drawPrice)),
          kv('十连 / 百连', (ECON.multi10 * 10) + ' 折 / ' + (ECON.multi100 * 10) + ' 折'),
          kv('软保底', ECON.pitySoft + ' 抽未出金后加成'),
          kv('硬保底', ECON.pityHard + ' 抽必出金/红'),
          kv('回收折价', ((1 - ECON.recycleBase) * 100).toFixed(0) + '% 起（随等级与声望收窄）'),
          kv('成交手续费', (ECON.feeBase * 100).toFixed(1) + '% 起（每级 -0.25%）'),
          kv('拍卖佣金', (ECON.auctionFee * 100).toFixed(0) + '%'),
          kv('挂单费', (ECON.listFee * 100).toFixed(1) + '%'),
          kv('背包基础格', ECON.bagBase + ' 格（每级 +' + ECON.bagPerLevel + '）'),
          kv('挂单上限', ECON.listingsBase + ' 起（每 5 级 +1）'),
          kv('价格走廊', '锚价 ×0.18 ~ ×5.5'),
          kv('每日交易上限', ECON.dailyTradeCap + ' 笔'))),
      h('div.spacer', { style: { height: '14px' } }),
      h('div.card.card--pad', null,
        sectionTitle('危险操作'),
        h('div.row.row--wrap', { style: { marginTop: '8px' } },
          h('button.btn.btn--sm.btn--danger', { onclick: newGameDialog }, '新建游戏（覆盖当前存档位）'),
          h('button.btn.btn--sm.btn--danger', { onclick: resetMarketDialog }, '重置市场（保留资产）'),
          h('button.btn.btn--sm.btn--danger', { onclick: clearAllDialog }, '删除全部存档'))));

    function row(title, sub, control) {
      return h('div.settings-row', null,
        h('div.settings-row__text', null,
          h('b', { text: title }),
          h('span', { text: sub })),
        control);
    }
  }

  function kv(k, v) {
    return h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: String(v) }));
  }

  function toggle(on, onChange) {
    const el2 = h('div.switch' + (on ? '.is-on' : ''), {
      role: 'switch',
      tabindex: '0',
      'aria-checked': on ? 'true' : 'false',
      onclick: () => {
        const next = !el2.classList.contains('is-on');
        el2.classList.toggle('is-on', next);
        el2.setAttribute('aria-checked', next ? 'true' : 'false');
        sfx('click');
        onChange(next);
      },
    }, h('i.switch__track'));
    return el2;
  }

  function slotRows() {
    const idx = save.slotIndex();
    return [0, 1, 2].map((slot) => {
      const meta = idx.find((x) => x.slot === slot);
      const active = S.meta.slot === slot;
      return h('div.save-slot' + (active ? '.is-active' : ''), {
        onclick: () => {
          if (active) {
            toast('已是当前存档位', { kind: 'info' });
            return;
          }
          if (!meta) {
            confirmDialog({
              title: `存档位 ${slot + 1}`,
              text: '该位置为空，是否把当前进度保存到这里？',
              detail: '当前进度仍然保留在原存档位。',
            }).then((ok) => {
              if (!ok) return;
              save.save(slot).then(() => {
                S.meta.slot = slot;
                toast(`已保存到存档位 ${slot + 1}`, { kind: 'good' });
                render();
              });
            });
            return;
          }
          confirmDialog({
            title: `读取存档位 ${slot + 1}`,
            text: `读取 ${meta.name || '存档'} · 第 ${meta.day} 天 · Lv.${meta.level}，当前进度会被覆盖（未保存的进度将丢失）。`,
            okText: '读取',
          }).then((ok) => {
            if (!ok) return;
            ctx.loadSlot(slot).then(() => {
              toast('已读取存档', { kind: 'good' });
              render();
            });
          });
        },
      },
        h('div.col', { style: { flex: '1', minWidth: 0 } },
          h('div.fs-13', { text: `存档位 ${slot + 1}` + (active ? '（当前）' : '') }),
          h('div.hint', {
            text: meta
              ? `${meta.name || '经营者'} · 第 ${meta.day} 天 · Lv.${meta.level} · ${new Date(meta.at).toLocaleString('zh-CN')}`
              : '空存档位',
          })),
        meta ? h('button.iconbtn', {
          title: '删除该存档',
          style: { width: '30px', height: '30px' },
          onclick: (e) => {
            e.stopPropagation();
            confirmDialog({ title: '删除存档', text: `删除存档位 ${slot + 1}？此操作不可撤销。` }).then((ok) => {
              if (!ok) return;
              save.remove(slot).then(() => {
                toast('已删除', { kind: 'good' });
                render();
              });
            });
          },
        }, icon('trash', 14)) : null);
    });
  }

  function bestList() {
    const list = save.bestRecords();
    if (!list.length) return emptyState('还没有记录', '完成经营后会把最好成绩记在这里', 'star');
    return h('div.stack--tight.stack', { style: { marginTop: '8px' } },
      ...list.slice(0, 8).map((b, i) => h('div.row.row--between', null,
        h('span.rank__no', { text: String(i + 1).padStart(2, '0') }),
        h('div.col', { style: { flex: '1' } },
          h('div.fs-12', { text: b.name || '经营者' }),
          h('div.hint', { text: new Date(b.at).toLocaleString('zh-CN') })),
        h('span.fs-12.num', { text: '¥' + fmtPrice(b.equity) }))));
  }

  function importDialog() {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    let parsed = null;
    const dlg = modal({
      title: '导入存档',
      render: (b) => {
        b.appendChild(h('div.stack', null,
          h('div.hint', { text: '选择一个由 MONO 导出的 JSON 存档文件。导入会覆盖当前存档位。' }),
          input,
          h('div.hint', { text: '提示：索引值越大、物品越多的存档体积越大（通常 200KB~2MB）。' })));
        input.addEventListener('change', () => {
          const f = input.files && input.files[0];
          if (!f) return;
          const fr = new FileReader();
          fr.onload = () => {
            try {
              parsed = JSON.parse(String(fr.result));
              toast('文件已读取，点击确认导入', { kind: 'info' });
            } catch (e) {
              parsed = null;
              toast('JSON 解析失败', { kind: 'bad' });
            }
          };
          fr.readAsText(f, 'utf-8');
        });
      },
      foot: [
        h('button.btn.btn--ghost', { type: 'button', onclick: () => dlg.close() }, '取消'),
        h('button.btn.btn--primary', {
          type: 'button',
          onclick: async () => {
            if (!parsed) {
              toast('请先选择文件', { kind: 'bad' });
              return;
            }
            const r = await save.importText(JSON.stringify(parsed), S.meta.slot);
            dlg.close();
            if (r.ok) {
              toast('导入成功', { kind: 'good' });
              ctx.reload();
            } else {
              toast('导入失败：' + r.reason, { kind: 'bad' });
            }
          },
        }, '确认导入'),
      ],
    });
  }

  function newGameDialog() {
    confirmDialog({
      title: '新建游戏',
      text: `在当前存档位（${S.meta.slot + 1}）创建新的一局，当前进度将被覆盖。`,
      detail: '新局会重新生成市场种子、NPC 与二十天的市场历史。',
      okText: '新建',
    }).then((ok) => {
      if (!ok) return;
      ctx.newGame();
      toast('新的一局开始了', { kind: 'good' });
      ctx.go('dashboard');
    });
  }

  function resetMarketDialog() {
    confirmDialog({
      title: '重置市场',
      text: '把所有价格拉回锚价并清空事件。你的现金与库存不受影响。',
      detail: '用于测试或想重新观察一轮完整行情时使用。',
    }).then((ok) => {
      if (!ok) return;
      ctx.resetMarket();
      toast('市场已重置', { kind: 'good' });
      render();
    });
  }

  function clearAllDialog() {
    confirmDialog({
      title: '删除全部存档',
      text: '删除 3 个存档位与全部 K 线历史，并重新开始。',
      detail: '该操作不可撤销，请确认已经导出过存档。',
      okText: '全部删除',
    }).then(async (ok) => {
      if (!ok) return;
      await save.clearAll();
      ctx.newGame();
      toast('已清空并重新开始', { kind: 'good' });
      ctx.go('dashboard');
    });
  }

  render();
  return {
    el,
    onEnter: () => render(),
    onTick: () => {},
    onDestroy: () => {},
  };
}
