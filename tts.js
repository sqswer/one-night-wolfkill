'use strict';
// 服务端 TTS 模块（零依赖外壳）。
// 支持四种语音源（通过环境变量 TTS_PROVIDER 选择，缺省自动判定）：
//   1) piper —— 本地自托管 Piper TTS（MIT 协议，完全免费、无需 key、运行时零联网；需先准备好二进制+模型，
//               见 scripts/install_piper.js）。推荐的内部部署方案，中文音质好、资源占用极低。
//   2) baidu —— 百度语音合成（国内可访问，需要 BAIDU_TTS_API_KEY + BAIDU_TTS_SECRET_KEY）
//   3) edge  —— 微软 Edge 在线语音（免费、无需 key，但需要能联网微软；部分网络/浏览器被墙时不可用）
// 生成的音频按内容哈希落盘缓存（tts-cache/），重复播报秒回。
// 未配置可用的语音源时，available() 返回 false，调用方降级为纯文字，绝不抛错中断游戏。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

const CACHE_DIR = path.join(__dirname, 'tts-cache');
const OUTPUT_FORMAT = process.env.TTS_FORMAT || 'audio-24khz-48kbitrate-mono-mp3';

// ---- Piper（本地自托管）相关 ----
function _piperBin() {
  return process.env.PIPER_BIN || path.join(__dirname, 'tts-bin', 'piper' + (process.platform === 'win32' ? '.exe' : ''));
}
function _piperModel() {
  return process.env.PIPER_MODEL || path.join(__dirname, 'tts-bin', 'zh_CN-huayan-medium.onnx');
}
function _piperPresent() {
  try { return fs.existsSync(_piperBin()) && fs.existsSync(_piperModel()); } catch (_) { return false; }
}
function _synthesizePiper(text) {
  return new Promise((resolve, reject) => {
    const bin = _piperBin();
    const model = _piperModel();
    const binDir = path.dirname(bin);
    const tmp = path.join(CACHE_DIR, 'piper_' + crypto.randomBytes(8).toString('hex') + '.wav');
    // 让 espeak-ng 找到随包的数据目录，并优先从二进制同目录加载 .so 依赖
    const env = Object.assign({}, process.env, {
      ESPEAK_DATA_PATH: path.join(binDir, 'espeak-ng-data'),
      LD_LIBRARY_PATH: binDir + (process.env.LD_LIBRARY_PATH ? (':' + process.env.LD_LIBRARY_PATH) : ''),
    });
    let done = false;
    const finish = (err, buf) => {
      if (done) return; done = true;
      if (err) return reject(err);
      resolve(buf);
    };
    let cp;
    const errChunks = [];
    try {
      cp = child_process.spawn(bin, ['--model', model, '--output-file', tmp], { env, timeout: 30000 });
      if (cp.stderr) cp.stderr.on('data', d => errChunks.push(d));
    } catch (e) { return finish(e); }
    cp.on('error', e => { try { fs.unlinkSync(tmp); } catch (_) {} finish(e); });
    cp.on('close', code => {
      if (done) return;
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString('utf8').trim() || ('Piper 退出码 ' + code);
        try { fs.unlinkSync(tmp); } catch (_) {}
        return finish(new Error(msg));
      }
      fs.promises.readFile(tmp).then(b => { fs.promises.unlink(tmp).catch(() => {}); finish(null, b); }).catch(finish);
    });
    if (cp.stdin) {
      cp.stdin.on('error', () => {});
      try { cp.stdin.write(text); cp.stdin.end(); } catch (_) {}
    }
    setTimeout(() => { try { cp.kill(); } catch (_) {} finish(new Error('Piper 合成超时')); }, 32000);
  });
}

// ---- 百度语音相关 ----
let _baiduToken = null;
let _baiduTokenExp = 0;

function _baiduEnabled() {
  return !!_fetch && !!process.env.BAIDU_TTS_API_KEY && !!process.env.BAIDU_TTS_SECRET_KEY;
}

async function _getBaiduToken() {
  if (_baiduToken && _baiduTokenExp > Date.now()) return _baiduToken;
  const key = process.env.BAIDU_TTS_API_KEY;
  const secret = process.env.BAIDU_TTS_SECRET_KEY;
  if (!key || !secret) throw new Error('未配置 BAIDU_TTS_API_KEY / BAIDU_TTS_SECRET_KEY');
  const url = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=' +
    encodeURIComponent(key) + '&client_secret=' + encodeURIComponent(secret);
  const r = await _fetch(url);
  const j = await r.json();
  if (!j.access_token) throw new Error('百度 token 获取失败: ' + (j.error_description || j.error || '未知错误'));
  _baiduToken = j.access_token;
  _baiduTokenExp = Date.now() + (j.expires_in ? j.expires_in * 1000 : 30 * 24 * 3600 * 1000) - 60000;
  return _baiduToken;
}

