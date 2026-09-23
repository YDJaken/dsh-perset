# DSH Agent Presets · DREAM-RSI 与标准首轮精简

本仓库提供两个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的代理预设（Agent Preset），可以直接放进本地 `~/.dsh/.agent-presets/` 目录启用，不需要修改 DSH 源码或重新打包。

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

适合希望降低首轮工具噪声、避免模型一上来就误调重型工具的场景。

## 安装与启用

### 前置条件

- 已安装 DeepSeek Harness（`dsh` 命令可用）。
- Node.js 与 DSH 所需的服务包（DREAM-RSI 默认不需要 `Codex` / `Claude Code` Bundle；如需启用，参见 `agent.cordis.yml` 末尾 `disabled` 行）。
- `DEEPSEEK_API_KEY`（或其他由你部署使用的模型凭据）。

### 放置位置

DSH 的代理预设发现会扫描 `<dshHome>/.agent-presets/` 的直接子目录。子目录名 = 预设 ID；每个目录里必须包含 `agent.cordis.yml`（组成声明），可选 `preset.yml` 提供展示元数据（`name` / `description` / `order`）。

默认 `<dshHome>` 是 `~/.dsh`，可通过环境变量 `DSH_HOME` 改写。

把两个目录拷贝到本机 `~/.dsh/.agent-presets/` 即可：

```sh
git clone <this-repo>
mkdir -p ~/.dsh/.agent-presets
cp -r <this-repo>/dream-rsi        ~/.dsh/.agent-presets/
cp -r <this-repo>/standard-deferred ~/.dsh/.agent-presets/
```

目录拷贝完成后 DSH 会自动重新发现，不需要重启守护进程。如果发现没有刷新，参照 `dsh` 的重启步骤。

### 仓库结构

```
.agent-presets/
├── dream-rsi/
│   ├── agent.cordis.yml     # 必填：组成声明（persona + 工具集）
│   ├── preset.yml           # 展示元数据：name / description
│   ├── dream_rsi.yaml       # 任务级配置（由用户复制到任务工作目录后被 Agent 读取）
│   └── README.md            # 触发词、字段、硬约束的详细说明
└── standard-deferred/
    ├── agent.cordis.yml     # 必填：在 standard 之上叠加 first-turn-minimal
    ├── first-turn-minimal.mjs  # 首轮精简钩子
    └── preset.yml           # 展示元数据
```

### 验证发现

打开 DSH Web GUI，新建会话时在模式选择器里应当能看到：

- **DREAM-RSI 模式**
- **标准模式 · 首轮精简**

如果下拉列表里没出现，按下列顺序排查：

1. 目录名是否合法（必须匹配 DSH 的预设 ID 正则；保持 `dream-rsi` / `standard-deferred` 原名即可）。
2. `agent.cordis.yml` 是否存在且可读（读取 YAML，校验每行至少含 `name` 字段）。
3. `agent.cordis.yml` 里命名的包是否在当前 `node_modules` 中可解析；DSH 会把无法解析的预设标为 `broken` 并在下拉列表里隐藏而不是显示错误。
4. 查看 DSH 日志中形如 `agent-presets: preset "<id>" failed to mount: ...` 的报错以定位问题。

## 配置 `dream-rsi`

完整字段表与触发词模板见 [`dream-rsi/README.md`](./dream-rsi/README.md)。下面给出落地的最小步骤：

1. **复制任务配置模板**：把仓库里的 `dream-rsi/dream_rsi.yaml` 拷贝到任务工作目录（例如 `~/work/my-task/dream_rsi.yaml`）。这个文件不是预设本身的组成文件，而是 Agent 在每一轮开始时会主动读取的任务级配置。
2. **替换占位符**：填入 `task.name`、`task.metric`、`task.eval_cmd`、`paths.workdir` / `paths.history_dir` / `paths.current_best`，以及 `paths.allowed_paths` 中允许 Agent 修改的全部路径。
3. **确认 `paths.forbidden_paths`** 完整覆盖评估器、数据集、提交接口等不可触碰范围（这是 DREAM-RSI 硬约束的强制来源之一）。
4. **设置预算**：`budget.total_calls`、`budget.total_time`、`budget.total_rounds`，以及 `budget.dreaming_candidates`（每轮候选策略数 M）。并行度调 `parallelism.W`。
5. 在 DSH Web GUI 中选择 **DREAM-RSI 模式**，新建会话，先发初始化触发词，再按 `budget.total_rounds` 每轮替换 `{t}` 发标准触发词。
6. 预算耗尽 / 目标达成后，发收尾触发词；只想做离线策略 dreaming 时，使用“仅 dreaming / 回放”触发词。

如果安装对应的 Bundle（如 Codex / Claude Code 行），去掉 `agent.cordis.yml` 里相应 `disabled: true` 行即可启用对应的子代理提供者。

## 配置 `standard-deferred`

该预设在 DSH 行为层面没有需要填空的任务级文件，但支持按下列行为定制：

- **调整首轮保留的工具**：编辑 `standard-deferred/agent.cordis.yml` 中 `first-turn-minimal` 行的 `minimalTools` 列表，按需增删。需要保留的字符串是 DSH 给模型暴露的工具名（出现在系统提示 `tools` 数组中的 `name` 字段），例如 `ask_user_question` / `pwsh` / `read` / `edit` / `glob` / `grep` 等。
- **完全关闭首轮精简**：把 `agent.cordis.yml` 里的 `first-turn-minimal` 整段删掉，该预设就退化为内置 `standard` 预设。
- **启用 Codex / Claude Code 子代理**：去掉 `agent.cordis.yml` 中 `tool-subagent-codex` / `tool-subagent-claude-code` 两行的 `disabled: true`，并在 DSH Profile 中安装对应 Bundle。

修改完成后保存即可，DSH 的代理预设发现是 live 读取的，下一次会话发起时生效。

## 排错

- **预设出现在列表里但开启失败**：查看 DSH 日志中的 `agent-presets: preset "<id>" failed to mount: <reason>`。常见原因：`agent.cordis.yml` 中的某个 `@deepseek-ai/...` 包未安装；`disabled: !!js ...` 的 JS 表达式抛出；工具组（`cordis:group`）中的 `isolate` 漏声明。
- **`dream-rsi` 跑起来但不写文件**：检查 `dream_rsi.yaml` 中的 `paths.allowed_paths` 是否覆盖任务工作目录；路径前缀必须与 Agent 在 shell 里 cd 后的绝对路径一致。
- **`standard-deferred` 首轮看不到预期工具**：检查 `minimalTools` 是否误删；钩子只在全新会话的首次装配触发，被恢复的会话、fork 出来的子代理都不会被裁剪，这是预期行为。
- **同时安装多个版本的预设**：`<dshHome>/.agent-presets/` 的预设 id 与 DSH 内置预设（`standard` / `minimal` 等）冲突时，本机预设会覆盖内置；非冲突的情况下两者并存。

## 协议与贡献

本仓库以 MIT 协议发布，包含的全部 YAML、ESM 与文档可自由使用、修改、再发布。在你自己的项目中使用这两个预设时，请保留 `preset.yml` 与 `agent.cordis.yml` 头部注释里关于原作者与 DREAM-RSI 论文来源的标注。

欢迎以 PR 形式提交：

- 新预设（在 `agent-presets/<your-preset>/` 下提交 `agent.cordis.yml` + `preset.yml`，外加一份 README）。
- 对现有预设的 bug fix、文档改进、默认参数调整。
- 真实任务上的 DREAM-RSI 评测案例与配置示例（作为 issue 附件提交即可）。