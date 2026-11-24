// Reads the personal tracker's documented JSONL format through the active Pi session.
export const PI_TRACKING_JOURNAL_COMMAND = "t3-track-journal";

export const PI_TRACKING_JOURNAL_SOURCE = String.raw`
function installTrackingJournal(pi: ExtensionAPI) {
  pi.registerCommand("t3-track-journal", {
    description: "Inspect the active read-only tracking journal",
    async handler(_args, ctx) {
      if (ctx.mode !== "rpc" || !pi.getCommands().some((command) => command.name === "track-journal")) {
        ctx.ui.notify("The Pi tracking extension is not available.", "warning");
        return;
      }
      let planning = false;
      pi.events.emit("plan-mode:query", (state) => { planning = state.enabled === true; });
      const entry = ctx.sessionManager.getBranch().findLast((entry) =>
        entry.type === "custom" && entry.customType === "goal-tracker-binding");
      const binding = entry?.data;
      if (planning || binding?.enabled !== true || typeof binding.id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(binding.id)) {
        ctx.ui.notify("Activate a tracking journal in Build mode first.", "info");
        return;
      }
      try {
        const agentDir = getAgentDir();
        const directory = NodePath.join(agentDir, "tracking");
        const path = NodePath.join(directory, binding.id + ".jsonl");
        // Follow the user-selected agent directory, but not a redirected journal or tracking directory.
        const root = await NodeFSP.realpath(agentDir);
        if (await NodeFSP.realpath(directory) !== NodePath.join(root, "tracking")) throw new Error("Unexpected tracking directory");
        const handle = await NodeFSP.open(path, NodeFSConstants.O_RDONLY | NodeFSConstants.O_NOFOLLOW | NodeFSConstants.O_NONBLOCK);
        let text;
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error("Invalid tracking journal");
          text = await handle.readFile("utf8");
        } finally {
          await handle.close();
        }
        const [first, ...lines] = text.trimEnd().split("\n");
        const header = JSON.parse(first ?? "");
        // Report only user-facing fields; never transmit the working directory or session file paths.
        const home = NodeOS.homedir();
        const clean = (value, max = 240) => typeof value === "string"
          ? value.replaceAll(home + "/", "~/").replace(/[\r\n\x00-\x1f]/g, " ").slice(0, max).replace(/[\\*_[\]<>!]/g, "\\$&") : "";
        const cells = new Map();
        let state = "No checkpoints recorded.";
        let next = "Await the user's next instruction.";
        for (const line of lines) {
          const attempt = JSON.parse(line).checkpoint;
          if (!attempt || typeof attempt.id !== "string" || !["OPEN", "FAILED", "WORKED"].includes(attempt.result)) continue;
          state = clean(attempt.state);
          next = clean(attempt.next);
          cells.set(attempt.id, {
            id: clean(attempt.id), result: attempt.result, approach: clean(attempt.approach), takeaway: clean(attempt.takeaway),
            evidence: Array.isArray(attempt.evidence) ? attempt.evidence.map((ref) => clean(ref)) : [],
          });
        }
        const filters = ["All", "Open", "Failed", "Worked", "Close"];
        let filter = "All";
        while (filter !== "Close") {
          const attempts = [...cells.values()].filter((attempt) => filter === "All" || attempt.result === filter.toUpperCase());
          const rows = attempts.map((attempt) => [
            "### " + attempt.id + " · " + attempt.result,
            "Approach: " + attempt.approach,
            "Takeaway: " + attempt.takeaway,
            "Evidence: " + attempt.evidence.join("; "),
          ].join("\n\n"));
          const content = ["**Goal:** " + clean(header?.goal), "**State:** " + state, "**Next:** " + next,
            "**Attempts (" + filter + "):** " + attempts.length, ...rows].join("\n\n");
          const choice = await ctx.ui.select("T3_PI_TRACK_JOURNAL\n" + content, filters);
          filter = choice !== undefined && filters.includes(choice) ? choice : "Close";
        }
      } catch {
        ctx.ui.notify("Could not read the active tracking journal.", "error");
      }
    },
  });
}
`;
