'use strict';
// 下载并安装 Piper TTS 二进制 + 中文模型到 tts-bin/（仅首次部署需要联网）。
// 用法：
//   node scripts/install_piper.js            # 默认中文女声 huayan
//   node scripts/install_piper.js chaowen    # 中文女声 chaowen
//   node scripts/install_piper.js xiao_ya    # 中文女声 xiao_ya
// 安装完成后重启服务（无需设 TTS_PROVIDER，检测到文件即自动启用 Piper）。
// 二进制来自 GitHub Releases（rhasspy/piper，MIT）；中文模型来自 HuggingFace（rhasspy/piper-voices）。

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tts-bin');
fs.mkdirSync(OUT, { recursive: true });

// 可用中文模型（HuggingFace 路径段）：zh/zh_CN/<name>/medium/zh_CN-<name>-medium.onnx
const VOICES = {
  huayan:   'huayan',
  chaowen:  'chaowen',
  xiao_ya:  'xiao_ya',
};
const arg = (process.argv[2] || 'huayan').toLowerCase();
const name = VOICES[arg] || 'huayan';
const modelFile = `zh_CN-${name}-medium.onnx`;

// Piper 二进制 release（按系统/架构选资产）；注意发布标签是日期格式，非 v1.2.0
const PIPER_TAG = '2023.11.14-2';
function piperAsset() {
  const p = process.platform, arch = process.arch;
  if (p === 'win32') return { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/piper_windows_amd64.zip`, ext: 'zip' };
  if (p === 'darwin') return arch === 'arm64'
    ? { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/piper_macos_aarch64.tar.gz`, ext: 'tgz' }
    : { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/piper_macos_x64.tar.gz`, ext: 'tgz' };
  if (arch === 'arm64') return { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/piper_linux_aarch64.tar.gz`, ext: 'tgz' };
  return { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/piper_linux_x86_64.tar.gz`, ext: 'tgz' };
}

// 中文模型（HuggingFace，需 .onnx 与 .onnx.json 各一份）
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
const voiceBase = `${HF}/zh/zh_CN/${name}/medium`;
const voiceFiles = [`${voiceBase}/${modelFile}`, `${voiceBase}/${modelFile}.json`];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log('下载:', url);
    const f = fs.createWriteStream(dest);
    const get = (u) => https.get(u, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        f.close(); try { fs.unlinkSync(dest); } catch (_) {}
        return get(res.headers.location);
      }
      if (res.statusCode !== 200) { f.close(); try { fs.unlinkSync(dest); } catch (_) {} return reject(new Error('HTTP ' + res.statusCode + ' for ' + u)); }
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest)));
    }).on('error', e => { try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
    get(url);
  });
}

function extract(archive, destDir) {
  console.log('解压:', archive);
  execFileSync('tar', ['xf', archive, '-C', destDir], { stdio: 'inherit' });
}

(async () => {
  try {
    // 1) Piper 二进制
    const a = piperAsset();
    const binArchive = path.join(OUT, 'piper_archive.' + (a.ext === 'zip' ? 'zip' : 'tgz'));
    await download(a.url, binArchive);
    extract(binArchive, OUT);
    if (process.platform !== 'win32') {
      const binPath = path.join(OUT, 'piper');
      try { fs.chmodSync(binPath, 0o755); } catch (_) {}
    }
    fs.unlinkSync(binArchive);
    console.log('✓ Piper 二进制已安装到', OUT);

    // 2) 中文模型（onnx + onnx.json）
    for (const vf of voiceFiles) {
      const dest = path.join(OUT, path.basename(vf));
      await download(vf, dest);
    }
    const onnx = path.join(OUT, modelFile);
    if (!fs.existsSync(onnx)) throw new Error('未找到模型文件: ' + onnx);
    console.log('✓ 中文模型已安装:', name, '(' + modelFile + ')');

    // 3) 自检
    const binName = process.platform === 'win32' ? 'piper.exe' : 'piper';
    const binFull = path.join(OUT, binName);
    execFileSync(binFull, ['--help'], { stdio: 'ignore' });
    console.log('\n✅ 安装完成。重启服务（TTS_PROVIDER 无需设置，检测到文件即自动启用），浏览器 Ctrl+Shift+R 硬刷新即可使用本地免费 TTS。');
  } catch (e) {
    console.error('\n❌ 安装失败:', e.message);
    console.error('若网络无法访问 GitHub/HuggingFace，请手动下载以下文件并放到 tts-bin/：');
    console.error('  二进制:', piperAsset().url);
    for (const vf of voiceFiles) console.error('  模型  :', vf);
    console.error('然后确保 tts-bin/ 下存在 piper(或piper.exe) 与 ' + modelFile + ' 及 ' + modelFile + '.json');
    process.exit(1);
  }
})();
