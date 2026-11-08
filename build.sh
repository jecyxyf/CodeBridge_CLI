#!/usr/bin/env bash
set -e

# 定位当前项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> [1/3] 执行 Cargo Release 编译 (产物自动存入 bin/target/)..."
cargo build --release

echo "==> [2/3] 分发可执行程序到 bin/Local/ 与 bin/VPS/..."
mkdir -p bin/Local bin/VPS
cp bin/target/release/CodeBridgeLocal bin/Local/CodeBridgeLocal
cp bin/target/release/CodeBridgeVPS bin/VPS/CodeBridgeVPS

chmod +x bin/Local/CodeBridgeLocal bin/VPS/CodeBridgeVPS

echo "==> [3/3] 构建与分发完成！输出程序就绪："
ls -la bin/Local/CodeBridgeLocal bin/VPS/CodeBridgeVPS
