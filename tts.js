'use strict';
// 服务端 TTS 模块（零依赖外壳）。
// 语音源（双引擎并存：默认优先 MeloTTS，缺失则自动回退 Piper）：
//   melo  —— MeloTTS 经 sherpa-onnx 推理（CPU 实时、44100Hz，中文自然度与中英混读明显优于 Piper）。
//            需额外装 sherpa-onnx 二进制 + 163MB 模型，见 scripts/install_melo.js。
//   piper —— 本地自托管 Piper TTS（MIT 协议，完全免费、无需 key、运行时零联网，零依赖单二进制）。
//            资源占用极低，见 scripts/install_piper.js；未装 MeloTTS 时自动使用它。
// 两者共用同一套接口、串行队列与磁盘缓存（缓存 key 带 provider，切换引擎不会串味）。
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
      if ((f.startsWith('piper_') || f.startsWith('melo_')) && f.endsWith('.wav')) {
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
    _ensureDirSync();
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

// ---- MeloTTS（sherpa-onnx 推理）相关 ----
// 音质优于 Piper（44100Hz、pypinyin/g2p 音素化更准、中英混读稳），代价是多一个引擎二进制
// 与 163MB 模型。未安装时 _meloPresent() 为 false，自动回退 Piper，零依赖部署不受影响。
function _meloBin() {
  return process.env.SHERPA_BIN || path.join(__dirname, 'tts-bin', 'sherpa-onnx-offline-tts' + (process.platform === 'win32' ? '.exe' : ''));
}
function _meloDir() {
  return process.env.MELO_MODEL_DIR || path.join(__dirname, 'tts-bin', 'vits-melo-tts-zh_en');
}
function _meloPresent() {
  try {
    const dir = _meloDir();
    return fs.existsSync(_meloBin())
      && fs.existsSync(path.join(dir, 'model.onnx'))
      && fs.existsSync(path.join(dir, 'lexicon.txt'))
      && fs.existsSync(path.join(dir, 'tokens.txt'));
  } catch (_) { return false; }
}

// MeloTTS 自带 g2p 与数字/日期规则（date.fst / number.fst），中文标点交给它自己断句，
// 因此只做最小归一化（去【】、补句末句号），不像 Piper 那样插空格、拆长句。
function normalizeForMelo(text) {
  let s = String(text == null ? '' : text).trim();
  if (!s) return '';
  s = s.replace(/【([^】]*)】/g, (_m, inner) => ' ' + inner + ' ');   // 去掉【】并留停顿
  s = s.replace(/\s+/g, ' ').trim();
  if (!/[。！？…]$/.test(s)) s += '。';                              // 句末补句号，保证降调
  return s;
}

function _synthesizeMelo(text) {
  return new Promise((resolve, reject) => {
    const bin = _meloBin(), dir = _meloDir();
    const binDir = path.dirname(bin);
    _ensureDirSync();
    const tmp = path.join(CACHE_DIR, 'melo_' + crypto.randomBytes(8).toString('hex') + '.wav');
    const args = [
      '--vits-model=' + path.join(dir, 'model.onnx'),
      '--vits-lexicon=' + path.join(dir, 'lexicon.txt'),
      '--vits-tokens=' + path.join(dir, 'tokens.txt'),
    ];
    // 数字/日期读法规则（可选：装了就加，缺了不影响基本合成）
    const dateFst = path.join(dir, 'date.fst'), numFst = path.join(dir, 'number.fst');
    if (fs.existsSync(dateFst) && fs.existsSync(numFst)) args.push('--tts-rule-fsts=' + dateFst + ',' + numFst);
    // speed <1 稍慢更清晰（对齐 Piper 侧 length_scale 1.08 的听感）；小容器固定 1 线程
    const speed = (() => { const v = parseFloat(process.env.MELO_SPEED); return Number.isFinite(v) && v > 0 ? v : 0.95; })();
    const threads = (() => { const v = parseInt(process.env.MELO_THREADS, 10); return Number.isFinite(v) && v > 0 ? v : 1; })();
    args.push('--speed=' + speed);
    args.push('--num-threads=' + threads);
    args.push('--output-filename=' + tmp);
    args.push(String(text));   // 注意：sherpa 的文本是最后一个位置参数，不是 stdin（与 Piper 不同）
    // shared 版二进制依赖同目录的动态库，必须让动态库搜索路径包含它
    const env = Object.assign({}, process.env, {
      LD_LIBRARY_PATH: binDir + (process.env.LD_LIBRARY_PATH ? (':' + process.env.LD_LIBRARY_PATH) : ''),
    });
    let done = false;
    const cleanup = () => { try { fs.unlinkSync(tmp); } catch (_) {} };
    const finish = (err, buf) => {
      if (done) return; done = true;
      if (err) { cleanup(); return reject(err); }
      resolve(buf);
    };
    const errChunks = [];
    let cp;
    try { cp = child_process.spawn(bin, args, { env }); } catch (e) { return finish(e); }
    if (cp.stderr) cp.stderr.on('data', d => errChunks.push(d));
    cp.on('error', e => finish(e));
    cp.on('close', code => {
      if (done) return;
      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString('utf8').trim() || ('sherpa-onnx 退出码 ' + code);
        return finish(new Error(msg));
      }
      fs.promises.readFile(tmp).then(b => { cleanup(); finish(null, b); }).catch(e => finish(e));
    });
    // 163MB 模型在小容器上单条可能数秒，超时放宽到 60s（Piper 为 32s）
    setTimeout(() => { try { cp.kill(); } catch (_) {} finish(new Error('MeloTTS 合成超时')); }, 60000);
  });
}

