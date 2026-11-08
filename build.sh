#!/usr/bin/env bash
set -e

# 定位当前项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> [1/4] 检查并构建内嵌 Mutagen 静态组件（隔离至构建内部缓存）..."
ASSETS_DIR="bin/target/embedded_assets"
mkdir -p "$ASSETS_DIR/Local" "$ASSETS_DIR/VPS"

if [ ! -f "$ASSETS_DIR/Local/mutagen.exe" ] && [ ! -f "$ASSETS_DIR/Local/mutagen" ]; then
    echo "==> 编译 Mutagen 原生组件 (depends/mutagen)..."
    (cd depends/mutagen && go run scripts/build.go --mode=slim)
    if [ -f "depends/mutagen/build/mutagen.exe" ]; then
        cp depends/mutagen/build/mutagen.exe "$ASSETS_DIR/Local/mutagen.exe"
    else
        cp depends/mutagen/build/mutagen "$ASSETS_DIR/Local/mutagen"
    fi
    cp depends/mutagen/build/mutagen-agents.tar.gz "$ASSETS_DIR/Local/mutagen-agents.tar.gz"
    cp depends/mutagen/build/agent/linux_amd64 "$ASSETS_DIR/VPS/mutagen-agent"
fi

echo "==> [2/4] 执行 Cargo Release 编译 (产物自动存入 bin/target/)..."
cargo build --release

echo "==> [3/4] 分发单文件可执行程序与配套技能到 bin/Local/ 与 bin/VPS/..."
mkdir -p bin/Local bin/VPS

# 兼顾 Windows (.exe) 与 Linux 平台命名
if [ -f "bin/target/release/CodeBridgeLocal.exe" ]; then
    cp bin/target/release/CodeBridgeLocal.exe bin/Local/CodeBridgeLocal.exe
    cp bin/target/release/CodeBridgeVPS.exe bin/VPS/CodeBridgeVPS.exe
else
    cp bin/target/release/CodeBridgeLocal bin/Local/CodeBridgeLocal
    cp bin/target/release/CodeBridgeVPS bin/VPS/CodeBridgeVPS
fi

# 同步分发对应端的专属技能目录（开箱即用，自带 AI 技能说明书）
rm -rf bin/Local/skills bin/VPS/skills
mkdir -p bin/Local/skills bin/VPS/skills

# Local 交付包包含：本地客户端技能、全自动安装技能
cp -r skills/codebridge_local bin/Local/skills/
cp -r skills/codebridge_vps_install bin/Local/skills/

# VPS 交付包包含：云端服务端技能
cp -r skills/codebridge_vps bin/VPS/skills/

chmod +x bin/Local/CodeBridgeLocal* bin/VPS/CodeBridgeVPS* 2>/dev/null || true

# 彻底清理历史外露的中间目录，确保交付区绝无多余可执行程序
rm -rf bin/embedded 2>/dev/null || true

echo "==> [4/4] 构建与分发完成！输出程序就绪："
ls -la bin/Local/ bin/VPS/
