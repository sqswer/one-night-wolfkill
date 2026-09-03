'use strict';
// MeloTTS 就位检查（纯诊断脚本，不联网、不下载）。
//   - 用法：`npm run ensure:tts`（手动查看引擎状态，供排障用）
//   - 自动下载安装请用 `npm run install:melo`（需联网，适合本机或有外网的机器）
//   - 启动（npm start）不再做任何下载，模型由 install:melo 或手动放置提供
//     详见 README 的「MeloTTS 手动部署」：把 sherpa 二进制 + 模型放进 tts-bin/ 即可。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ttsBin = path.join(ROOT, 'tts-bin');
const binName = 'sherpa-onnx-offline-tts' + (process.platform === 'win32' ? '.exe' : '');
const binPath = process.env.SHERPA_BIN || path.join(ttsBin, binName);
const modelDir = process.env.MELO_MODEL_DIR || path.join(ttsBin, 'vits-melo-tts-zh_en');
const modelOnnx = path.join(modelDir, 'model.onnx');

const binOk = fs.existsSync(binPath);
const modelOk = fs.existsSync(modelOnnx);
console.log('[ensure_tts] sherpa 二进制:', binOk ? 'OK (' + binPath + ')' : '缺失');
console.log('[ensure_tts] MeloTTS 模型:', modelOk ? 'OK (' + modelOnnx + ')' : '缺失');
console.log('[ensure_tts] 结论:', (binOk && modelOk)
  ? 'MeloTTS 已就位，重启服务后自动优先使用'
  : 'MeloTTS 未就位，将回退 Piper/纯文字（运行 `npm run install:melo` 或手动放置 tts-bin/）');
process.exit(0);
