import { createMemoryHistory } from "@tanstack/react-router";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "ctrl+arrowdown", command: "thread.next", when: "!previewFocus && !previewOpen" },
    { key: "ctrl+arrowup", command: "thread.previous", when: "!previewFocus && !previewOpen" },
    { key: "mod+1", command: "thread.jump.1", when: "!previewFocus" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(keybindings) };
});

it("leaves thread shortcuts and their hints to the preview when their rules exclude it", async () => {
  const [first, second] = [threadWithHistory("thread-a", 1), threadWithHistory("thread-b", 1)];
  using _environment = installFakeEnvironment([first, second]);
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  const firstRowTitle = page.getByText(`Thread ${first.id}`, { exact: true }).first();
  await expect.element(firstRowTitle).toBeVisible();
  const firstRow = firstRowTitle.element().closest("[data-sidebar-row]")!;
  const firstRef = parseScopedThreadKey(firstRow.getAttribute("data-sidebar-row")!)!;
  const firstPath = `/${firstRef.environmentId}/${first.id}`;
  await userEvent.click(firstRowTitle);
  await vi.waitFor(() => expect(router.history.location.pathname).toBe(firstPath));

  const previewChrome = document.createElement("div");
  previewChrome.dataset.previewPanelMode = "browser";
  previewChrome.innerHTML = '<button type="button">Reload</button>';
  document.body.append(previewChrome);
  using _chrome = { [Symbol.dispose]: () => previewChrome.remove() };

  const press = () => userEvent.keyboard("{Control>}{ArrowDown}{/Control}");
  const jumpHint = () => document.querySelector("[data-jump-hint]");
  const whileHoldingControl = async (assertJumpHints: () => void) => {
    // Every deadline reads as due on subscribe, so hints skip the hold delay.
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    using _clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
    await userEvent.keyboard("{Control>}");
    await act(() => {});
    await vi.waitFor(assertJumpHints);
    await userEvent.keyboard("{/Control}");
  };

  previewChrome.querySelector("button")!.focus();
  await press();
  expect(router.history.location.pathname).toBe(firstPath);
  await whileHoldingControl(() => expect(jumpHint()).toBeNull());

  await act(() => useRightPanelStore.getState().openBrowser(firstRef, null));
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await press();
  expect(router.history.location.pathname).toBe(firstPath);

  await act(() => useRightPanelStore.getState().close(firstRef));
  const navigate = router.navigate.bind(router);
  let highlightBeforeNavigation: { path: string; current: string | null } | undefined;
  const secondKey = scopedThreadKey(scopeThreadRef(firstRef.environmentId, second.id));
  const secondRow = () => document.querySelector(`[data-sidebar-row="${secondKey}"]`);
  using navigateSpy = vi.spyOn(router, "navigate").mockImplementationOnce((options) => {
    highlightBeforeNavigation = {
      path: router.history.location.pathname,
      current: secondRow()?.getAttribute("aria-current") ?? null,
    };
    return navigate(options);
  });
  const chatFilter = () => getComputedStyle(document.querySelector("[data-chat-column]")!).filter;
  await userEvent.keyboard("{Control>}{ArrowDown}");
  await vi.waitFor(() => {
    expect(secondRow()).toHaveAttribute("aria-current", "page");
    expect(chatFilter().startsWith("blur(")).toBe(true);
  });
  await userEvent.keyboard("{ArrowUp}");
  await vi.waitFor(() => {
    expect(firstRow).toHaveAttribute("aria-current", "page");
    expect(chatFilter()).toBe("none");
  });
  await userEvent.keyboard("{ArrowDown}");
  await vi.waitFor(() => expect(secondRow()).toHaveAttribute("aria-current", "page"));
  expect(router.history.location.pathname).toBe(firstPath);
  expect(navigateSpy).not.toHaveBeenCalled();

  await userEvent.keyboard("{/Control}");
  await vi.waitFor(() =>
    expect(router.history.location.pathname).toBe(`/${firstRef.environmentId}/${second.id}`),
  );
  await vi.waitFor(() => expect(chatFilter()).toBe("none"));
  expect(navigateSpy).toHaveBeenCalledTimes(1);
  expect(highlightBeforeNavigation).toEqual({ path: firstPath, current: "page" });
  await whileHoldingControl(() => expect(jumpHint()).not.toBeNull());
});
