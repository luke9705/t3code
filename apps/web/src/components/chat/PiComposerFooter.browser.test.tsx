import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { PiComposerFooter } from "./PiComposerFooter";

function Footer({ onToggleMode }: { readonly onToggleMode: () => void }) {
  const [open, setOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  return (
    <PiComposerFooter
      usage={{ usedTokens: 8000, maxTokens: 16000, usedPercentage: 50 }}
      model="test/model"
      workspace="main"
      statistics={JSON.stringify({ composition: [1, 1, 1, 1, 1, 5], cache: 25 })}
      mode="plan"
      onToggleMode={onToggleMode}
      jobs={[{ id: "shell-one", kind: "shell", status: "running", background: true }]}
      jobsOpen={jobsOpen}
      onJobsOpenChange={setJobsOpen}
      inspectorOpen={open}
      onInspectorOpenChange={setOpen}
    />
  );
}

it("opens and keyboard-dismisses the context breakdown without toggling Plan mode", async () => {
  const onToggleMode = vi.fn();
  await using screen = await render(<Footer onToggleMode={onToggleMode} />);
  const contextButton = screen.getByRole("button", { name: /context 50/i });
  await contextButton.click();
  const dialog = page.getByRole("dialog", { name: "Context composition (estimated)" });
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog.getByText("Conversation and tool results")).toBeVisible();
  await expect.element(dialog.getByText("50.0%", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(contextButton).toHaveFocus();
  expect(onToggleMode).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Exit Pi Plan mode" }).click();
  expect(onToggleMode).toHaveBeenCalledOnce();
});

it("inspects only the current session jobs without submitting a turn", async () => {
  const onToggleMode = vi.fn();
  await using screen = await render(<Footer onToggleMode={onToggleMode} />);
  await screen.getByRole("button", { name: "Pi jobs: 1 running" }).click();
  const dialog = page.getByRole("dialog", { name: "Pi jobs" });
  await expect.element(dialog.getByText("shell-one")).toBeVisible();
  await expect.element(dialog.getByText("Running in background")).toBeVisible();
  expect(onToggleMode).not.toHaveBeenCalled();
});
