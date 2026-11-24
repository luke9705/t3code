import { EnvironmentId, NodeId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { PiStopSubagentButton } from "./TimelineWorkEntryRow";

const state = vi.hoisted(() => ({
  canOperate: false,
  interrupt: vi.fn(async (_input: unknown) => {}),
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => state.canOperate,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.interrupt) as never,
}));

const environmentId = EnvironmentId.make("environment:test");
const threadId = ThreadId.make("thread:test");
const subagentId = NodeId.make("child:test");

it("requires operation permission and only stops the selected native Pi child", async () => {
  state.canOperate = false;
  state.interrupt.mockClear();
  const control = () => (
    <PiStopSubagentButton
      environmentId={environmentId}
      threadId={threadId}
      subagentId={subagentId}
    />
  );
  await using screen = await render(control());
  const stop = screen.getByRole("button", { name: "Stop subagent" });
  await expect.element(stop).not.toBeInTheDocument();
  state.canOperate = true;
  await screen.rerender(control());
  await stop.click();
  expect(state.interrupt).toHaveBeenCalledExactlyOnceWith({
    environmentId,
    input: { threadId, subagentId },
  });
});
