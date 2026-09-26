# DSH Agent Presets · DREAM-RSI 与标准首轮精简

本仓库提供两个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的**代理预设 bundle**。每个目录是一个普通的 npm 包，由 DSH 的 plugin-manager 通过 `install_bundle` 链接进 profile 的 `node_modules`，**不再**走旧的 `~/.dsh/.agent-presets/` 目录扫描路径。

- `dream-rsi/` —— 递归自我改进循环。给一段评估器，让 Agent 在预算内自动迭代方案。
- `standard-deferred/` —— 在标准模式基础上，把首轮工具集裁剪到核心几件，让模型先思考再展开。

## 预设一览

### `dream-rsi` —— DREAM-RSI 模式

按 A → B → C → D 循环迭代：

- **A 在线探索**：当前策略 `pi_t` 选合法批次，真实执行 `eval_cmd`，把结果写进发现树。
- **B 回放模拟器**：把历史目录中的发现树当作回放池 `H_t`，用 `replay/replay.py` 复演，不调真实评估器、不泄漏未揭示分数。
- **C Dreaming 策略改进**：从 `pi_t` 生成 M 个候选策略，分别在全部历史树上回放打分，按 V 选择 `pi_{t+1}`。
- **D 再部署**：把 `pi_{t+1}` 写入 `policies/pi_<t+1>.py`，下一轮在线探索使用。

所有状态都落在文件里，对话只做摘要。详细字段、触发词、硬约束见 [`dream-rsi/README.md`](./dream-rsi/README.md)。

### `standard-deferred` —— 标准模式 · 首轮精简

在 DSH 内置系统的 `standard` 预设之上叠加一个 `first-turn-minimal` 钩子：对一个全新会话的首次装配（log 中还没有 `step/start` 事件的那次），把模型可见的工具裁剪到 `ask_user_question` + shell + 读/写/编辑/glob/grep + `web_search` + `todo_write` + 后台作业控制，并在尾部追加一段提示，告诉模型完整工具集会在下一步自动恢复。

从第二轮开始注入完整工具（subagent、workflow、ralph、skill、goal、plan mode，以及重型文件工具）。

适合希望降低首轮工具噪声、避免模型一上来就误调重型工具的场景。详见 [`standard-deferred/README.md`](./standard-deferred/README.md)。

## Bundle 格式说明

每个预设目录都是一个标准的 npm 包：

```
<preset-id>/
├── package.json          # 必备：`dsh.bundle.patch` 指向 ./cordis.patch.yml
├── cordis.patch.yml      # 必备：cordis include 补丁文件（一条 @deepseek-ai/dsh-agent-preset 行）
├── <preset>.mjs          # 可选：函数插件，由 cordis.patch.yml 用相对路径引用
└── README.md             # 可选
```

- `package.json` 的 `dsh.bundle.patch` 字段告诉 DSH 这个包是一个 bundle，以及它的补丁文件位置（参考 [packages/bundle/web-app/package.json:41-50](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/bundle/web-app/package.json)）。
- `cordis.patch.yml` 是 `@deepseek-ai/cordis-plugin-include` 的 PatchOptions 列表。最外层是一条 `id: preset-<preset-id>`、`name: '@deepseek-ai/dsh-agent-preset'` 的 `insert` 行；其 `config.id` 是预设的展示身份，`config.plugins` 是激活时挂到 preset scope 的 agent-plane 行列表。
- 没有 `preset.yml` 了 —— `name` / `description` / `order` 字段直接写在 `cordis.patch.yml` 的 preset 行 `config:` 里。

> **为什么 `first-turn-minimal` 在顶层 insert 而不是 preset 内**：见 [standard-deferred/README.md §「钩子的两个 gate」](./standard-deferred/README.md)。简言之：dsh-app-boot 的 `anchorInsertedPluginNames` 只访问顶层 `patch.insert[]` 来锚定 `./xxx.mjs` 相对路径；放在 `config.plugins[]` 里时，路径会被 preset 激活时的 `ctx.baseUrl`（profile 目录）解析，导致「file not found」并把 preset 标为 broken。

## 安装与启用

### 前置条件

- 已安装 DeepSeek Harness（`dsh` 命令可用）。
- Node.js 与 DSH 所需的服务包。`@deepseek-ai/dsh-*` 系列插件通过已安装的 DSH 实例解析；本仓库两个 bundle 仅依赖用户本地文件系统中的 `package.json` + 补丁文件，不需要额外 npm 包。
- `DEEPSEEK_API_KEY`（或你部署使用的其他模型凭据）。

### 安装步骤

把整个仓库克隆或下载到你机器上的任意目录，然后在 DSH Web GUI 的任意会话里调用 `plugin_manager` 工具：

```text
plugin_manager
  action: install_bundle
  target: <绝对路径>/dream-rsi
```

```text
plugin_manager
  action: install_bundle
  target: <绝对路径>/standard-deferred
```

