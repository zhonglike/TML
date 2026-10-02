/**
 * MONO — 音效占位（刻意保留的空模块）
 *
 * 音效功能已按用户要求彻底移除，但这个文件**不能删除**：
 * 浏览器 / Service Worker 可能仍缓存着旧版的 main.js 与各视图模块，
 * 它们会 `import ... from './ui/sound.js'`。文件一旦 404，旧缓存页面会直接白屏。
 * 因此这里保留一份空导出，等旧缓存自然过期后再考虑清理。
 *
 * 本模块不做任何事：不创建 AudioContext、不播放声音、不占用资源。
 */

export function setSound() {}
export function setSoundMode() {}
export function soundMode() {
  return 'off';
}
export function isSoundOn() {
  return false;
}
export function sfx() {}
export function sfxRarity() {}
export function unlock() {}
