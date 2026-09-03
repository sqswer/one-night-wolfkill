'use strict';
// 下载并安装 MeloTTS（经 sherpa-onnx 推理）到 tts-bin/，把播报语音从 Piper 升级到
// 更自然的中文音色（44100Hz、pypinyin/g2p 音素化更准、中英混读更稳）。仅首次部署需要联网。
// 用法：
//   node scripts/install_melo.js            # 安装（已装则跳过）
//   node scripts/install_melo.js --force    # 强制重装
// 安装完成后重启服务即可生效（tts.js 检测到 melo 文件后自动优先使用）。
//
// 与 Piper 双引擎并存：本脚本不动 Piper 的任何文件。
//   想临时回退 Piper：设环境变量 TTS_PROVIDER=piper 后重启（不用删文件）；
//   想彻底卸载 MeloTTS：删掉 tts-bin/ 下的 sherpa-onnx-offline-tts(.exe)
//   与 vits-melo-tts-zh_en 目录即可，服务会自动回到 Piper。

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'tts-bin');
fs.mkdirSync(OUT, { recursive: true });

const FORCE = process.argv.includes('--force');
const SHERPA_VER = '1.13.7';
const GH = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const MODEL = 'vits-melo-tts-zh_en';
// 模型单独发布在 tts-models 这个 tag 下（不是 v1.13.7），来源：sherpa-onnx 官方 VOICES 文档
const MODEL_URL = `${GH}/tts-models/${MODEL}.tar.bz2`;

const isWin = process.platform === 'win32';
const BIN_NAME = 'sherpa-onnx-offline-tts' + (isWin ? '.exe' : '');

// 按系统/架构选 sherpa-onnx 二进制资产。
// ⚠️ 必须选「带 TTS 的可执行版」：名字里含 no-tts 的不含 sherpa-onnx-offline-tts，
//    含 -lib 的只有动态库没有可执行文件，两者都跑不起来。
function sherpaAsset() {
  const base = `${GH}/v${SHERPA_VER}/sherpa-onnx-v${SHERPA_VER}`;
  const p = process.platform, arch = process.arch;
  if (p === 'win32') {
    return arch === 'arm64'
      ? `${base}-win-arm64-shared-MT-Release.tar.bz2`
      : `${base}-win-x64-shared-MT-Release.tar.bz2`;
  }
  if (p === 'darwin') {
    return arch === 'arm64'
      ? `${base}-osx-arm64-shared.tar.bz2`
      : `${base}-osx-x64-shared.tar.bz2`;
  }
  if (arch === 'arm64') return `${base}-linux-aarch64-shared-cpu.tar.bz2`;
  return `${base}-linux-x64-shared.tar.bz2`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log('下载:', url);
    const f = fs.createWriteStream(dest);
    const get = (u) => https.get(u, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        f.close(); try { fs.unlinkSync(dest); } catch (_) {}
        return get(res.headers.location);
      }
      if (res.statusCode !== 200) {
        f.close(); try { fs.unlinkSync(dest); } catch (_) {}
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + u));
      }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0, lastPct = -1;
      res.on('data', d => {
        got += d.length;
        if (total) {
          const pct = Math.floor((got / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) {
            lastPct = pct;
            process.stdout.write(`\r  已下载 ${pct}% (${(got / 1048576).toFixed(1)}MB)`);
          }
        }
      });
      res.pipe(f);
      f.on('finish', () => {
        if (total) process.stdout.write(`\r  已下载 100% (${(got / 1048576).toFixed(1)}MB)\n`);
        f.close(() => resolve(dest));
      });
    }).on('error', e => { try { fs.unlinkSync(dest); } catch (_) {} reject(e); });
    get(url);
  });
}

function extract(archive, destDir) {
  console.log('解压:', path.basename(archive));
  execFileSync('tar', ['xf', archive, '-C', destDir], { stdio: 'inherit' });
}

// sherpa 的压缩包结构是 <pkg>/bin/ + <pkg>/lib/：
// 需要把 bin/ 里的可执行文件与 lib/ 里的动态库一起平铺到 tts-bin/ 根目录，
// 否则 shared 版二进制启动时找不到同目录的 .so/.dll（tts.js 只把 LD_LIBRARY_PATH 指到二进制同目录）。
function _flattenSherpa(dir) {
  if (fs.existsSync(path.join(dir, BIN_NAME))) return;   // 已在根目录，无需处理
  const findBinDir = (d) => {
    let entries;
    try { entries = fs.readdirSync(d); } catch (_) { return null; }
    for (const e of entries) {
      const full = path.join(d, e);
      let st; try { st = fs.statSync(full); } catch (_) { continue; }
      if (!st.isDirectory()) continue;
      if (e === 'bin' && fs.existsSync(path.join(full, BIN_NAME))) return full;
      const r = findBinDir(full); if (r) return r;
    }
    return null;
  };
  const binDir = findBinDir(dir);
  if (!binDir) {
    console.warn('⚠️ 未在压缩包中找到 bin/' + BIN_NAME + '，安装可能不完整');
    return;
  }
  const moveUp = (from) => {
    for (const f of fs.readdirSync(from)) {
      try { fs.renameSync(path.join(from, f), path.join(dir, f)); } catch (_) {}
    }
  };
  moveUp(binDir);
  const libDir = path.join(path.dirname(binDir), 'lib');
  if (fs.existsSync(libDir)) moveUp(libDir);   // 动态库（Windows 的 .dll 有时也放在 bin/ 里，已随上面一起上移）
}

