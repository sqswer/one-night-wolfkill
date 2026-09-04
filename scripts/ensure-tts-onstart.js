'use strict';
// 启动前自检（由 package.json 的 prestart 调用，故 `npm start` 前必跑）：
//   - 默认【不下载】MeloTTS：Bonto Free 档(256MB)装不下任何 TTS 引擎，melo(190MB) 下载会撑爆存储、
//     导致 push/pull 被拒。故 Bonto 仅用 Piper/纯文字，无需自动拉取。
//   - 仅当 INSTALL_MELO_ON_START=1（如 Zeabur 等空间充足的平台）才自动拉取 melo（ghproxy 镜像 + 幂等）。
//   - melo 已在本地就位 → 跳过；缺失且未开启下载 → 仅告警降级，绝不阻断服务。
// 这样：Bonto 这台只保 Piper（省空间能 push），迁移 Zeabur 时设该环境变量即可自动装 melo。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tts-bin');
const isWin = process.platform === 'win32';
const BIN = path.join(OUT, 'sherpa-onnx-offline-tts' + (isWin ? '.exe' : ''));
const MODEL_ONNX = path.join(OUT, 'vits-melo-tts-zh_en', 'model.onnx');

const INSTALL_MELO_ON_START =
  process.env.INSTALL_MELO_ON_START === '1' || process.env.INSTALL_MELO_ON_START === 'true';

function meloPresent() {
  return fs.existsSync(BIN) && fs.existsSync(MODEL_ONNX);
}

if (meloPresent()) {
  console.log('[ensure-tts] MeloTTS 已就绪，跳过下载');
  process.exit(0);
}

if (!INSTALL_MELO_ON_START) {
  console.log('[ensure-tts] 未开启 INSTALL_MELO_ON_START，跳过 MeloTTS 下载（仅用 Piper/纯文字）。');
  console.log('[ensure-tts]   Bonto Free 档 256MB 装不下 TTS 引擎；迁移 Zeabur 时设 INSTALL_MELO_ON_START=1 即可自动安装 melo。');
  process.exit(0);
}

console.log('[ensure-tts] 未检测到 MeloTTS，尝试自动拉取（ghproxy 镜像，首次约 190MB）…');
const r = spawnSync(process.execPath, [path.join(__dirname, 'install_melo.js')], {
  stdio: 'inherit',
  env: process.env,
});
if (r.status === 0 && meloPresent()) {
  console.log('[ensure-tts] MeloTTS 拉取成功，继续启动');
  process.exit(0);
}
// 拉取失败也不阻断：降级 Piper 照常开局（音质较低但功能完整）。
console.warn('[ensure-tts] ⚠️ MeloTTS 自动拉取失败/不可用，将降级 Piper 启动。');
console.warn('[ensure-tts]   排查：检查容器网络；或手动 `bash scripts/bonto-download-tts.sh melo` 后重启。');
process.exit(0);
