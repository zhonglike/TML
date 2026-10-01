/**
 * MONO — 极简音效
 * 全部用 WebAudio 现场合成（无音频文件）：低频短促、金属感、纸张感。
 * 默认开启，可在设置里关闭；上下文在首次用户交互后创建（浏览器策略）。
 */

let ctx = null;
let enabled = true;
let lastAt = 0;

function ac() {
  if (!enabled) return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch (e) {
    return null;
  }
  return ctx;
}

function tone({ f = 440, f2 = null, dur = 0.08, type = 'sine', gain = 0.05, delay = 0 }) {
  const a = ac();
  if (!a) return;
  if (a.state === 'suspended') a.resume().catch(() => {});
  // 全局限流：避免连抽时音效糊成一片
  const now = a.currentTime;
  if (now - lastAt < 0.012) return;
  lastAt = now;
  const t0 = now + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 白噪声（纸张/翻页感） */
function noise({ dur = 0.06, gain = 0.03, hp = 900 }) {
  const a = ac();
  if (!a) return;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

const SOUNDS = {
  click: () => tone({ f: 1550, f2: 900, dur: 0.035, type: 'triangle', gain: 0.03 }),
  tap: () => noise({ dur: 0.03, gain: 0.014, hp: 1600 }),
  reveal: () => {
    tone({ f: 620, f2: 1240, dur: 0.09, type: 'triangle', gain: 0.045 });
    noise({ dur: 0.05, gain: 0.016, hp: 1200 });
  },
  suspense: () => tone({ f: 120, f2: 96, dur: 0.5, type: 'sine', gain: 0.035 }),
  gold: () => {
    [0, 0.07, 0.15].forEach((d, i) => tone({ f: 880 * (1 + i * 0.22), dur: 0.22, type: 'sine', gain: 0.05, delay: d }));
  },
  red: () => {
    [0, 0.08, 0.16, 0.28].forEach((d, i) => tone({ f: 660 * (1 + i * 0.18), dur: 0.3, type: 'triangle', gain: 0.055, delay: d }));
    tone({ f: 60, dur: 0.6, type: 'sine', gain: 0.05, delay: 0.02 });
  },
  buy: () => tone({ f: 520, f2: 780, dur: 0.07, type: 'sine', gain: 0.04 }),
  sell: () => {
    tone({ f: 1180, f2: 940, dur: 0.06, type: 'sine', gain: 0.04 });
    tone({ f: 1640, dur: 0.05, type: 'sine', gain: 0.025, delay: 0.06 });
  },
  ding: () => {
    tone({ f: 1320, dur: 0.18, type: 'sine', gain: 0.045 });
    tone({ f: 1980, dur: 0.12, type: 'sine', gain: 0.02, delay: 0.02 });
  },
  thud: () => tone({ f: 130, f2: 70, dur: 0.22, type: 'sine', gain: 0.05 }),
  error: () => tone({ f: 220, f2: 160, dur: 0.12, type: 'square', gain: 0.03 }),
  levelup: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone({ f, dur: 0.26, type: 'sine', gain: 0.045, delay: i * 0.08 }));
  },
  coin: () => {
    tone({ f: 1560, dur: 0.06, type: 'triangle', gain: 0.04 });
    tone({ f: 2100, dur: 0.06, type: 'triangle', gain: 0.03, delay: 0.05 });
  },
  tick: () => noise({ dur: 0.02, gain: 0.008, hp: 2400 }),
  open: () => noise({ dur: 0.08, gain: 0.02, hp: 700 }),
};

export function setSound(on) {
  enabled = !!on;
  if (enabled) ac();
}

export function isSoundOn() {
  return enabled;
}

/** 播放；未知名字静默忽略 */
export function sfx(name) {
  if (!enabled) return;
  const fn = SOUNDS[name];
  if (!fn) return;
  try {
    fn();
  } catch (e) { /* 音频不可用时忽略 */ }
}

/** 抽奖结果音：按稀有度 */
export function sfxRarity(rarity) {
  if (rarity === 'red') return sfx('red');
  if (rarity === 'gold') return sfx('gold');
  if (rarity === 'purple' || rarity === 'blue') return sfx('reveal');
  return sfx('tap');
}

/** 首次交互时解锁音频上下文 */
export function unlock() {
  const a = ac();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
}
