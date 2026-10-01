/**
 * MONO — Canvas 图表
 * 全部手写：K 线（蜡烛 + 均线 + 成交量）、面积折线、迷你走势、指数图。
 * 黑白灰配色：上涨用亮色空心/实心白，下跌用暗灰，符合整体调性。
 */
import { axisLabel, price as fmtPrice, thousands } from '../core/util.js';

const COL = {
  up: 'rgba(255,255,255,0.92)',
  upFill: 'rgba(255,255,255,0.55)',
  dn: 'rgba(102,102,102,0.95)',
  dnFill: 'rgba(102,102,102,0.5)',
  line: 'rgba(255,255,255,0.72)',
  grid: 'rgba(255,255,255,0.05)',
  axis: 'rgba(255,255,255,0.28)',
  ma: 'rgba(255,255,255,0.35)',
  vol: 'rgba(255,255,255,0.12)',
  volDn: 'rgba(255,255,255,0.06)',
};

function setup(canvas, height) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const h = height || canvas.clientHeight || 200;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const PAD = { l: 8, r: 54, t: 12, b: 18 };

/**
 * 主图：K 线 + 成交量
 * @param {HTMLCanvasElement} canvas
 * @param {Array<[o,h,l,c,v]>} data
 * @param {object} opt { height, ma:boolean, macd:false }
 */