// ---- provider 自动判定（运行时动态解析，装好文件后重启即生效）----
// 双引擎并存：默认优先 melo（音质更好），缺失则回退 piper；
// 可用 TTS_PROVIDER=melo|piper 强制指定，便于对比听感或排障。
function _resolveProvider() {
  const forced = (process.env.TTS_PROVIDER || '').trim().toLowerCase();
  if (forced === 'melo') return _meloPresent() ? 'melo' : '';
  if (forced === 'piper') return _piperPresent() ? 'piper' : '';
  if (_meloPresent()) return 'melo';
  if (_piperPresent()) return 'piper';
  return '';
}
const PROVIDER = (() => { try { return _resolveProvider() || 'none'; } catch (_) { return 'none'; } })();

// ---- 公共接口 ----
function available() {
  const p = _resolveProvider();
  return p === 'melo' || p === 'piper';
}

function contentType() {
  return 'audio/wav';
}

function _cacheKey(text) {
  // key 必须带 provider：否则切换引擎后同一句话会命中旧引擎生成的缓存，
  // 表现为「换了引擎但声音没变」。带 provider 后两套缓存并存，来回切换都能命中。
  return crypto.createHash('sha1').update(_resolveProvider() + '|' + text).digest('hex');
}

// ---- 合成调度：全局串行 + 优先级 ----
// 小容器（Bonto：0.06 核 / 512MB）上并发两个 Piper 既互相拖慢又有 OOM 风险，
// 因此所有合成排成一条队列串行执行；玩家正在等的那一条（交互请求，prio 高）插队到
// 预热任务（prio 低）之前，保证后台预热不会拖慢当前正在播的语音。
const _synthQueue = [];      // { text, prio, seq, resolve, reject }
let _synthRunning = false;
let _synthSeq = 0;
const _inflight = new Map(); // cacheKey -> Promise（同一文本的并发请求只真正合成一次）

function _enqueueSynth(text, prio) {
  return new Promise((resolve, reject) => {
    const job = { text, prio, seq: _synthSeq++, resolve, reject };
    // 跳过所有「优先级 >= 自己」的，插到第一个比自己低的之前：高优先级靠前，同级保持先来后到
    let i = 0;
    while (i < _synthQueue.length && _synthQueue[i].prio >= prio) i++;
    _synthQueue.splice(i, 0, job);
    _pumpSynth();
  });
}

function _pumpSynth() {
  if (_synthRunning) return;
  const job = _synthQueue.shift();
  if (!job) return;
  _synthRunning = true;
  _synthNow(job.text).then(job.resolve, job.reject).then(() => {
    _synthRunning = false;
    setTimeout(_pumpSynth, 0);
  });
}

function _cachePath(key) { return path.join(CACHE_DIR, key + '.wav'); }

// 缓存目录只需确保存在一次（每次合成都 mkdir 会白白多一次磁盘往返）
let _dirChecked = false;
function _ensureDirSync() {
  if (_dirChecked) return;
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}
  try { _dirChecked = fs.statSync(CACHE_DIR).isDirectory(); } catch (_) { _dirChecked = false; }
}

async function _readCache(key) {
  try {
    const buf = await fs.promises.readFile(_cachePath(key));
    return (buf && buf.length) ? buf : null;
  } catch (_) { return null; }
}

async function _synthNow(text) {
  // 两个引擎的文本归一化策略不同（Piper 需插空格/拆长句，MeloTTS 交给自带 g2p 断句），
  // 按当前引擎选用。只影响送进引擎的文本，不改界面显示。
  const useMelo = _resolveProvider() === 'melo';
  const audio = useMelo
    ? await _synthesizeMelo(normalizeForMelo(text))
    : await _synthesizePiper(normalizeForTTS(text));
  try {
    await fs.promises.writeFile(_cachePath(_cacheKey(text)), audio);
  } catch (_) { /* 缓存写入失败不致命 */ }
  return audio;
}

// prio：10 = 玩家正在等的那一条（默认）；0 = 后台预热。高优先级插队到低优先级之前。
async function synthesize(text, voice, prio) {
  const key = _cacheKey(text);
  const cached = await _readCache(key);
  if (cached) return cached;                      // 命中磁盘缓存：跨局复用，毫秒级返回
  if (_inflight.has(key)) return _inflight.get(key);
  const p = _enqueueSynth(text, prio == null ? 10 : prio);
  const guarded = p.finally(() => { if (_inflight.get(key) === guarded) _inflight.delete(key); });
  _inflight.set(key, guarded);
  return guarded;
}

// 预热：把一局里将要播报的文本提前合成进缓存。串行、低优先级、已缓存的自动跳过（几乎零成本）。
// 目的：把「现合成」从播报的关键路径上挪走——否则每条播报都要等 1~3 秒，夜里越往后越慢。
async function warm(texts) {
  if (!available() || !Array.isArray(texts)) return { ok: 0, total: 0 };
  let ok = 0, total = 0;
  for (const t of texts) {
    const s = String(t == null ? '' : t).trim();
    if (!s || s.length > 500) continue;
    total++;
    // prio=0：后台预热，玩家正在等的那一条可以随时插到它前面
    try { await synthesize(s, undefined, 0); ok++; }
    catch (e) { console.warn('[tts] 预热失败:', JSON.stringify(s.slice(0, 16)), e && e.message || e); }
    // 每合成一条让出 20ms，给主流程（推进夜晚、响应请求）留出呼吸空间
    await new Promise(r => setTimeout(r, 20));
  }
  return { ok, total };
}

// 队列深度（诊断用：>0 说明有合成在排队，播报间隔会被拉长）
function pending() { return _synthQueue.length + (_synthRunning ? 1 : 0); }

module.exports = { synthesize, warm, pending, available, contentType, PROVIDER, normalizeForTTS, normalizeForMelo };
