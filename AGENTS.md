# CodeBridge 项目工作指南

本文件适用于整个仓库。涉及部署、挂载或安全行为时，先阅读 `docs/deployment.md` 和 `docs/security-and-testing.md`。

## 写操作与目录创建（强制）

- 执行任何写操作前，必须先说明具体目标、操作和影响范围，并取得用户明确确认允许；未经确认，只能进行只读检查、分析和方案说明。
- 写操作包括新建、修改、覆盖、移动、重命名、删除文件或目录，安装依赖，生成构建或测试产物，以及提交、推送、部署等。运行会产生文件或目录的命令，也属于写操作。
- 用户授权仅覆盖已明确确认的目标和范围；扩大范围或改用涉及其他写入目标的方案，必须重新取得确认。不得将只读分析请求视为写入授权。
- 自动编码过程中，不允许创建未经用户允许的目录，包括临时目录、缓存目录、日志目录、工具链目录、依赖源码目录和构建目录；不得通过移到仓库外规避此规则。
- 项目根目录保留 `.venv/`、`docs/`、`local_client/`、`remote_server/`、`tests/`、`AGENTS.md`、`.gitignore` 和用户明确指定的 `ssh_remote`；Git 元数据 `.git` 保留。目录名称保持原样，未经允许不得重命名或新增其他根目录项目。

## Agent 远端访问

- 仓库根目录的 [`ssh_remote`](ssh_remote) 是 Agent 远端 SSH 连接说明与凭据文件，采用 JSON 格式，记录服务器地址、端口、账号、密码、已确认的主机密钥指纹及远端项目路径。
- 用户已明确授权将这台测试服务器的密码保存在本私有仓库的 `ssh_remote` 中。后续 Agent 在其他电脑克隆仓库后，先读取此文件获取连接信息，无需依赖此前聊天记录。不得在回答、日志或命令行参数中输出密码。
- 只读连接与检查优先使用本机已有 SSH 工具；通过 Python 访问时使用本仓库根目录 `.venv` 中的解释器。缺少环境、依赖或工具时，先请求用户确认再创建或安装，不自动新增目录。
- 新电脑的 `known_hosts` 可能没有该服务器记录，仍必须在发送密码前按 `ssh_remote` 中的主机密钥算法及 SHA-256 指纹校验服务器身份；不匹配时停止，不关闭主机校验或自动接受新密钥。
- `remote` 中的路径是已知部署位置，连接后先只读核对。文件中保存凭据不授予远端写入权限：修改、上传、删除、新建目录、安装及部署等仍受上面的确认规则约束。
- `ssh_remote` 用于 Agent 运维调试；应用运行时的密码处理规则保持独立。此文件的提交和推送仍须用户明确授权。

## Python 运行环境契约（强制）

- Python 运行环境必须部署在**当前仓库根目录的 `./.venv`**，不能放到子目录、仓库外部或其他名称的目录中。
- 项目使用 Python 3.10+。运行项目 Python 代码、安装 Python 依赖、执行测试和 Python 开发工具时，必须使用该 `.venv` 的解释器。
- Linux/macOS 使用 `./.venv/bin/python`；Windows 使用 `.\.venv\Scripts\python.exe`。命令和脚本优先显式指定解释器路径，不依赖 shell 是否激活环境。
- Python 依赖统一通过该解释器的 `-m pip` 安装，客户端依赖以 `local_client/requirements.txt` 为准。禁止向系统或全局 Python 安装项目依赖，禁止使用 `pip install --user`、外部虚拟环境或 Conda 环境替代本项目环境。
- 系统 Python 可用于环境探测和创建 `./.venv`。环境缺失时先创建，再运行项目命令；环境损坏或不兼容时报告原因，不得静默回退到系统 Python，也不得擅自删除已有环境。
- `.venv/` 已被 `.gitignore` 忽略。不得提交环境目录，不得跨操作系统复制复用环境；新增启动器、部署脚本和文档命令也必须遵守上述路径约定。

在仓库根目录准备开发环境：

```sh
python3 -m venv .venv
./.venv/bin/python -m pip install -r local_client/requirements.txt
```

Windows PowerShell：

```powershell
py -3 -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -r .\local_client\requirements.txt
```

以上仅准备 Python 环境；rclone、Tkinter、SSHFS/FUSE 等平台依赖按部署指南处理。

## 项目结构

- `local_client/app.py`：本地 HTTP 控制端、API 和浏览器启动入口。
- `local_client/bridge.py`：代理、SSH、rclone SFTP 标准流通道和连接生命周期。
- `local_client/trust.py`：首次信任确认和服务器身份记录。
- `local_client/diagnostics.py`、`picker.py`：连接诊断和可选原生目录选择器。
- `local_client/web/`：原生 HTML/CSS/JavaScript 中文界面，无前端构建步骤。
- `remote_server/mount.py`：按连接运行的远端 SSHFS 挂载、读写验证和清理。
- `local_client/scripts/`、`remote_server/scripts/`：Windows、Linux、macOS 部署脚本。
- `tests/`：Python `unittest` 单元测试和可选真实集成测试。
- `docs/`：部署说明、安全边界和实际验证记录。

## 运行与验证

在仓库根目录执行：

```sh
./.venv/bin/python -m local_client.app
./.venv/bin/python -m unittest discover -s tests -v
```

Windows 使用 `& .\.venv\Scripts\python.exe` 替换上述解释器路径。

需要验证真实 rclone 协议或 Linux FUSE 挂载时，显式开启集成测试：

```sh
CODEBRIDGE_TEST_RCLONE="$(command -v rclone)" ./.venv/bin/python -m unittest discover -s tests -v
```

- 集成测试需要可用的 rclone；真实挂载还需要 Linux、SSHFS/FUSE 和可访问的 `/dev/fuse`，具体以测试条件和运行结果为准。
- 根据改动运行相关检查；纯文档修改检查差异和命令一致性即可。跳过的测试与未做的 Windows/macOS 实机验收必须如实说明，不能将历史验证结果当成本次结果。
- 修改跨平台部署脚本时保持三平台行为一致，只运行本机适用的安装命令。依赖探测可使用脚本的 `--check` 或 Windows `-CheckOnly`。

## 实现与安全约束

- 保持现有 Python 标准库服务、Paramiko 和原生前端架构；沿用相邻代码风格，避免无关重构或新增构建系统。
- 连接方向是本地主动 SSH 到远端；远端使用真实文件系统挂载，不是目录同步，不增加远端网页、常驻 Agent 或额外监听端口。
- 本地 HTTP 仅监听 `127.0.0.1`，保留临时令牌与 Host/Origin 校验。应用运行时接收的 SSH 密码不得持久化、记录日志或进入命令行；用户明确授权的 Agent 运维凭据仅保存在 `ssh_remote`，其提交和推送仍需单独授权。
- 保持密码发送前的服务器身份确认；身份变化必须拒绝连接，显式代理失败不得自动直连。
- 数据通道 stdout 只承载二进制 SFTP，远端状态通过 stderr 传递。挂载失败不得用普通空目录冒充成功，读写验证必须覆盖本地写回和临时文件清理。
- 不擅自修改 SSH、防火墙、系统安全策略或 FUSE 权限；不擅自删除共享目录、挂载点、用户配置或待恢复缓存。
- 只有用户明确要求时才递增版本、创建版本分支、合并或发布；提交和推送也需用户明确授权。
