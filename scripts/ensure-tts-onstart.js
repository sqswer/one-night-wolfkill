'use strict';
// 启动前自检（由 package.json 的 prestart 调用，故 `npm start` 前必跑）：
//   - MeloTTS 引擎已就绪 → 秒过、不联网；
//   - 缺失 → 调 install_melo.js 自动拉取（ghproxy 镜像 + 幂等，首次约 190MB）；
//   - 拉取失败/不可用 → 仅告警并降级 Piper 启动，绝不阻断服务。
// 这样 Bonto 每次重建/唤醒容器都会自愈，无需手动重跑脚本，也不把 190MB 塞进 git
// （GitHub 单文件 100MB 硬上限会拒掉 model.onnx）。
// 本地开发若已手动 install:melo，本脚本直接跳过；若本地 tts-bin 缺失也会尝试拉取。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tts-bin');
const isWin = process.platform === 'win32';
const BIN = path.join(OUT, 'sherpa-onnx-offline-tts' + (isWin ? '.exe' : ''));
const MODEL_ONNX = path.join(OUT, 'vits-melo-tts-zh_en', 'model.onnx');

function meloPresent() {
  return fs.existsSync(BIN) && fs.existsSync(MODEL_ONNX);
}

if (meloPresent()) {
  console.log('[ensure-tts] MeloTTS 已就绪，跳过下载');
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
