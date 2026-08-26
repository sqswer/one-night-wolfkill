'use strict';
// 下载并安装 Piper TTS 二进制 + 中文模型到 tts-bin/（仅首次部署需要联网）。
// 用法：
//   node scripts/install_piper.js            # 自动按当前系统选择二进制，默认中文女声 huayan
//   node scripts/install_piper.js taiping    # 改用男声 zh_CN-taiping-zhong
// 安装完成后，确保设置了环境变量 TTS_PROVIDER=piper（或不设：检测到文件后自动启用）。
// 二进制与模型均来自 GitHub Releases（rhasspy/piper、rhasspy/piper-voices），MIT 协议、免费。

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tts-bin');
fs.mkdirSync(OUT, { recursive: true });

const VOICE_ARG = process.argv[2] || 'huayan';
// 可选中文模型（名字 -> piper-voices 资产名）
const VOICES = {
  huayan:  { file: 'zh_CN-huayan-medium',     label: '中文女声·华嫣' },
  taiping: { file: 'zh_CN-taiping-zhong',     label: '中文男声·太平' },
  jiangtao: { file: 'zh_CN-jiangtao-zhong',   label: '中文男声·江涛' },
};
const voice = VOICES[VOICE_ARG] || VOICES.huayan;

// Piper 二进制 release（按系统/架构选资产）
const PIPER_VER = 'v1.2.0';
function piperAsset() {
  const p = process.platform, arch = process.arch;
  if (p === 'win32') return { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/piper_windows_amd64.zip`, ext: 'zip' };
  if (p === 'darwin') return arch === 'arm64'
    ? { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/piper_macos_aarch64.tar.gz`, ext: 'tgz' }
    : { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/piper_macos_x86_64.tar.gz`, ext: 'tgz' };
  // linux
  if (arch === 'arm64') return { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/piper_linux_aarch64.tar.gz`, ext: 'tgz' };
  return { url: `https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/piper_linux_x86_64.tar.gz`, ext: 'tgz' };
}

const VOICE_VER = 'v1.0.0';
const voiceUrl = `https://github.com/rhasspy/piper-voices/releases/download/${VOICE_VER}/${voice.file}.tar.gz`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log('下载:', url);
    const f = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        f.close(); fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { f.close(); fs.unlinkSync(dest); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); }
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest)));
    }).on('error', e => { try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
  });
}

function extract(archive, destDir) {
  // 使用系统 tar（可处理 .tar.gz 与 .zip）；Windows 10+ 自带 tar.exe
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

    // 2) 中文模型
    const modelArchive = path.join(OUT, 'voice.tar.gz');
    await download(voiceUrl, modelArchive);
    extract(modelArchive, OUT);
    fs.unlinkSync(modelArchive);
    const onnx = path.join(OUT, voice.file + '.onnx');
    if (!fs.existsSync(onnx)) throw new Error('未找到模型文件: ' + onnx + '（解压后文件名可能变化，请检查 tts-bin/）');
    console.log('✓ 中文模型已安装:', voice.label, '(' + voice.file + '.onnx)');

    // 3) 自检
    const binName = process.platform === 'win32' ? 'piper.exe' : 'piper';
    const binFull = path.join(OUT, binName);
    execFileSync(binFull, ['--help'], { stdio: 'ignore' });
    console.log('\n✅ 安装完成。设置环境变量 TTS_PROVIDER=piper（或不设，检测到文件即自动启用），重启服务即可使用本地免费 TTS。');
  } catch (e) {
    console.error('\n❌ 安装失败:', e.message);
    console.error('若网络无法访问 GitHub，请手动下载以下文件并放到 tts-bin/：');
    console.error('  二进制:', piperAsset().url);
    console.error('  模型  :', voiceUrl);
    console.error('然后确保 tts-bin/ 下存在 piper(或piper.exe) 与 ' + voice.file + '.onnx');
    process.exit(1);
  }
})();
