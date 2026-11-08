#!/usr/bin/env bash
set -e

# 定位当前项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> [1/4] 检查并构建内嵌 Mutagen 静态组件..."
mkdir -p bin/embedded/Local bin/embedded/VPS

if [ ! -f "bin/embedded/Local/mutagen.exe" ] && [ ! -f "bin/embedded/Local/mutagen" ]; then
    echo "==> 编译 Mutagen 原生组件 (depends/mutagen)..."
    (cd depends/mutagen && go run scripts/build.go --mode=slim)
    if [ -f "depends/mutagen/build/mutagen.exe" ]; then
        cp depends/mutagen/build/mutagen.exe bin/embedded/Local/mutagen.exe
    else
        cp depends/mutagen/build/mutagen bin/embedded/Local/mutagen
    fi
    cp depends/mutagen/build/mutagen-agents.tar.gz bin/embedded/Local/mutagen-agents.tar.gz
    cp depends/mutagen/build/agent/linux_amd64 bin/embedded/VPS/mutagen-agent
fi

echo "==> [2/4] 执行 Cargo Release 编译 (产物自动存入 bin/target/)..."
cargo build --release

echo "==> [3/4] 分发单文件可执行程序到 bin/Local/ 与 bin/VPS/..."
mkdir -p bin/Local bin/VPS

# 兼顾 Windows (.exe) 与 Linux 平台命名
if [ -f "bin/target/release/CodeBridgeLocal.exe" ]; then
    cp bin/target/release/CodeBridgeLocal.exe bin/Local/CodeBridgeLocal.exe
    cp bin/target/release/CodeBridgeVPS.exe bin/VPS/CodeBridgeVPS.exe
else
    cp bin/target/release/CodeBridgeLocal bin/Local/CodeBridgeLocal
    cp bin/target/release/CodeBridgeVPS bin/VPS/CodeBridgeVPS
fi

chmod +x bin/Local/* bin/VPS/* 2>/dev/null || true

echo "==> [4/4] 构建与分发完成！输出程序就绪："
ls -la bin/Local/ bin/VPS/
