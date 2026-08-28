'use strict';
// 服务端 TTS 模块（零依赖外壳）。
// 语音源：piper —— 本地自托管 Piper TTS（MIT 协议，完全免费、无需 key、运行时零联网）。
//   需先准备好二进制+模型，见 scripts/install_piper.js。中文音质好、资源占用极低，推荐的内部部署方案。
// 生成的音频按内容哈希落盘缓存（tts-cache/<hash>.wav），重复播报秒回、跨局复用，不重复占用空间。
// 未配置可用的语音源时，available() 返回 false，调用方降级为纯文字，绝不抛错中断游戏。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child_process = require('child_process');

const CACHE_DIR = path.join(__dirname, 'tts-cache');

// 启动时清理历史上遗留的临时 wav（早期版本会写临时文件，失败/被杀时残留）
try {
  if (fs.existsSync(CACHE_DIR)) {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (f.startsWith('piper_') && f.endsWith('.wav')) {
        try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch (_) {}
      }
    }
  }
} catch (_) {}

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

// ---- 合成参数（可通过环境变量覆盖，便于在 Bonto 上直接微调、无需改代码）----
// length_scale  >1 语速更慢更清晰；noise_scale 越小韵律越稳（音调乱飘时调低）；
// noise_w      越小音长抖动越小；sentence_silence 句间停顿秒数（断句不准时调大）。
function _piperParams() {
  const num = (name, def) => {
    const v = parseFloat(process.env[name]);
    return Number.isFinite(v) ? v : def;
  };
  return {
    lengthScale: num('PIPER_LENGTH_SCALE', 1.08),
    noiseScale: num('PIPER_NOISE_SCALE', 0.55),
    noiseW: num('PIPER_NOISE_W', 0.75),
    sentenceSilence: num('PIPER_SENTENCE_SILENCE', 0.45),
  };
}

// ---- 中文播报文本预处理：让 Piper 读得更准、断句更自然 ----
// 1) 【角色名】去掉方括号、两侧留空格：避免把括号符号读出来，并给角色名自然停顿
// 2) 标点后补空格：制造轻微停顿，改善「一口气读完」的断句问题
// 3) 句末补句号：缺标点时 Piper 不会降调，听感发飘
// 4) 极长句按标点拆成多句：降低单句合成压力，韵律更稳
function normalizeForTTS(text) {
  let s = String(text == null ? '' : text).trim();
  if (!s) return '';
  s = s.replace(/【([^】]*)】/g, (_m, inner) => ' ' + inner + ' ');   // 去掉【】并留停顿
  s = s.replace(/\s+/g, ' ').trim();
  // 超长长句：在逗号/顿号处断成多句（>28 字且含逗号时），避免一口气读完导致断句错乱
  if (s.length > 28 && /[，、]/.test(s)) {
    const parts = s.split(/([，、])/);
    const rebuilt = [];
    let buf = '';
    for (let i = 0; i < parts.length; i++) {
      buf += parts[i];
      const isSep = parts[i] === '，' || parts[i] === '、';
      if (isSep && buf.length >= 14) { rebuilt.push(buf); buf = ''; }
    }
    if (buf.trim()) rebuilt.push(buf);
    if (rebuilt.length > 1) {
      s = rebuilt.map(p => p.replace(/[，、]$/, '') + '。').join(' ').replace(/\s+/g, ' ').trim();
    }
  }
  // 标点后补空格（轻微停顿）
  s = s.replace(/([，。！？；：、])/g, '$1 ').replace(/\s+/g, ' ').trim();
  // 句末补句号，保证句末降调
  if (!/[。！？…]$/.test(s)) s += '。';
  return s;
}
// Piper 把音频写到临时 wav，读完即删；任何分支（成功/失败/超时/被杀）都保证临时文件被清理，
// 避免 tts-cache 下残留大量临时 piper_*.wav。最终音频按内容哈希落盘缓存（见 synthesize），
// 跨局复用，不重复占用空间。
function _runPiperOnce(text, useParams) {
  return new Promise((resolve, reject) => {
    const bin = _piperBin();
    const model = _piperModel();
    const binDir = path.dirname(bin);
    // 必须先确保缓存目录存在，否则 Piper 写不进临时 wav 会直接失败
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
    const tmp = path.join(CACHE_DIR, 'piper_' + crypto.randomBytes(8).toString('hex') + '.wav');
    // 让 espeak-ng 找到随包的数据目录，并优先从二进制同目录加载 .so 依赖
    const env = Object.assign({}, process.env, {
      ESPEAK_DATA_PATH: path.join(binDir, 'espeak-ng-data'),
      LD_LIBRARY_PATH: binDir + (process.env.LD_LIBRARY_PATH ? (':' + process.env.LD_LIBRARY_PATH) : ''),
    });
    let done = false;
    const cleanup = () => { try { fs.unlinkSync(tmp); } catch (_) {} };
    const finish = (err, buf) => {
      if (done) return; done = true;
      if (err) { cleanup(); return reject(err); }
      resolve(buf);
    };
    let cp;
    const errChunks = [];
    const args = ['--model', model];
    if (useParams) {
      const P = _piperParams();
      // 注意：Piper 官方参数名是下划线（见 piper --help）
      args.push(
        '--length_scale', String(P.lengthScale),
        '--noise_scale', String(P.noiseScale),
        '--noise_w', String(P.noiseW),
        '--sentence_silence', String(P.sentenceSilence),
      );
    }
    args.push('--output_file', tmp);
    try {
      cp = child_process.spawn(bin, args, { env, timeout: 30000 });
      if (cp.stderr) cp.stderr.on('data', d => errChunks.push(d));
    } catch (e) { return finish(e); }
    cp.on('error', e => finish(e));
    cp.on('close', code => {
      if (done) return;
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString('utf8').trim() || ('Piper 退出码 ' + code);
        return finish(new Error(msg));
      }
      fs.promises.readFile(tmp).then(b => { cleanup(); finish(null, b); }).catch(e => finish(e));
    });
    if (cp.stdin) {
      cp.stdin.on('error', () => {});
      try { cp.stdin.write(text); cp.stdin.end(); } catch (_) {}
    }
    setTimeout(() => { try { cp.kill(); } catch (_) {} finish(new Error('Piper 合成超时')); }, 32000);
  });
}

