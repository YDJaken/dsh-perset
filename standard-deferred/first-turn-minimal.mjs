/*
 * first-turn-minimal — deferred tool injection for a DSH Agent preset.
 *
 * On a brand-new session whose log is still empty, this preset-row plugin
 * trims the model-facing tool catalog to a small "minimal mode" set so the
 * model sees the prompt plus a few core tools, leaving room for reasoning.
 * Any session that has begun — first turn in flight, resumed session seeded
 * with prior turns, or a freshly spawned subagent — receives the full catalog
 * unmodified.
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
 * Scope: registered without `global: true` so it only fires for agents
 * joined under this preset's standing scope. Other presets' sessions in the
 * same process are unaffected.
 *
 * Pure ESM; no TS/JSX. Exports a Cordis function plugin (named `name` +
 * `apply`, no default export — see the AGENTS postmortem on default-export
 * dropping the namespace). Loaded by this preset's agent.cordis.yml as a
 * relative `./first-turn-minimal.mjs` name.
 */
export const name = 'first-turn-minimal';

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

  // Scoped listener: only fires for agents joined under this preset's
  // standing scope, so sessions on other presets are unaffected.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const assembled = await next();
    const session = context?.agent?.session;
    // Non-agent assemblies (e.g. diagnostics) leave tools untouched.
    if (session === undefined) return assembled;

    // The gate is "the session's first step has not begun". Every fresh DSH
    // session carries policy seed events (permission/preset, sandbox/mode,
    // approval/policy, session/end-seed), so log emptiness is never true;
    // the loop appends a step's `step/start` AFTER the assembly that serves
    // it, so the first-turn first assembly sees none and every later
    // assembly — second step, second turn, errored or retried first step,
    // resumed seed, spawned subagent — sees one. A log this build cannot
    // read fails OPEN: trimming on an unreadable log is the every-turn-trim
    // failure mode this hook exists to avoid.
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
