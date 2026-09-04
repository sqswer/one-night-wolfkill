#!/usr/bin/env bash
###############################################################################
# Bonto 终端一键下载安装 TTS 引擎到 tts-bin/（MeloTTS + Piper 双引擎）
#
# 适用场景：Bonto 容器（Linux x64 / glibc / bookworm）。
#   - Web 上传单文件上限 1M，159MB 的 MeloTTS 模型无法手动传；
#   - 直连 GitHub 常被墙/超时，故统一走国内镜像（ghproxy.net）。
#   - 容器内 tar 默认调 lbzip2 会报 "Cannot exec"，脚本已内置 bzip2/apt/python3 兜底解压。
#
# ★ 幂等：目标文件已存在则跳过下载（--force 可强制重装）。
#   配合「持久卷挂到 /app/src/tts-bin」后，每次容器重建只需重跑本脚本，
#   已落盘的文件立即命中、秒过，不必再联网下载。
#
# 用法（在容器 /app/src 目录下执行；本脚本随仓库同步到容器，直接 bash 即可）：
#   bash scripts/bonto-download-tts.sh            # 装 MeloTTS + Piper（双引擎）
#   bash scripts/bonto-download-tts.sh melo       # 只装 MeloTTS
#   bash scripts/bonto-download-tts.sh piper      # 只装 Piper
#   bash scripts/bonto-download-tts.sh --force    # 强制重装双引擎
#
# 自定义卷路径（Bonto 把卷挂到非默认位置时）：
#   TTS_BIN_DIR=/data/tts-bin bash scripts/bonto-download-tts.sh melo
#   → 文件写入该卷；脚本结尾会打印需在 Bonto 设置的 4 个环境变量。
#
# 若 ghproxy.net 下载 0%：把下面 MIRROR 改成 https://gh.api.99988866.xyz 再跑。
# 装完后重启服务： kill <旧PID> ; nohup npm start > logs/server.out.log 2>&1 &
###############################################################################

set -u
cd "$(dirname "$0")/.." || exit 1          # 切到项目根（/app/src）

# 目标目录：默认 tts-bin（即 /app/src/tts-bin，建议把持久卷挂这里）；
# 也可由 TTS_BIN_DIR 指向自定义挂载点。
BIN_DIR="${TTS_BIN_DIR:-tts-bin}";  mkdir -p "$BIN_DIR"
DL_DIR="_dl";                     mkdir -p "$DL_DIR"

MIRROR="https://ghproxy.net"               # GitHub 镜像前缀
gh() { echo "${MIRROR%/}/${1#https://}"; } # 原始 https://github.com/... → 镜像

# ---------- 安全解压（避开 bookworm 默认 lbzip2 缺失）----------
extract_bz2() {
  f="$1"; dest="$2"
  tar --use-compress-program=bzip2 -xf "$f" -C "$dest" 2>/dev/null && return 0
  if command -v apt-get >/dev/null; then
    apt-get update >/dev/null 2>&1 && apt-get install -y bzip2 >/dev/null 2>&1 \
      && tar --use-compress-program=bzip2 -xf "$f" -C "$dest" 2>/dev/null && return 0
  fi
  command -v python3 >/dev/null && python3 -c "import tarfile;tarfile.open('$f').extractall('$dest')" && return 0
  echo "解压失败: $f"; return 1
}
extract_gz() {
  tar xzf "$1" -C "$2" 2>/dev/null && return 0
  command -v python3 >/dev/null && python3 -c "import tarfile;tarfile.open('$1').extractall('$2')" && return 0
  echo "解压失败: $1"; return 1
}

# ---------- 已存在判定（幂等核心）----------
melo_present() {
  [ -x "$BIN_DIR/sherpa-onnx-offline-tts" ] \
    && [ -d "$BIN_DIR/vits-melo-tts-zh_en" ] \
    && [ -f "$BIN_DIR/vits-melo-tts-zh_en/model.onnx" ]
}
piper_present() {
  [ -x "$BIN_DIR/piper" ] && [ -f "$BIN_DIR/zh_CN-huayan-medium.onnx" ]
}

