/*
 * first-turn-minimal — deferred tool injection for the standard-deferred agent preset.
 *
 * On a brand-new session whose log is still empty AND whose composing preset is
 * `standard-deferred`, this preset-row plugin trims the model-facing tool
 * catalog to a small "minimal mode" set so the model sees the prompt plus a
 * few core tools, leaving room for reasoning. Any session that has begun
 * (first turn in flight, resumed session seeded with prior turns, or a
 * freshly spawned subagent), and any session on a different preset, receives
 * the full catalog unmodified.
 *
 * Mechanism: it hooks the `"system-prompt/assemble"` waterfall and rewrites
 * the assembled `tools` list when the gate fires. The agent loop only sends
 * tools to the model when `assembly.tools` is non-empty, so returning a
 * filtered list here is authoritative. The gate is "no `step/start` in the
 * session log yet": the loop appends a step's marker after the assembly that
 * serves it, so exactly the first-turn first assembly qualifies and every
 * later assembly — including one after an errored or retried first step —
 * gets the full catalog.
 *
 * Placement: lives at the bundle's top-level insert row instead of inside the
 * preset row's `config.plugins[]`. dsh-app-boot's `anchorInsertedPluginNames`
 * resolves relative `./xxx.mjs` names against the patch file's directory for
 * top-level rows, but not for nested preset plugin entries — the latter are
 * activated against the preset's `ctx.baseUrl` (= profile directory), so a
 * relative path there fails to resolve. Hosting the plugin at the bundle's
 * top level keeps the relative path anchored to this file's directory.
 *
 * Scope: scoped via `inject: ['agentPresets']` plus an explicit preset-id
 * check at assembly time, so the trim only fires for agents joined to the
 * `standard-deferred` preset's standing scope.
 *
 * Pure ESM; no TS/JSX. Exports a Cordis function plugin (named `name` +
 * `inject` + `apply`, no default export — see the AGENTS postmortem on
 * default-export dropping the namespace). Loaded by this preset's
 * `cordis.patch.yml` as a relative `./first-turn-minimal.mjs` name.
 */
export const name = 'first-turn-minimal';
export const inject = ['agentPresets'];

/** The id of the preset this hook belongs to; gates the trim to that preset's agents. */
const TARGET_PRESET = 'standard-deferred';

/**
 * Section appended when the gate fires. It names the kept tools and tells
 * the model the full catalog returns automatically from the next step or
 * turn. Appended to the section array, so it lands at the tail of the
 * system prompt; a `complete` prompt section (e.g. plan mode) still wins by
 * replacing the array.
 */
const SECTION_NAME = 'preset:first-turn-minimal:notice';

function buildNoticeSection(keptTools) {
  const list = keptTools.length === 0
    ? "- (no model-facing tools are kept this turn)"
    : keptTools.map((n) => "- " + n).join("\n");
  return [
    "## Minimal mode (first turn only)",
    "",
    "You are at the very start of a fresh session. To give your prompt room",
    "for reasoning, this preset has trimmed the model-facing tool catalog to",
    "the small set below for THIS step only. From your next step or turn on,",
    "the full catalog is restored automatically and these tools come back:",
    "subagent / subagent_fork / workflow / ralph / list_agents /",
    "skill / goal / plan mode, plus the heavy file tools.",
    "",
    "Tools available this turn:",
    list,
    "",
    "If the user asks for something you cannot do with this trimmed set,",
    "answer with what you CAN do now and note that the full set arrives on",
    "the next turn — do not invent tool names or refuse on the user's behalf.",
    "ask_user_question is intentionally kept so you can resolve ambiguity",
    "when a follow-up question is the right move.",
  ].join("\n");
}

export function apply(ctx, config = {}) {
  const keep = new Set(
    config.minimalTools ?? [
      'ask_user_question',
      'pwsh',
      'bash',
      'read',
      'read_image',
      'write',
      'edit',
      'glob',
      'grep',
      'web_search',
      'todo_write',
      'job_output',
      'job_kill',
    ],
  );

  // Listening at host scope means the listener fires for every agent in the
  // process, not only standard-deferred ones — so we read the composing
  // preset id at assembly time and bail out for everyone else. This keeps the
  // hook's scope-local semantics from the prior implementation while making
  // it survive the host-scope placement.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const assembled = await next();
    const session = context?.agent?.session;
    if (session === undefined) return assembled;

    // Gate 1: only agents joined to standard-deferred.
    let presetId;
    try {
      presetId = ctx.agentPresets.composedPreset(context.agent.ctx);
    } catch {
      presetId = undefined;
    }
    if (presetId !== TARGET_PRESET) return assembled;

    // Gate 2: only the session's first step. Every fresh DSH session carries
    // policy seed events (permission/preset, sandbox/mode, approval/policy,
    // session/end-seed), so log emptiness is never true; the loop appends a
    // step's `step/start` AFTER the assembly that serves it, so the
    // first-turn first assembly sees none and every later assembly — second
    // step, second turn, errored or retried first step, resumed seed,
    // spawned subagent — sees one. A log this build cannot read fails OPEN.
    const events = typeof session.snapshotEvents === 'function'
      ? session.snapshotEvents()
      : undefined;
    if (events === undefined || events.some((event) => event.type === 'step/start')) {
      return assembled;
    }

    const visible = (assembled.tools ?? []).filter((tool) => keep.has(tool.name));
    const notice = {
      name: SECTION_NAME,
      text: buildNoticeSection(visible.map((t) => t.name)),
    };
    return {
      ...assembled,
      tools: visible,
      sections: [...(assembled.sections ?? []), notice],
    };
  });
}