# standard-deferred 预设

`standard-deferred` 在 DSH 内置 `standard` 预设之上叠加了一个 `first-turn-minimal` 钩子：一个全新会话的首次装配（log 中还没有 `step/start` 事件的那次），模型可见的工具被裁剪到 `ask_user_question` + shell + 读/写/编辑/glob/grep + `web_search` + `todo_write` + 后台作业控制，并在尾部追加一段提示，告诉模型完整工具集会在下一步自动恢复。

从第二轮开始注入完整工具（subagent、workflow、ralph、skill、goal、plan mode，以及重型文件工具）。

适合希望降低首轮工具噪声、避免模型一上来就误调重型工具的场景。

## 工具面与暴露

在 DSH 内置 `standard` 的全部工具基础上，`standard-deferred` 多挂了一个函数插件 `first-turn-minimal`，负责在装配时按 preset id 过滤是否裁剪。其余工具面与 `standard` 一致：

- **shell**（bash 或 pwsh，按平台自动启用）
- **filesystem**（fs + fs-search）
- **背景作业**（jobs）
- **skills**（skill-filesystem + tool-skill）
- **goals**（tool-goal）
- **plan mode**（在孤立 realm 中挂 planMode 服务）
- **compaction**（compaction-basic + command-compact + tool-result-pruner，在孤立 realm 中挂 `compaction` 与 `toolResultPruner` 服务）
- **delegation**（subagent-control、subagent-list-agents、subagent spawn/fork、codex/claude-code 行默认禁用）
- **workflow**（workflow-ptc + tool-workflow）
- **ralph**（tool-ralph，continuable 模式，每轮 64 回合）
- **剩余模型可见**：tool-ask-user / tool-todo / tool-web（`fetch: false`，仅启用 web_search）

## 一次性配置

1. 按本目录根 [README.md §「安装与启用」](../README.md#安装与启用) 把仓库装进 DSH profile。
2. （可选）调整首轮保留的工具：编辑 `cordis.patch.yml` 中 `first-turn-minimal` 行的 `minimalTools` 列表，按需增删。需要保留的字符串是 DSH 给模型暴露的工具名（出现在系统提示 `tools` 数组中的 `name` 字段），例如 `ask_user_question` / `pwsh` / `read` / `edit` / `glob` / `grep` 等。
3. （可选）完全关闭首轮精简：把 `cordis.patch.yml` 中整个 `first-turn-minimal` 顶层行删掉，该预设就退化为内置 `standard` 预设。
4. （可选）启用 Codex / Claude Code 子代理：去掉 `cordis.patch.yml` 中 `tool-subagent-codex` / `tool-subagent-claude-code` 两行的 `disabled: true`，并在 DSH Profile 中安装对应 Bundle。

## 钩子的两个 gate

`first-turn-minimal.mjs` 在 `system-prompt/assemble` 上挂一个监听，裁剪只在**两个条件同时满足**时生效：

1. **preset 匹配**：监听会读 `agentPresets.composedPreset(agent.ctx)`，不匹配 `standard-deferred` 时直接放行原 assembly。这样在 host scope 挂的监听不会污染其他 preset 的会话，等价于「scope-local」语义。
2. **首轮 step 未起**：监听读 `session.snapshotEvents()`，若 log 中已经有 `step/start`，说明不是首次装配，放行。被恢复的会话、fork 出来的子代理都会落到这个分支，不会被裁剪。

## 排错

- **首轮看不到预期工具**：检查 `minimalTools` 列表是否误删，或 `first-turn-minimal` 的 `inject: ['agentPresets']` 行是否完整。
- **首轮被裁了但其他 preset 也被裁**：说明 `composedPreset` 过滤没生效，确认 `cordis.patch.yml` 里 `first-turn-minimal` 行带 `inject: ['agentPresets']` 且 `cordis-plugin-include` / `dsh-app-boot` 是当前构建。
- **preset 在 Roster 里显示「加载失败」**：DSH 日志里会有 `agent-presets: preset "<id>" failed to mount: <reason>`。最常见原因：`first-turn-minimal.mjs` 的相对路径没被锚定（参见本目录根 [README.md §「为什么 first-turn-minimal 在顶层 insert」](../README.md#为什么-first-turn-minimal-在顶层-insert-而不是-preset-内)）。