# ---------- MeloTTS（sherpa-onnx，44100Hz，默认优先引擎）----------
install_melo() {
  if [ "${FORCE:-0}" != "1" ] && melo_present; then
    echo "✓ MeloTTS 已存在 ($BIN_DIR)，跳过下载（--force 可强制重装）"
    return 0
  fi
  echo "=== 安装 MeloTTS (sherpa-onnx) ==="
  SHERPA_URL="$(gh 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.7/sherpa-onnx-v1.13.7-linux-x64-shared.tar.bz2')"
  MODEL_URL="$(gh 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2')"

  curl -fL "$SHERPA_URL" -o "$DL_DIR/sherpa.tar.bz2"
  if [ "$(head -c3 "$DL_DIR/sherpa.tar.bz2")" != "BZh" ]; then
    echo "✗ sherpa 二进制下载异常（非 bz2，可能下到错误页/被拦截）："; head -c 200 "$DL_DIR/sherpa.tar.bz2"; exit 1
  fi
  extract_bz2 "$DL_DIR/sherpa.tar.bz2" "$DL_DIR" || exit 1

  curl -fL "$MODEL_URL" -o "$DL_DIR/melo.tar.bz2"
  if [ "$(head -c3 "$DL_DIR/melo.tar.bz2")" != "BZh" ]; then
    echo "✗ melo 模型下载异常（非 bz2）："; head -c 200 "$DL_DIR/melo.tar.bz2"; exit 1
  fi
  extract_bz2 "$DL_DIR/melo.tar.bz2" "$DL_DIR" || exit 1

  SH=$(ls -d "$DL_DIR"/sherpa-onnx-*-linux-x64-shared 2>/dev/null | head -1)
  [ -z "$SH" ] && { echo "✗ 未找到解压出的 sherpa 目录"; exit 1; }
  cp "$SH/bin/"* "$BIN_DIR/" 2>/dev/null
  cp "$SH/lib/"* "$BIN_DIR/" 2>/dev/null
  cp -r "$DL_DIR/vits-melo-tts-zh_en" "$BIN_DIR/" 2>/dev/null
  chmod +x "$BIN_DIR/sherpa-onnx-offline-tts" 2>/dev/null
  echo "✓ MeloTTS 安装完成"
}

# ---------- Piper（本地自托管，零依赖回退引擎）----------
install_piper() {
  if [ "${FORCE:-0}" != "1" ] && piper_present; then
    echo "✓ Piper 已存在 ($BIN_DIR)，跳过下载（--force 可强制重装）"
    return 0
  fi
  echo "=== 安装 Piper ==="
  PIPER_URL="$(gh 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz')"
  curl -fL "$PIPER_URL" -o "$DL_DIR/piper.tar.gz"
  if ! gzip -tq "$DL_DIR/piper.tar.gz" 2>/dev/null; then
    echo "✗ piper 二进制下载异常（非 gzip，可能下到错误页/被拦截）："; head -c 200 "$DL_DIR/piper.tar.gz"; exit 1
  fi
  extract_gz "$DL_DIR/piper.tar.gz" "$DL_DIR" || exit 1

  PSUB=$(find "$DL_DIR" -type f -name piper 2>/dev/null | head -1)
  [ -z "$PSUB" ] && { echo "✗ 未找到 piper 二进制"; exit 1; }
  cp -r "$(dirname "$PSUB")/." "$BIN_DIR/" 2>/dev/null
  chmod +x "$BIN_DIR/piper" 2>/dev/null

  # 中文模型（HuggingFace，走 hf-mirror.com 兜底）
  VOICE="zh/zh_CN/huayan/medium/zh_CN-huayan-medium"
  HF="https://huggingface.co/rhasspy/piper-voices/resolve/main"
  HFM="https://hf-mirror.com/rhasspy/piper-voices/resolve/main"
  for ext in onnx onnx.json; do
    out="$BIN_DIR/zh_CN-huayan-medium.$ext"
    curl -fL "$HF/$VOICE.$ext" -o "$out" || curl -fL "$HFM/$VOICE.$ext" -o "$out"
    if [ ! -s "$out" ]; then echo "✗ piper 模型下载失败: $ext"; rm -f "$out"; fi
  done
  echo "✓ Piper 安装完成"
}

# ---------- 参数解析 ----------
FORCE=0; ENGINE="all"
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    melo|piper|all) ENGINE="$a" ;;
    *) echo "用法: bash $0 [melo|piper|all] [--force]"; exit 1 ;;
  esac
done
case "$ENGINE" in
  melo)  install_melo ;;
  piper) install_piper ;;
  all)   install_melo; install_piper ;;
esac

rm -rf "$DL_DIR"

# 若用了自定义卷路径，导出给 tts.js 的 4 个环境变量并提示写入 Bonto
if [ -n "${TTS_BIN_DIR:-}" ]; then
  export SHERPA_BIN="$BIN_DIR/sherpa-onnx-offline-tts"
  export MELO_MODEL_DIR="$BIN_DIR/vits-melo-tts-zh_en"
  export PIPER_BIN="$BIN_DIR/piper"
  export PIPER_MODEL="$BIN_DIR/zh_CN-huayan-medium.onnx"
  echo
  echo "=== 自定义卷路径：请在 Bonto 环境变量中添加 ==="
  echo "  SHERPA_BIN=$SHERPA_BIN"
  echo "  MELO_MODEL_DIR=$MELO_MODEL_DIR"
  echo "  PIPER_BIN=$PIPER_BIN"
  echo "  PIPER_MODEL=$PIPER_MODEL"
fi

echo
echo "=== 校验 ==="
node -e "console.log('provider =', require('./tts').PROVIDER)" 2>/dev/null || echo "(node 校验跳过)"
echo "记得重启服务使新引擎生效： kill <旧PID> ; nohup npm start > logs/server.out.log 2>&1 &"