export function drawKLine(canvas, data, opt = {}) {
  const height = opt.height || 200;
  const { ctx, w, h } = setup(canvas, height);
  const rows = (data || []).filter(Boolean);
  if (!rows.length) {
    drawEmpty(ctx, w, h, '暂无 K 线数据');
    return;
  }
  const volH = Math.round(h * 0.22);
  const priceH = h - volH - PAD.t - PAD.b - 6;
  const plotW = w - PAD.l - PAD.r;

  let hi = -Infinity;
  let lo = Infinity;
  let maxV = 0;
  for (const r of rows) {
    if (r[1] > hi) hi = r[1];
    if (r[2] < lo) lo = r[2];
    if ((r[4] || 0) > maxV) maxV = r[4] || 0;
  }
  if (!isFinite(hi) || !isFinite(lo)) {
    drawEmpty(ctx, w, h, '暂无有效价格');
    return;
  }
  const span = Math.max(1e-9, hi - lo);
  const pad = span * 0.08;
  hi += pad;
  lo -= pad;
  const yOf = (v) => PAD.t + priceH - ((v - lo) / (hi - lo)) * priceH;
  const step = plotW / rows.length;
  const bw = Math.max(1, Math.min(11, step * 0.62));

  // 网格 + 右侧价格轴
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    const y = Math.round(yOf(v)) + 0.5;
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(PAD.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = COL.axis;
    ctx.textAlign = 'left';
    ctx.fillText(axisLabel(v), PAD.l + plotW + 6, y);
  }

  // 蜡烛
  rows.forEach((r, i) => {
    const [o, hh, ll, c] = r;
    const x = PAD.l + i * step + (step - bw) / 2;
    const up = c >= o;
    ctx.strokeStyle = up ? COL.up : COL.dn;
    ctx.fillStyle = up ? COL.upFill : COL.dnFill;
    ctx.lineWidth = 1;
    // 影线
    ctx.beginPath();
    ctx.moveTo(Math.round(x + bw / 2) + 0.5, yOf(hh));
    ctx.lineTo(Math.round(x + bw / 2) + 0.5, yOf(ll));
    ctx.stroke();
    // 实体
    const y1 = yOf(Math.max(o, c));
    const y2 = yOf(Math.min(o, c));
    const bh = Math.max(1, y2 - y1);
    if (bw <= 2) {
      ctx.fillRect(x, y1, bw, bh);
    } else {
      ctx.fillRect(x, y1, bw, bh);
      ctx.strokeStyle = up ? COL.up : COL.dn;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y1) + 0.5, bw - 1, Math.max(1, bh - 1));
    }
  });

  // 均线（MA7 / MA30）
  if (opt.ma !== false && rows.length > 6) {
    [[7, 0.55], [30, 0.3]].forEach(([n, alpha]) => {
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < rows.length; i++) {
        if (i < n - 1) continue;
        let s = 0;
        for (let k = i - n + 1; k <= i; k++) s += rows[k][3];
        const v = s / n;
        const x = PAD.l + i * step + step / 2;
        const y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }

  // 成交量
  const volTop = PAD.t + priceH + 6;
  rows.forEach((r, i) => {
    const v = r[4] || 0;
    if (maxV <= 0) return;
    const bh = Math.max(1, (v / maxV) * volH);
    const x = PAD.l + i * step + (step - bw) / 2;
    ctx.fillStyle = r[3] >= r[0] ? COL.vol : COL.volDn;
    ctx.fillRect(x, volTop + volH - bh, bw, bh);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.textAlign = 'left';
  ctx.fillText('VOL', PAD.l + 2, volTop + 6);

  return { yOf, step, plotW, hi, lo, PAD };
}

/** 面积折线（指数 / 单值序列） */
export function drawArea(canvas, values, opt = {}) {
  const height = opt.height || 160;
  const { ctx, w, h } = setup(canvas, height);
  const rows = (values || []).filter((v) => isFinite(v));
  if (rows.length < 2) {
    drawEmpty(ctx, w, h, '数据积累中');
    return;
  }
  const plotW = w - PAD.l - PAD.r;
  const plotH = h - PAD.t - PAD.b;
  let hi = Math.max(...rows);
  let lo = Math.min(...rows);
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const yOf = (v) => PAD.t + plotH - ((v - lo) / (hi - lo)) * plotH;
  const step = plotW / (rows.length - 1);

  ctx.font = '9px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    const y = Math.round(yOf(v)) + 0.5;
    ctx.strokeStyle = COL.grid;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(PAD.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = COL.axis;
    ctx.textAlign = 'left';
    ctx.fillText(axisLabel(v), PAD.l + plotW + 6, y);
  }

  ctx.beginPath();
  rows.forEach((v, i) => {
    const x = PAD.l + i * step;
    const y = yOf(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = COL.line;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // 填充
  ctx.lineTo(PAD.l + plotW, PAD.t + plotH);
  ctx.lineTo(PAD.l, PAD.t + plotH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + plotH);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fill();
  return { yOf, step };
}

/** 迷你走势（列表内嵌） */
export function drawSpark(canvas, values, opt = {}) {
  const height = opt.height || 26;
  const { ctx, w, h } = setup(canvas, height);
  const rows = (values || []).filter((v) => isFinite(v));
  if (rows.length < 2) return;
  let hi = Math.max(...rows);
  let lo = Math.min(...rows);
  if (hi === lo) {
    hi += 0.5;
    lo -= 0.5;
  }
  const up = rows[rows.length - 1] >= rows[0];
  const step = w / (rows.length - 1);
  ctx.beginPath();
  rows.forEach((v, i) => {
    const x = i * step;
    const y = 2 + (h - 4) - ((v - lo) / (hi - lo)) * (h - 4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = up ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** 成交量柱状图（独立） */
export function drawVolume(canvas, rows, opt = {}) {
  const height = opt.height || 80;
  const { ctx, w, h } = setup(canvas, height);
  const data = (rows || []).filter(Boolean);
  if (!data.length) {
    drawEmpty(ctx, w, h, '暂无成交');
    return;
  }
  const maxV = Math.max(...data.map((r) => r[4] || 0), 1);
  const plotW = w - PAD.l - PAD.r;
  const step = plotW / data.length;
  const bw = Math.max(1, Math.min(10, step * 0.6));
  data.forEach((r, i) => {
    const bh = Math.max(1, ((r[4] || 0) / maxV) * (h - PAD.t - PAD.b));
    const x = PAD.l + i * step + (step - bw) / 2;
    ctx.fillStyle = r[3] >= r[0] ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.14)';
    ctx.fillRect(x, h - PAD.b - bh, bw, bh);
  });
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillStyle = COL.axis;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(thousands(Math.round(maxV)), w - 4, 2);
}

function drawEmpty(ctx, w, h, text) {
  ctx.font = '11px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
}

/**
 * 给 K 线图加十字光标（返回解绑函数）
 */
export function attachCrosshair(canvas, data, meta, opt = {}) {
  if (!data || !data.length) return () => {};
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.style.display = 'none';
  canvas.parentElement.style.position = 'relative';
  canvas.parentElement.appendChild(tip);
  const rows = data;
  const move = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const w = rect.width;
    const plotW = w - PAD.l - PAD.r;
    const idx = Math.max(0, Math.min(rows.length - 1, Math.round(((x - PAD.l) / plotW) * (rows.length - 1))));
    const r = rows[idx];
    if (!r) return;
    const [o, hh, ll, c, v] = r;
    const chg = o ? c / o - 1 : 0;
    tip.innerHTML =
      `<b style="color:#fff">${meta && meta.labelOf ? meta.labelOf(idx) : '#' + idx}</b><br>` +
      `开 ${fmtPrice(o)}<br>高 ${fmtPrice(hh)}<br>低 ${fmtPrice(ll)}<br>收 ${fmtPrice(c)}<br>` +
      `量 ${thousands(Math.round(v || 0))}<br>` +
      `<span style="color:${chg >= 0 ? '#fff' : '#666'}">${chg >= 0 ? '↑' : '↓'} ${(chg * 100).toFixed(2)}%</span>`;
    tip.style.display = 'block';
    const tw = tip.offsetWidth || 110;
    tip.style.left = Math.min(Math.max(4, x + 12), w - tw - 4) + 'px';
    tip.style.top = '8px';
  };
  const leave = () => {
    tip.style.display = 'none';
  };
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseleave', leave);
  canvas.addEventListener('touchstart', move, { passive: true });
  canvas.addEventListener('touchmove', move, { passive: true });
  canvas.addEventListener('touchend', leave);
  return () => {
    canvas.removeEventListener('mousemove', move);
    canvas.removeEventListener('mouseleave', leave);
    canvas.removeEventListener('touchstart', move);
    canvas.removeEventListener('touchmove', move);
    canvas.removeEventListener('touchend', leave);
    tip.remove();
  };
}