// 兜底：若当前 Piper 版本不接受这些调优参数（报未知选项），自动回退到
// 「仅 --model/--output_file」的基础调用，保证语音功能不因参数差异而整体失效。
function _synthesizePiper(text) {
  return _runPiperOnce(text, true).catch(err => {
    const msg = err && err.message || '';
    if (/unrecogni[sz]ed|unknown|unmatched|invalid option|no such option/i.test(msg)) {
      console.warn('[tts] Piper 不接受调优参数，回退基础参数重试：', msg.split('\n')[0]);
      return _runPiperOnce(text, false);
    }
    throw err;
  });
}

// ---- provider 自动判定（运行时动态解析，安装 tts-bin 后无需重启即生效）----
function _resolveProvider() {
  return _piperPresent() ? 'piper' : '';
}
const PROVIDER = (() => { try { return _resolveProvider() || 'none'; } catch (_) { return 'none'; } })();

// ---- 公共接口 ----
function available() {
  return _resolveProvider() === 'piper';
}

function contentType() {
  return 'audio/wav';
}

function _cacheKey(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

async function synthesize(text, voice) {
  const key = _cacheKey(text);
  const cp = path.join(CACHE_DIR, key + '.wav');
  try {
    const cached = await fs.promises.readFile(cp);
    if (cached && cached.length) return cached;   // 命中缓存：跨局复用，不重复合成
  } catch (_) { /* 缓存未命中 */ }

  // 先做中文播报预处理（加停顿、补句末标点等），只影响送进 Piper 的文本，不改界面显示
  const spoken = normalizeForTTS(text);
  const audio = await _synthesizePiper(spoken);

  try {
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    await fs.promises.writeFile(cp, audio);
  } catch (_) { /* 缓存写入失败不致命 */ }
  return audio;
}

module.exports = { synthesize, available, contentType, PROVIDER, normalizeForTTS };
