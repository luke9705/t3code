import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { PiColorsDialog } from "./PiColorsDialog";

it("validates hex colors and saves Plan independently of Build and accent", async () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const original = { build: "#73b9f8", plan: "#cc5ce9", accent: "#b7d6f2" };
  await using screen = await render(
    <PiColorsDialog colors={original} onSave={onSave} onClose={onClose} />,
  );
  expect(screen.container).toBeDefined();
  const dialog = page.getByRole("dialog", { name: "Pi colors" });
  const plan = dialog.getByRole("textbox", { name: "Plan indicators" });
  const save = dialog.getByRole("button", { name: "Save" });
  await plan.fill("invalid");
  await expect.element(save).toBeDisabled();
  await plan.fill("#9425ad");
  await save.click();
  expect(onSave).toHaveBeenCalledWith({ ...original, plan: "#9425ad" });
  expect(onClose).toHaveBeenCalledOnce();
});
