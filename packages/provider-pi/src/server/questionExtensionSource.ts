// Adapt the personal question tool's explicit non-TUI result without replacing its declaration.
export const PI_QUESTION_SOURCE = String.raw`
function installQuestionUi(pi: ExtensionAPI) {
  pi.on("tool_result", async (event, ctx) => {
    if (ctx.mode !== "rpc" || event.toolName !== "question" || event.content.length !== 1 ||
        event.content[0]?.type !== "text" ||
        event.content[0].text !== "Error: UI not available (running in non-interactive mode)") return;
    const input = event.input;
    if (typeof input.question !== "string" || !input.question.trim() || !Array.isArray(input.options) ||
        input.options.length === 0 || !input.options.every((option) =>
          typeof option?.label === "string" && (option.description === undefined || typeof option.description === "string"))) return;
    const normalize = (value: string) => value.replace(/\r\n/g, "\n").replace(/\r/g, "");
    const title = normalize(input.question);
    const labels = input.options.map((option) => option.label);
    const lines = input.options.map((option, index) =>
      (index + 1) + ". " + normalize(option.label) + " — " + normalize(option.description ?? ""));
    const custom = "Type something.";
    const answerLine = await ctx.ui.select(title, [...lines, custom], { signal: ctx.signal });
    const typed = answerLine === custom;
    const index = answerLine === undefined ? -1 : lines.indexOf(answerLine);
    const answer = typed
      ? await ctx.ui.input(title + "\n\n" + lines.join("\n") + "\n\nType your answer", "", { signal: ctx.signal })
      : labels[index];
    const text = answer === undefined ? "User cancelled the selection" : typed
      ? "User wrote: " + answer
      : "User selected: " + (index + 1) + ". " + answer;
    return {
      content: [{ type: "text", text }],
      details: {
        question: input.question,
        options: labels,
        answer: answer ?? null,
        ...(answer === undefined ? {} : { wasCustom: typed }),
      },
      isError: false,
    };
  });
}
`;