// 百度 tex 限制 1024 字节(UTF-8)，超长按字符切到 <=1000 字节（尽量不断词）
function _splitBaidu(text) {
  const maxBytes = 1000;
  const out = [];
  let cur = '';
  for (const ch of text) {
    if (Buffer.byteLength(cur + ch, 'utf8') > maxBytes) { if (cur) out.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

async function _synthesizeBaidu(text) {
  const token = await _getBaiduToken();
  const per = process.env.BAIDU_TTS_PER || '4';   // 4 = 度丫丫(情感女声，免费可用)；0=标准女声 1=标准男声 3=逍遥
  const spd = process.env.BAIDU_TTS_SPD || '5';   // 语速 0-15
  const pit = process.env.BAIDU_TTS_PIT || '5';   // 音调 0-15
  const vol = process.env.BAIDU_TTS_VOL || '5';   // 音量 0-15
  const segs = _splitBaidu(text);
  const parts = [];
  for (const seg of segs) {
    const body = new URLSearchParams();
    body.set('tex', seg);
    body.set('tok', token);
    body.set('cuid', 'onw-tts');
    body.set('ctp', '1');
    body.set('lan', 'zh');
    body.set('spd', spd);
    body.set('pit', pit);
    body.set('vol', vol);
    body.set('per', per);
    body.set('aue', '3'); // 3 = mp3
    const r = await _fetch('https://tsn.baidu.com/text2audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const ct = r.headers.get('content-type') || '';
    if (ct.indexOf('audio') >= 0) {
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length) parts.push(b);
      else throw new Error('百度返回空音频');
    } else {
      const j = await r.json().catch(() => ({}));
      throw new Error('百度合成失败: ' + (j.err_msg || j.error || ct));
    }
  }
  return Buffer.concat(parts);
}

// ---- edge-tts 相关（保留兼容） ----
let _edgeMod = null;
let _edgeLoadTried = false;
let _edgeLoadErr = null;
function _loadEdge() {
  if (_edgeLoadTried) return _edgeMod;
  _edgeLoadTried = true;
  try { _edgeMod = require('edge-tts'); } catch (e) { _edgeMod = null; _edgeLoadErr = e; }
  return _edgeMod;
}
const EDGE_VOICE = process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural';
async function _synthesizeEdge(text, voice) {
  const mod = _loadEdge();
  if (!mod) throw new Error('edge-tts 未安装（执行 npm install 即可启用）');
  const v = (voice && voice.trim()) || EDGE_VOICE;
  const chunks = [];
  const communicate = new mod.Communicate(text, v, { outputFormat: OUTPUT_FORMAT });
  for await (const chunk of communicate.stream()) {
    if (chunk && chunk.audio) chunks.push(Buffer.from(chunk.audio));
  }
  const audio = Buffer.concat(chunks);
  if (!audio.length) throw new Error('TTS 返回空音频');
  return audio;
}

// ---- provider 自动判定（运行时动态解析，安装 tts-bin 后无需重启即生效）----
const _fetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
function _resolveProvider() {
  const forced = (process.env.TTS_PROVIDER || '').toLowerCase();
  if (forced) return forced;
  if (_piperPresent()) return 'piper';
  if (_baiduEnabled()) return 'baidu';
  return 'edge';
}
const PROVIDER = _resolveProvider(); // 仅供信息展示；实际以 _resolveProvider() 为准

// ---- 公共接口 ----
function available() {
  const provider = _resolveProvider();
  if (provider === 'piper') return _piperPresent();
  if (provider === 'baidu') return _baiduEnabled();
  if (provider === 'edge') return !!_loadEdge();
  return false;
}

function contentType() {
  return _resolveProvider() === 'piper' ? 'audio/wav' : 'audio/mpeg';
}

function _cacheKey(text, tag) {
  return crypto.createHash('sha1').update(`${tag}::${text}`).digest('hex');
}

async function synthesize(text, voice) {
  const provider = _resolveProvider();
  let tag, ext;
  if (provider === 'piper') { tag = 'piper'; ext = 'wav'; }
  else if (provider === 'baidu') { tag = 'baidu:' + (process.env.BAIDU_TTS_PER || '4'); ext = 'mp3'; }
  else { tag = 'edge:' + (voice || EDGE_VOICE); ext = 'mp3'; }
  const key = _cacheKey(text, tag);
  const cp = path.join(CACHE_DIR, key + '.' + ext);
  try {
    const cached = await fs.promises.readFile(cp);
    if (cached && cached.length) return cached;
  } catch (_) { /* 缓存未命中 */ }

  const audio = provider === 'piper'
    ? await _synthesizePiper(text)
    : provider === 'baidu'
      ? await _synthesizeBaidu(text)
      : await _synthesizeEdge(text, voice);

  try {
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    await fs.promises.writeFile(cp, audio);
  } catch (_) { /* 缓存写入失败不致命 */ }
  return audio;
}

module.exports = { synthesize, available, contentType, PROVIDER, OUTPUT_FORMAT };
