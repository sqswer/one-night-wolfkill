'use strict';
// 服务端 TTS 模块（零依赖外壳）。
// 内部懒加载 `edge-tts`（微软 Edge 在线语音，国内可访问、免费、无需 key）。
// 若未安装 edge-tts，available() 返回 false，调用方应降级为纯文字，绝不抛错中断游戏。
// 生成的 mp3 按内容哈希落盘缓存（tts-cache/），重复播报秒回，且降低对外部接口的依赖。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(__dirname, 'tts-cache');
const DEFAULT_VOICE = process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural';
const OUTPUT_FORMAT = process.env.TTS_FORMAT || 'audio-24khz-48kbitrate-mono-mp3';

let _mod = null;       // 已加载的 edge-tts 模块
let _loadTried = false;
let _loadErr = null;

function _load() {
  if (_loadTried) return _mod;
  _loadTried = true;
  try { _mod = require('edge-tts'); }
  catch (e) { _mod = null; _loadErr = e; }
  return _mod;
}

function available() { return !!_load(); }

function _key(text, voice) {
  return crypto.createHash('sha1').update(`${voice}::${OUTPUT_FORMAT}::${text}`).digest('hex');
}

async function synthesize(text, voice) {
  const mod = _load();
  if (!mod) throw new Error('edge-tts 未安装（执行 npm install 即可启用服务端语音）');
  const v = (voice && voice.trim()) || DEFAULT_VOICE;
  const key = _key(text, v);
  const cp = path.join(CACHE_DIR, key + '.mp3');
  try {
    const cached = await fs.promises.readFile(cp);
    if (cached && cached.length) return cached;
  } catch (_) { /* 缓存未命中 */ }

  const chunks = [];
  const communicate = new mod.Communicate(text, v, { outputFormat: OUTPUT_FORMAT });
  for await (const chunk of communicate.stream()) {
    if (chunk && chunk.audio) chunks.push(Buffer.from(chunk.audio));
  }
  const audio = Buffer.concat(chunks);
  if (!audio.length) throw new Error('TTS 返回空音频');
  try {
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    await fs.promises.writeFile(cp, audio);
  } catch (_) { /* 缓存写入失败不致命 */ }
  return audio;
}

module.exports = { synthesize, available, DEFAULT_VOICE, OUTPUT_FORMAT };
