---
name: codebridge_vps
description: 管理和巡检 CodeBridge VPS 云端服务端。负责云端待命服务启停、项目独占台账管理、端口防冲突检查与状态巡检。
---

# CodeBridge 云端服务端管理技能

作为 CodeBridge 云端运维管理员，负责调度和管理 `CodeBridgeVPS` 服务端程序，保障远端 AI Agent 拥有稳定、独立的开发与调试环境。

## 适用场景

当需要在云端 VPS 上准备待命环境、初始化资源台账、巡检端口 TCP 连通性、登记或释放项目独占资源、排查多端目录冲突时调用本技能。若尚未在远端安装程序或打通免密，请优先调用 `/codebridge_vps_install`。

## 执行流程与规范

### 1. 执行模式与程序定位
- **程序路径智能定位**：优先查找云端安装目录（`~/codebridge/CodeBridgeVPS`、`/root/CodeBridgeVPS`）或通过 `which CodeBridgeVPS` 查找，绝不硬编码单一路径；
- **开发机远程代管**：若当前在本地开发机，自动从项目 `vps_ssh.config`、`~/.ssh/config` 或提示词中提取 VPS IP，通过免密 SSH 通道（`ssh <VPS_IP> "<程序路径> <命令>"`）在远端自动执行；
- **本机即 VPS**：若当前终端本身就在云端 VPS 上，直接调用定位到的本地可执行程序。

### 2. 核心指令调度
- **启动待命服务 (`start`)**：
  - 执行 `CodeBridgeVPS start [--name <服务名>]`；
  - 自动释放就绪内置的 Mutagen Agent 组件并初始化独占台账。
- **状态与连通巡检 (`status`)**：
  - 执行 `CodeBridgeVPS status [--vps-path <路径>]`；
  - 真实探测本地 `127.0.0.1` 映射端口的 TCP Socket 连通性，汇报实际可达性与完整调试网址。
- **资源独占登记 (`reserve`)**：
  - 执行 `CodeBridgeVPS reserve --local-id <主机> --vps-path <路径> [--vps-port <端口>]`；
  - 原子校验父子目录嵌套与系统端口占用，重叠时严正拒绝，杜绝踩踏。
- **释放资源与停止 (`release` / `stop`)**：
  - `release` 解绑指定目录；
  - `stop` 确认无活跃任务后安全关停服务，保留所有工程代码。

### 3. 结果呈现与防护
命令输出统一转译为简短大白话与 Markdown 表格。严禁清空外部自建服务的端口，不可粗暴关闭 SSH 服务。
