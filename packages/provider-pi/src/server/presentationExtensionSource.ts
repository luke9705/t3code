// Executed by the installed Pi extension loader, not by the T3 server.
export const PI_STOP_DELEGATE_COMMAND = "t3-stop-delegate";

export const PI_PRESENTATION_SOURCE = String.raw`
function installPresentation(pi: ExtensionAPI) {
  const key = "t3.pi.presentation.v1";
  pi.registerCommand(${JSON.stringify(PI_STOP_DELEGATE_COMMAND)}, {
    description: "Stop a native subagent in this session",
    async handler(args, ctx) {
      const [nonce, runId, childId, extra] = args.trim().split(/\s+/);
      if (ctx.mode !== "rpc" || extra || !/^\d+$/.test(nonce ?? "") ||
          !/^[a-z\d_.:-]{1,256}$/i.test(runId ?? "") || !/^[a-z\d_.:-]{1,256}$/i.test(childId ?? "")) return;
      const requestId = NodeCrypto.randomUUID();
      const success = await new Promise((resolve) => {
        const finish = (result) => { clearTimeout(timer); unsubscribe(); resolve(result); };
        const unsubscribe = pi.events.on("subagents:rpc:v1:reply:" + requestId, (reply) => finish(reply?.success === true));
        const timer = setTimeout(() => finish(false), 2000);
        pi.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "stop", params: { id: runId, childId } });
      });
      ctx.ui.setWidget("t3.pi.delegate-stop.v1", [JSON.stringify({ nonce, success })]);
    },
  });
  let composition: number[] | null = null;
  let samples: { output: number; duration: number; first?: number }[] = [];
  const firstTokens = new Map<number, number>();
  let promptTokens = 0;
  let cachedTokens = 0;
  let physicalModel: string | null = null;
  let prefill: number | null = null;
  let prefillRequest: AbortController | undefined;
  const publish = (ctx: ExtensionContext) => {
    if (ctx.mode !== "rpc") return;
    const duration = samples.reduce((sum, s) => sum + s.duration, 0);
    const output = samples.reduce((sum, s) => sum + s.output, 0);
    const timings = samples.flatMap((s) => s.first === undefined ? [] : [s.first]);
    ctx.ui.setStatus(key, JSON.stringify({
      composition,
      decode: duration ? output * 1000 / duration : null,
      ttft: timings.length ? timings.reduce((a, b) => a + b, 0) / timings.length : null,
      cache: promptTokens ? Math.min(100, cachedTokens / promptTokens * 100) : null,
      effort: ctx.model?.reasoning ? pi.getThinkingLevel() : null,
      physicalModel,
      prefill,
    }));
  };
  const refreshPrefill = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "rpc" || ctx.model?.provider !== "omlx") return;
    prefillRequest?.abort();
    const request = prefillRequest = new AbortController();
    let rate: number | null = null;
    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      if (auth.ok && !request.signal.aborted) {
        const url = new URL("/api/status", auth.baseUrl ?? ctx.model.baseUrl);
        const response = await fetch(url, {
          headers: auth.apiKey ? { Authorization: "Bearer " + auth.apiKey } : undefined,
          redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(2000)]),
        });
        if (response.ok) {
          const { avg_prefill_tps: value } = await response.json();
          if (typeof value === "number" && Number.isFinite(value) && value > 0) rate = value;
        }
      }
    } catch {
      // Server telemetry is optional; don't affect model requests.
    }
    if (request.signal.aborted || prefill === rate) return;
    prefill = rate;
    publish(ctx);
  };
  const resetMetrics = () => {
    samples = [];
    firstTokens.clear();
    promptTokens = cachedTokens = 0;
    physicalModel = null;
  };
  const reset = (_event: unknown, ctx: ExtensionContext) => {
    composition = null;
    resetMetrics();
    prefill = null;
    prefillRequest?.abort();
    publish(ctx);
  };
  let planContext: ExtensionContext | undefined;
  const publishPlan = (state: unknown) => {
    if (planContext?.mode !== "rpc" || typeof state !== "object" || state === null || !("enabled" in state)) return;
    if (typeof state.enabled !== "boolean" || !pi.getCommands().some((command) => command.name === "plan" && command.source === "extension")) return;
    planContext.ui.setStatus("t3.pi.plan.v1", state.enabled ? "plan" : "build");
    publish(planContext);
  };
  pi.events.on("plan-mode:state", publishPlan);
  pi.events.on("pi-lean-subagents:run-created", (payload: unknown) => {
    if (planContext?.mode !== "rpc" || !payload || typeof payload !== "object" ||
        !("requestId" in payload) || !("runId" in payload) || !("sessionId" in payload)) return;
    const { requestId, runId, sessionId } = payload;
    const ownSession = planContext.sessionManager.getSessionFile() ?? planContext.sessionManager.getSessionId();
    if (sessionId !== ownSession || typeof requestId !== "string" || requestId.length > 512 ||
        typeof runId !== "string" || !/^[a-z\d_.:-]{1,256}$/i.test(runId)) return;
    planContext.ui.setWidget("t3.pi.delegate-launch.v1", [JSON.stringify({ requestId, runId })]);
  });
  const queryPlan = (_event: unknown, ctx: ExtensionContext) => {
    planContext = ctx;
    if (ctx.mode === "rpc") pi.events.emit("plan-mode:query", publishPlan);
  };
  // Lean jobs persist their own snapshots; never read process internals or expose command text.
  let snapshotSession: string | undefined;
  let snapshotLeaf: string | null | undefined;
  let lastJobs: string | undefined;
  const publishJobs = (_event: unknown, ctx: ExtensionContext) => {
    if (ctx.mode !== "rpc" || !pi.getAllTools().some((tool) => tool.name === "job_control")) return;
    const session = ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId();
    const leaf = ctx.sessionManager.getLeafId();
    if (snapshotSession === session && snapshotLeaf === leaf) return;
    if (snapshotSession !== session) lastJobs = undefined;
    snapshotSession = session;
    snapshotLeaf = leaf;
    const jobs = [];
    const seen = new Set<string>();
    const entries = ctx.sessionManager.getBranch();
    for (let i = entries.length - 1; i >= 0 && jobs.length < 16; i--) {
      const entry = entries[i];
      if (entry?.type !== "custom" || entry.customType !== "lean-job") continue;
      const job = entry.data;
      if (!job || job.sessionId !== session || typeof job.id !== "string" ||
          !/^[a-z\d_.:-]{1,128}$/i.test(job.id) || seen.has(job.id)) continue;
      seen.add(job.id);
      if ((job.kind !== "shell" && job.kind !== "subagent") || typeof job.background !== "boolean" ||
          !["running", "completed", "failed", "cancelled"].includes(job.status)) continue;
      jobs.push({ id: job.id, kind: job.kind, status: job.status, background: job.background });
    }
    const text = JSON.stringify(jobs);
    if (text === lastJobs) return;
    lastJobs = text;
    ctx.ui.setStatus("t3.pi.jobs.v1", text);
  };
  pi.on("session_start", publishJobs);
  pi.on("before_agent_start", publishJobs);
  pi.on("session_tree", publishJobs);
  pi.on("tool_execution_update", publishJobs);
  pi.on("tool_execution_end", publishJobs);
  pi.on("agent_settled", publishJobs);
  pi.on("session_info_changed", (event, ctx) => {
    if (ctx.mode === "rpc" && event.name) {
      ctx.ui.setStatus("t3.pi.native-title.v1", JSON.stringify({ id: ctx.sessionManager.getSessionId(), title: event.name.slice(0, 512) }));
    }
  });
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "rpc" && pi.getCommands().some((command) => command.name === "rename-session" && command.source === "extension")) {
      ctx.ui.setStatus("t3.pi.title-owner.v1", "native");
    }
  });
  pi.on("session_start", queryPlan);
  pi.on("session_tree", queryPlan);
  pi.on("session_shutdown", () => { planContext = undefined; });
  pi.on("session_start", reset);
  pi.on("session_tree", reset);
  pi.on("session_compact", reset);
  pi.on("model_select", reset);
  pi.on("session_shutdown", () => prefillRequest?.abort());
  pi.on("message_update", (event, ctx) => {
    if (ctx.mode !== "rpc" || event.message.role !== "assistant") return;
    const delta = event.assistantMessageEvent;
    if (firstTokens.has(event.message.timestamp) || firstTokens.size >= 32) return;
    if ((delta.type === "text_delta" || delta.type === "thinking_delta" || delta.type === "toolcall_delta") && delta.delta) {
      firstTokens.set(event.message.timestamp, Math.max(0, Date.now() - event.message.timestamp));
    }
  });
  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "rpc" || event.message.role !== "assistant") return;
    const message = event.message;
    const first = firstTokens.get(message.timestamp);
    firstTokens.delete(message.timestamp);
    const { input, output, cacheRead, cacheWrite } = message.usage;
    promptTokens += input + cacheRead + cacheWrite;
    cachedTokens += cacheRead;
    if (message.stopReason !== "error" && message.stopReason !== "aborted") {
      samples.push({ output: message.durationMs && message.durationMs > 0 ? output : 0, duration: Math.max(0, message.durationMs ?? 0), first });
      if (samples.length > 10) samples.shift();
      const physical = ctx.model?.api === "pi-virtual" ? ctx.modelRegistry.find(message.provider, message.model) : undefined;
      physicalModel = physical && physical.api !== "pi-virtual" ? physical.id : null;
      if (message.provider === "omlx") void refreshPrefill(ctx);
    }
    publish(ctx);
  });
  pi.on("context_with_system", async (event, ctx) => {
    if (ctx.mode !== "rpc") return;
    const { contentText, getCurrentSystemPrompt, getCurrentTools } = await import("@earendil-works/pi-ai");
    if (!contentText || !getCurrentSystemPrompt || !getCurrentTools || typeof estimateTokens !== "function") return;
    const weights = [0, 0, 0, 0, 0, 0];
    const addText = (index: number, content: string) => {
      weights[index] += estimateTokens({ role: "user", content, timestamp: 0 });
    };
    let prompt = getCurrentSystemPrompt(event.messages);
    prompt = prompt.replace(/<project_context>[\s\S]*?<\/project_context>/g, (section) => { addText(1, section); return ""; });
    prompt = prompt.replace(/<skills>[\s\S]*?<\/skills>/g, (section) => { addText(4, section); return ""; });
    addText(0, prompt);
    addText(2, JSON.stringify(getCurrentTools(event.messages)));
    for (const message of event.messages) {
      if (message.role === "system") continue;
      const memory = (message.role === "custom" && message.customType === "project-memory") ||
        ((message.role === "user" || message.role === "custom") && contentText(message.content).startsWith("Relevant Memory:"));
      weights[memory ? 3 : 5] += estimateTokens(message);
    }
    composition = weights;
    publish(ctx);
  });
}
`;