(async () => {
  try {
    // 1) sherpa-onnx 二进制
    const binPath = path.join(OUT, BIN_NAME);
    if (fs.existsSync(binPath) && !FORCE) {
      console.log('✓ sherpa-onnx 二进制已存在，跳过（如需重装加 --force）');
    } else {
      const url = sherpaAsset();
      const archive = path.join(OUT, '_sherpa_dl.tar.bz2');
      await download(url, archive);
      // 校验确实是 bzip2（前 3 字节 'BZh'），否则多半下到了错误页
      const magic = fs.readFileSync(archive, { start: 0, end: 3 });
      if (!(magic[0] === 0x42 && magic[1] === 0x5a && magic[2] === 0x68)) {
        const peek = fs.readFileSync(archive, 'utf8').slice(0, 200).replace(/\s+/g, ' ');
        throw new Error('下载到的不是有效的 .tar.bz2（可能是错误页/被拦截）：' + peek);
      }
      extract(archive, OUT);
      fs.unlinkSync(archive);
      _flattenSherpa(OUT);
      if (!isWin) { try { fs.chmodSync(binPath, 0o755); } catch (_) {} }
      if (!fs.existsSync(binPath)) throw new Error('解压后未找到 ' + BIN_NAME);
      console.log('✓ sherpa-onnx 二进制已安装到', binPath);
    }

    // 2) MeloTTS 中文模型
    const modelDir = path.join(OUT, MODEL);
    const modelOnnx = path.join(modelDir, 'model.onnx');
    if (fs.existsSync(modelOnnx) && !FORCE) {
      console.log('✓ MeloTTS 模型已存在，跳过（如需重装加 --force）');
    } else {
      const archive = path.join(OUT, '_melo_model_dl.tar.bz2');
      await download(MODEL_URL, archive);
      const magic = fs.readFileSync(archive, { start: 0, end: 3 });
      if (!(magic[0] === 0x42 && magic[1] === 0x5a && magic[2] === 0x68)) {
        const peek = fs.readFileSync(archive, 'utf8').slice(0, 200).replace(/\s+/g, ' ');
        throw new Error('下载到的不是有效的 .tar.bz2（可能是错误页/被拦截）：' + peek);
      }
      extract(archive, OUT);
      fs.unlinkSync(archive);
      if (!fs.existsSync(modelOnnx)) {
        // 少数情况下包内多一层目录，做一次兜底查找
        const found = fs.readdirSync(OUT).find(d => fs.existsSync(path.join(OUT, d, 'model.onnx')));
        if (found && found !== MODEL) fs.renameSync(path.join(OUT, found), modelDir);
      }
      if (!fs.existsSync(modelOnnx)) throw new Error('解压后未找到 ' + modelOnnx);
      console.log('✓ MeloTTS 模型已安装:', MODEL);
    }

    // 3) 自检（--help 失败只警告：不同构建的 help 行为可能不同，不影响实际合成）
    try {
      execFileSync(binPath, ['--help'], { stdio: 'ignore' });
      console.log('✓ 二进制自检通过');
    } catch (_) {
      console.warn('⚠️ 二进制自检（--help）未通过，可能是该构建不支持此参数，以实际合成结果为准');
    }

    console.log('\n✅ 安装完成。重启服务后自动切换到 MeloTTS（tts.js 默认 melo 优先）。');
    console.log('   想对比/回退 Piper：设环境变量 TTS_PROVIDER=piper 后重启。');
  } catch (e) {
    console.error('\n❌ 安装失败:', e.message);
    console.error('若网络无法访问 GitHub，请手动下载以下文件并放到 tts-bin/：');
    console.error('  二进制:', sherpaAsset());
    console.error('          （解压后把 bin/ 的可执行文件与 lib/ 的动态库都平铺到 tts-bin/ 根目录）');
    console.error('  模型  :', MODEL_URL);
    console.error('          （解压后应得到 tts-bin/' + MODEL + '/，内含 model.onnx / lexicon.txt / tokens.txt）');
    process.exit(1);
  }
})();