`install_bundle` 自己会做 pnpm `add file:<bundle-dir>`，把包加进当前 profile 的 `dependencies` 与 `dsh.profile.bundles`，并在 profile 的 `node_modules/@local/<name>` 路径下建立 junction 链接。不需要再手动 `cp -r` 或重启守护进程 —— HMR 监测到 `dsh.profile.bundles` 变化就会刷新 include 层（[packages/boot/hmr/src/index.ts:218-236](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/boot/hmr/src/index.ts#L218-L236)）。

如果你在启用的子进程里没看到新的 preset 出现在 Web GUI 的模式选择器中，浏览器按 **Ctrl + Shift + R** 强刷一次即可（preset roster 通过 `agentPresets.list()` 在 settings store 初始化时拉一次）。

### 仓库结构

```
.
├── README.md                      # 本文件
├── dream-rsi/
│   ├── package.json                # bundle 清单
│   ├── cordis.patch.yml            # @deepseek-ai/dsh-agent-preset 行 + preset 组成
│   ├── dream_rsi.yaml              # 任务级配置（由用户复制到任务工作目录后被 Agent 读取）
│   └── README.md                   # A→B→C→D 流程、触发词、字段、硬约束
└── standard-deferred/
    ├── package.json                # bundle 清单
    ├── cordis.patch.yml            # @deepseek-ai/dsh-agent-preset 行 + preset 组成
    ├── first-turn-minimal.mjs      # 首轮精简函数插件
    └── README.md                   # 钩子行为、配置、故障排查
```

### 验证发现

打开 DSH Web GUI，新建会话时在模式选择器里应当能看到：

- **DREAM-RSI 模式**
- **标准模式 · 首轮精简**

如果下拉列表里没出现，按下列顺序排查：

1. bundle 目录里 `package.json` 的 `dsh.bundle.patch` 是否正确指向 `cordis.patch.yml`（保持现有写法即可）。
2. `cordis.patch.yml` 是否存在且可读；DSH 会读它并校验每条 `name` 字段。
3. `cordis.patch.yml` 里命名的 `@deepseek-ai/dsh-*` 包是否在当前 DSH 进程的 `node_modules` 中可解析；解析不到的包会让 preset 标为 `broken` 并在下拉列表里隐藏（不显示错误）。
4. 看 DSH 日志（`$DSH_HOME/logs/startup-*.log`）里有没有 `agent-presets: preset "<id>" failed to mount: <reason>` 的报错。最常见的原因：
   - `cordis.patch.yml` 里的某个 `@deepseek-ai/...` 包未安装；
   - `disabled: !!js ...` 之类的 JS 表达式抛错；
   - 工具组（`cordis:group`）的 `isolate` 漏声明，导致 service 被发布到 root realm 触发 `leakedServices` 检查；
   - 相对路径 `./xxx.mjs` 没被锚定到 patch 文件目录（参见 [上一节](#为什么-first-turn-minimal-在顶层-insert-而不是-preset-内)）。

## 配置 `dream-rsi`

完整字段表与触发词模板见 [`dream-rsi/README.md`](./dream-rsi/README.md)。下面给出落地的最小步骤：

1. **复制任务配置模板**：把仓库里的 `dream-rsi/dream_rsi.yaml` 拷贝到任务工作目录（例如 `~/work/my-task/dream_rsi.yaml`）。这个文件不是预设本身的组成文件，而是 Agent 在每一轮开始时会主动读取的任务级配置。
2. **替换占位符**：填入 `task.name`、`task.metric`、`task.eval_cmd`、`paths.workdir` / `paths.history_dir` / `paths.current_best`，以及 `paths.allowed_paths` 中允许 Agent 修改的全部路径。
3. **确认 `paths.forbidden_paths`** 完整覆盖评估器、数据集、提交接口等不可触碰范围（这是 DREAM-RSI 硬约束的强制来源之一）。
4. **设置预算**：`budget.total_calls`、`budget.total_time`、`budget.total_rounds`，以及 `budget.dreaming_candidates`（每轮候选策略数 M）。并行度调 `parallelism.W`。
5. 在 DSH Web GUI 中选择 **DREAM-RSI 模式**，新建会话，先发初始化触发词，再按 `budget.total_rounds` 每轮替换 `{t}` 发标准触发词。
6. 预算耗尽 / 目标达成后，发收尾触发词；只想做离线策略 dreaming 时，使用「仅 dreaming / 回放」触发词。

如果安装对应的 Bundle（如 Codex / Claude Code 行），去掉 `cordis.patch.yml` 里相应 `disabled: true` 行即可启用对应的子代理提供者。

## 配置 `standard-deferred`

该预设在 DSH 行为层面没有需要填空的任务级文件，但支持按下列行为定制（详见 [`standard-deferred/README.md`](./standard-deferred/README.md)）：

- **调整首轮保留的工具**：编辑 `standard-deferred/cordis.patch.yml` 中 `first-turn-minimal` 行的 `minimalTools` 列表，按需增删。
- **完全关闭首轮精简**：把 `cordis.patch.yml` 中整个 `first-turn-minimal` 顶层行删掉，该预设就退化为内置 `standard` 预设。
- **启用 Codex / Claude Code 子代理**：去掉 `cordis.patch.yml` 中 `tool-subagent-codex` / `tool-subagent-claude-code` 两行的 `disabled: true`，并在 DSH Profile 中安装对应 Bundle。

修改完成后保存即可，DSH 的 include 层是 live 读取的，下次新会话发起时生效。

## 协议与贡献

本仓库以 MIT 协议发布，包含的全部 YAML、ESM 与文档可自由使用、修改、再发布。在你自己的项目中使用这两个预设时，请保留 `cordis.patch.yml` 头部注释里关于原作者与 DREAM-RSI 论文来源的标注。

欢迎以 PR 形式提交：

- 新预设（在 `<your-preset>/` 下提交 `package.json` + `cordis.patch.yml` + README，按 `dream-rsi/` 或 `standard-deferred/` 的写法套）。
- 对现有预设的 bug fix、文档改进、默认参数调整。
- 真实任务上的 DREAM-RSI 评测案例与配置示例（作为 issue 附件提交即可）。