/**
 * MONO — 任务与成就
 * 新手任务链、每日任务（含签到）、成就墙、里程碑进度。
 */
import {
  h, mount, icon, fmtPrice, sectionTitle, toast, emptyState, segmented,
} from '../ui.js';
import { S } from '../../core/state.js';
import { ECON, XP_RANKS } from '../../core/const.js';
import * as quest from '../../systems/quest.js';
import * as economy from '../../systems/economy.js';
import { thousands, clamp, pct } from '../../core/util.js';

export function create(ctx) {
  const el = h('section.view', { dataset: { view: 'quests' } });
  const st = { tab: 'chain' };
  let body = null;

  function render() {
    const chain = quest.chainQuest();
    const canSign = quest.canSignIn();
    mount(el, h('div.content', null,
      h('div.view__head', null,
        h('div', null,
          h('div.view__title', { text: '任务与成就' }),
          h('div.view__sub', { text: `等级 Lv.${S.player.level} · 声望 ${Math.round(S.player.rep)} · 每日交易额度剩余 ${economy.dailyTradeLeft()} 笔` })),
        h('div.row', null,
          h('button.btn.btn--sm' + (canSign ? '.btn--primary' : ''), {
            disabled: !canSign,
            onclick: () => {
              const r = quest.signIn();
              if (r.ok) toast(`签到成功 · 第 <b>${r.streak}</b> 天 · <b>¥${fmtPrice(r.reward)}</b>`, { kind: 'good' });
              else toast('今天已经签到过了', { kind: 'info' });
              render();
            },
          }, icon('check', 14), canSign ? '每日签到' : '已签到'),
          segmented([{ id: 'chain', label: '经营指引' }, { id: 'daily', label: '每日任务' }, { id: 'ach', label: '成就墙' }], st.tab, (id) => {
            st.tab = id;
            render();
          }))),
      (body = h('div'))));
    paint();
  }

  function paint() {
    if (st.tab === 'chain') return paintChain();
    if (st.tab === 'daily') return paintDaily();
    return paintAch();
  }

  function paintChain() {
    const list = quest.chainInfo();
    const done = list.filter((q) => q.state === 'done').length;
    mount(body, h('div', null,
      h('div.card.card--pad', null,
        sectionTitle('经营进度'),
        h('div.progress', { style: { marginTop: '10px' } },
          h('i.progress__bar', { style: { width: (done / list.length) * 100 + '%' } })),
        h('div.hint', { style: { marginTop: '6px' }, text: `${done} / ${list.length} 已完成 · 完成指引可获得金币、经验与熔炼材料` })),
      h('div.spacer', { style: { height: '12px' } }),
      h('div.stack', null, ...list.map((q, i) => questRow(q, i)))));
  }

  function questRow(q, i) {
    const prog = q.progress;
    const locked = q.state === 'locked';
    const card = h('div.card.card--pad' + (q.state === 'active' ? '' : ''), {
      class: 'card card--pad' + (locked ? ' locked' : ''),
      style: q.state === 'active' ? { borderColor: 'var(--stroke-2)' } : null,
    },
      h('div.row.row--between', { style: { alignItems: 'flex-start' } },
        h('div.col', { style: { minWidth: 0, flex: '1' } },
          h('div.row', { style: { gap: '8px' } },
            h('span.rank__no', { text: String(i + 1).padStart(2, '0') }),
            h('div.fs-13', { text: q.cn }),
            q.state === 'done' ? h('span.tag', { text: '已完成' }) : null),
          h('div.hint', { style: { marginTop: '2px' }, text: q.desc })),
        h('div.col', { style: { alignItems: 'flex-end' } },
          h('div.fs-11.num.dim', { text: `${Math.min(prog.raw, prog.target)} / ${prog.target}` }),
          q.reward ? h('div.hint', { text: rewardText(q.reward) }) : null)),
      h('div.progress', { style: { marginTop: '10px' } },
        h('i.progress__bar', { style: { width: clamp(prog.raw / prog.target, 0, 1) * 100 + '%' } })),
      q.state === 'active' && prog.done
        ? h('div.row', { style: { marginTop: '10px', justifyContent: 'flex-end' } },
          h('button.btn.btn--sm.btn--primary', {
            onclick: () => {
              const r = quest.claim(q.id);
              if (r.ok) toast(`领取「${q.cn}」奖励 ${rewardText(r.reward)}`, { kind: 'good' });
              else toast('无法领取', { kind: 'bad' });
              render();
            },
          }, '领取奖励'))
        : null);
    return card;
  }

  function rewardText(r) {
    const parts = [];
    if (r.cash) parts.push('¥' + fmtPrice(r.cash));
    if (r.scrap) parts.push('材料 ' + fmtPrice(r.scrap));
    if (r.xp) parts.push(r.xp + ' 经验');
    return parts.join(' · ');
  }

  function paintDaily() {
    const list = quest.dailyQuests();
    const canSign = quest.canSignIn();
    const daily = S.player.daily;
    mount(body, h('div', null,
      h('div.card.card--pad', null,
        sectionTitle('每日签到'),
        h('div.row.row--between', { style: { marginTop: '10px' } },
          h('div.col', null,
            h('div.fs-13', { text: canSign ? '今天还没签到' : '今天已签到' }),
            h('div.hint', { text: `连续 ${daily.streak} 天 · 基础奖励 ¥${fmtPrice(ECON.dailyBase)}，连签每天 +¥${ECON.dailyStreakBonus}（上限 ${ECON.dailyStreakCap} 天）` })),
          h('div.row', { style: { gap: '4px' } },
            ...Array.from({ length: ECON.dailyStreakCap }, (_, i) => h('i.dot' + (i < daily.streak ? '' : '.dot--dim')))))),
      h('div.spacer', { style: { height: '12px' } }),
      h('div.stack', null, ...list.map((q) => {
        const prog = quest.progressOf(q);
        const key = `d:${Math.floor(S.clock.hours / 24)}:${q.id}`;
        const claimed = S.player.quests.completed.includes(key);
        return h('div.card.card--pad', null,
          h('div.row.row--between', null,
            h('div.col', null,
              h('div.fs-13', { text: q.cn }),
              h('div.hint', { text: `进度 ${Math.min(prog.raw, prog.target)} / ${prog.target} · 奖励 ${rewardText(q.reward)}` })),
            claimed
              ? h('span.tag', { text: '已领取' })
              : h('button.btn.btn--sm' + (prog.done ? '.btn--primary' : ''), {
                disabled: !prog.done,
                onclick: () => {
                  const r = quest.claim(q.id);
                  if (r.ok) toast(`领取「${q.cn}」奖励`, { kind: 'good' });
                  render();
                },
              }, prog.done ? '领取' : '进行中')),
          h('div.progress', { style: { marginTop: '10px' } },
            h('i.progress__bar', { style: { width: clamp(prog.raw / prog.target, 0, 1) * 100 + '%' } })));
      })),
      h('div.spacer', { style: { height: '12px' } }),
      h('div.card.card--pad', null,
        sectionTitle('今日限流'),
        h('div.kv-grid', null,
          kv('交易笔数', S.player.daily.tradesToday + ' / ' + ECON.dailyTradeCap),
          kv('剩余额度', economy.dailyTradeLeft() + ' 笔')),
        h('div.hint', { style: { marginTop: '6px' }, text: '每日交易上限用于抑制无限刷单，跨日自动重置。' }))));
  }

  function paintAch() {
    const list = quest.achievementList();
    const unlocked = list.filter((a) => a.unlocked).length;
    mount(body, h('div', null,
      h('div.card.card--pad', null,
        sectionTitle('成就进度'),
        h('div.progress', { style: { marginTop: '10px' } },
          h('i.progress__bar', { style: { width: (unlocked / list.length) * 100 + '%' } })),
        h('div.hint', { style: { marginTop: '6px' }, text: `${unlocked} / ${list.length} 已达成 · 每个成就 +40 声望` })),
      h('div.spacer', { style: { height: '12px' } }),
      h('div.grid.grid--2', null, ...list.map((a) => h('div.card.card--pad' + (a.unlocked ? '' : ' locked'), null,
        h('div.row.row--between', { style: { alignItems: 'flex-start' } },
          h('div.col', { style: { minWidth: 0 } },
            h('div.fs-13', { text: a.cn }),
            h('div.hint', { text: a.desc })),
          a.unlocked ? icon('check', 16) : icon('lock', 15)),
        a.reward && a.reward.cash ? h('div.hint', { style: { marginTop: '6px' }, text: '奖励 ¥' + fmtPrice(a.reward.cash) }) : null)))),
      h('div.spacer', { style: { height: '12px' } }),
      h('div.card.card--pad', null,
        sectionTitle('等级与声望'),
        h('div.stack--tight.stack', { style: { marginTop: '8px' } },
          ...XP_RANKS.map((r) => h('div.row.row--between', null,
            h('span.fs-12' + (S.player.level >= r.lv ? '' : '.dim'), { text: `Lv.${r.lv} ${r.cn}` }),
            S.player.level >= r.lv ? h('span.fs-11.up', { text: '已达成' }) : h('span.fs-11.dim', { text: '未解锁' })))),
        h('div.hint', { style: { marginTop: '8px' }, text: '等级提升会增加背包格数、挂单上限、抽奖掉落量与手续费减免；声望改善 NPC 报价。' })));
  }

  function kv(k, v) {
    return h('div.kv', null, h('span.kv__k', { text: k }), h('span.kv__v', { text: v }));
  }

  render();
  return {
    el,
    onEnter: () => render(),
    onTick: () => {},
    onDestroy: () => {},
  };
}
