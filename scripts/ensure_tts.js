'use strict';
// 启动前幂等确保 MeloTTS 引擎就位（Bonto 等容器部署 pull from remote 后自动带模型）。
//   - 模型已存在：秒退，零开销；
//   - 模型缺失：尝试联网下载（仅首次），失败仅告警、绝不阻断 server 启动（回退 Piper/纯文字）。
// 这样无论部署走 Dockerfile 还是直接 `npm start`，MeloTTS 都会自动就位，无需手动进容器。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const modelOnnx = path.join(ROOT, 'tts-bin', 'vits-melo-tts-zh_en', 'model.onnx');

if (fs.existsSync(modelOnnx)) {
  console.log('[ensure_tts] MeloTTS 模型已存在，跳过自动安装');
  process.exit(0);
}

console.log('[ensure_tts] 未检测到 MeloTTS 模型，尝试自动安装（仅首次，失败将回退 Piper/纯文字）...');
try {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'install_melo.js')], { stdio: 'inherit' });
  if (r.status === 0) {
    console.log('[ensure_tts] ✅ 安装完成，已切换到 MeloTTS');
  } else {
    console.warn('[ensure_tts] ⚠️ 自动安装未成功（多半无外网），游戏照常进行，服务端将回退 Piper 或纯文字');
  }
} catch (e) {
  console.warn('[ensure_tts] ⚠️ 自动安装异常：', e.message);
}
process.exit(0); // 永远不阻断启动
