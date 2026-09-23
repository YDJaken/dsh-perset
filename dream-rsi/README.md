# dream-rsi 预设

DREAM-RSI 是一种递归自我改进（RSI）模式。Agent 不一次性给出答案，而是按 A → B → C → D 循环迭代：

- **A 在线探索**：当前策略 `pi_t` 选合法批次，真实执行 `eval_cmd`，把结果写进发现树。
- **B 回放模拟器**：把历史目录中的发现树当作回放池 `H_t`，用 `replay/replay.py` 复演，不调真实评估器、不泄漏未揭示分数。
- **C Dreaming 策略改进**：从 `pi_t` 生成 M 个候选策略，分别在全部历史树上回放打分，按 V 选择 `pi_{t+1}`。
- **D 再部署**：把 `pi_{t+1}` 写入 `policies/pi_<t+1>.py`，下一轮在线探索使用。

整个过程的状态都落在文件里，对话只做摘要：

| 文件 | 作用 |
|---|---|
| `state.json` | 当前轮次、预算消耗、最佳节点、当前策略版本 |
| `tree/nodes.jsonl` | 每行一个发现树节点 |
| `tree/snapshots/<node_id>/` | 该节点工作区快照（优先 git commit 或完整副本） |
| `policies/pi_<t>.py` | 第 t 轮探索策略 |
| `replay/replay.py` | 回放模拟器 |
| `reports/round_<t>.md` | 每轮报告 |

## 工具与暴露面

工具面：shell、文件系统、后台作业、子代理（spawn/fork）、压缩、待办、present。刻意不引入 plan mode、web search、skill 加载、goals、workflow——调度器驱动的循环自己负责计划，persona 自含全部规则：

- **shell**（bash 或 pwsh，按平台自动启用）— 执行 `eval_cmd`、快照、文件操作。
- **文件系统**（fs + fs-search）— 读写 `state.json`、发现树、报告。
- **后台作业**（jobs）— 长时评估控制。
- **子代理**（subagent spawn + fork，continuable）— C 阶段并行生成 dreaming 候选、回放评估与分支隔离探索；codex / claude-code 行默认禁用，装对应 Bundle 后去掉 `disabled` 即可启用。
- **压缩**（compaction-basic + 工具结果修剪）— 数十至上百轮长会话的上下文压力。
- **待办**（todo）— 轮级记账。
- **present** — 把生成的文件交付给你。

系统提示词以 `complete: true` 装载：persona 是唯一的提示词 section，身份、后缀、工具引导等 section 全部屏蔽。runtime 上下文（工作目录、沙箱与审批策略快照）**保持开启**——真实评估与文件写入依赖这些事实。任务工作区的 AGENTS.md 指令走 inbox 用户消息通道，不受 `complete` 影响，照常进入对话。

## 一次性配置

1. **复制本目录下的 `dream_rsi.yaml` 到任务工作目录**（或任何会话开始时可读的路径）。
2. **替换占位符**：`task.name`、`task.metric`、`task.eval_cmd`，以及 `paths.workdir` / `paths.history_dir` / `paths.current_best` / `paths.allowed_paths`。
3. **确认 `paths.forbidden_paths`** 完整覆盖评估器、数据集、提交接口等不可触碰范围。
4. **设置预算**：`budget.total_calls`、`budget.total_time`、`budget.total_rounds`，以及并行度 `parallelism.W`、dreaming 候选数 `budget.dreaming_candidates`。
5. 在 DSH Web GUI 中选择 **DREAM-RSI 模式**，新建会话。

## 触发词（由调度器发送给 Agent）

调度器只做替换 `{t}` / `{timestamp}`，把以下整段发给 Agent。对话里不要把这些再粘一遍——直接发触发词即可。

### 3.1 初始化触发词

```text
初始化 DREAM-RSI。读取 dream_rsi.yaml。
检查工作目录、历史目录、当前最佳方案和评估命令是否可用。
构建初始发现树：根节点 = 当前最佳方案 / 初始工作区。
写入 state.json、tree/nodes.jsonl、reports/round_0.md。
只输出初始化摘要与阻塞项。不要开始在线探索。
```

### 3.2 第 t 轮标准触发词

```text
执行 DREAM-RSI 第 {t} 轮。严格按系统提示词执行 A→B→C→D：

1. 读取 state.json、tree/nodes.jsonl、policies 最新策略、dream_rsi.yaml；
2. 阶段 A 在线探索：pi_t 选择合法批次，真实调用 eval_cmd，新增节点写入发现树；
3. 阶段 B 更新/运行 replay/replay.py，回放历史树，记录 N、max_u、k、V；
4. 阶段 C 生成 M 个候选策略，按 V 选择 pi_{t+1}；
5. 阶段 D 写入 policies/pi_{t+1}.py 和 state.json；
6. 写 reports/round_{t}.md。

对话只汇报：
- 新增节点数与最佳效用；
- 回放模拟器统计；
- 选中策略及理由；
- 下一轮计划；
- 阻塞项。
不要编造 score，不要跳过文件写入。
```

### 3.3 收尾触发词

```text
停止 DREAM-RSI。汇总当前最佳方案、评估证据、文件位置、是否满足提交要求、预算消耗、发现树统计。
写入 reports/final.md。
对话只输出最终摘要。
```

### 3.4 仅 dreaming / 回放触发词（可选）

```text
不执行在线探索。读取历史发现树，运行 replay/replay.py。
生成 M 个候选探索策略并回放评估。
选择当前最优 pi，写入 policies/pi_dream_<timestamp>.py 和 state.json。
写 reports/dream_<timestamp>.md。对话只汇报 V 排名与选择结果。
```

## 推荐使用流程

1. 准备任务工作目录，写好 `dream_rsi.yaml`，把数据、当前最佳方案就位。
2. 在 DSH Web GUI 选 DREAM-RSI 模式，开会话。
3. 发“初始化触发词”。
4. 调度器按 `budget.total_rounds` 每轮发“第 t 轮标准触发词”，把 `{t}` 替换成轮号。
5. 预算耗尽或目标达成后，发“收尾触发词”收尾。
6. 若想跳过在线探索、只做策略 dreaming，用 3.4 触发词。

## 硬约束（系统提示词已强制）

- 只修改 `paths.allowed_paths` 列出的范围。
- 不修改评估器、评分器、数据集、最终提交接口。
- 在线评估必须真实执行；回放不得调用真实评估器。
- 回放策略不得泄漏未揭示分数。
- 每轮必须把发现树写到 `tree/nodes.jsonl`，不能只保留自然语言总结。
- 必须优先用回放模拟器评估大量候选探索策略，而不是直接在线试错。
- 必须显式报告质量、成本、并行效率三者权衡。
- 如果评估器不可用，停止并报告阻塞，禁止编造结果。