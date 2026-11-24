import { createMemoryHistory } from "@tanstack/react-router";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  CODEX_PROVIDER,
  ENVIRONMENT_ID,
  dispatchedCommands,
  installFakeEnvironment,
  rejectPendingCommand,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { render } from "../../test/render";

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

function piConversation(goal: OrchestrationV2ProviderThread["goal"] = null) {
  const instanceId = ProviderInstanceId.make("pi");
  const driver = ProviderDriverKind.make("pi");
  const modelSelection = { instanceId, model: "fixture/model" };
  const history = threadWithHistory(goal ? `pi-goal-${goal.status}` : "pi-move", 1, modelSelection);
  const at = DateTime.makeUnsafe("2026-03-17T19:12:28.000Z");
  const thread = {
    ...history,
    providerThreads: [
      {
        id: ProviderThreadId.make("provider-thread-pi-move"),
        providerSessionId: null,
        ownerNodeId: null,
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: 1,
        lastRunOrdinal: 1,
        handoffIds: [],
        forkedFrom: null,
        pendingBackgroundTasks: [],
        nativeMetadata: null,
        goal,
        createdAt: at,
        updatedAt: at,
        driver,
        providerInstanceId: instanceId,
        appThreadId: history.id,
        nativeThreadRef: { driver, nativeId: "native-pi", strength: "strong" as const },
        contextUsage: null,
      },
    ],
  } satisfies typeof history & { providerThreads: OrchestrationV2ProviderThread[] };
  const install = () =>
    installFakeEnvironment([thread], {
      providers: [
        {
          ...CODEX_PROVIDER,
          driver,
          instanceId,
          models: [
            { slug: modelSelection.model, name: "Fixture Pi", isCustom: false, capabilities: null },
          ],
          slashCommands: [
            {
              name: "review-template",
              inline: true,
              description: "Apply the review prompt template",
            },
            { name: "review-session", description: "Operate on the current session" },
          ],
          skills: [
            { name: "review-checklist", path: "/workspace/skills/review/SKILL.md", enabled: true },
          ],
        },
      ],
      acceptCommands: true,
      settings: { providerInstances: { [instanceId]: { driver, enabled: true } } },
      holdCommand: (command) => command.type === "message.dispatch",
    });
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  return { install, router, thread };
}

it("submits Pi relocation without inserting a message and keeps the command on rejection", async () => {
  const { install, router, thread } = piConversation();
  using _environment = install();
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  await expect.element(page.getByText(`Answer 0 for ${thread.id}.`)).toBeVisible();
  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  const move = "/move destination";
  await userEvent.type(editor, move);
  expect(editor.element().textContent).toContain(move);
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(dispatchedCommands().filter(({ type }) => type !== "thread.visit")).toEqual([
      expect.objectContaining({
        type: "message.dispatch",
        text: move,
        attachments: [],
        dispatchMode: { type: "start_immediately" },
      }),
    ]),
  );
  expect(editor.element().textContent).toContain(move);
  await rejectPendingCommand("The destination is not a registered project.");
  await expect
    .element(page.getByText("The destination is not a registered project."))
    .toBeVisible();
  expect(editor.element().textContent).toContain(move);
});

it("completes Pi skills and prompt templates inline without offering session commands", async () => {
  const { install, router, thread } = piConversation();
  using _environment = install();
  await router.load();
  await using _app = await render(<AppRoot router={router} />, { router: false });
  await expect.element(page.getByText(`Answer 0 for ${thread.id}.`)).toBeVisible();
  const editor = page.getByTestId("composer-editor");
  await userEvent.click(editor);
  await userEvent.type(editor, "Apply /review");
  const template = page.getByRole("option", { name: /review-template/ });
  const skill = page.getByRole("option", { name: /review-checklist/ });
  await expect.element(template).toBeVisible();
  await expect.element(skill).toBeVisible();
  await expect
    .element(page.getByRole("option", { name: /review-session/ }))
    .not.toBeInTheDocument();
  await template.click();
  expect(editor.element().textContent).toContain("Apply /review-template");
  await userEvent.type(editor, "and /review-che");
  await skill.click();
  expect(editor.element().textContent).toMatch(/Apply \/review-template and .*review-checklist/);
  expect(dispatchedCommands().filter(({ type }) => type === "message.dispatch")).toEqual([]);
});

it.each([
  { status: "active", label: "Goal set", action: "Pause", command: "/goal pause" },
  { status: "paused", label: "Goal paused", action: "Resume", command: "/goal resume" },
  {
    status: "budget_limited",
    label: "Goal reached its token budget",
    action: "Clear",
    command: "/goal clear",
  },
] as const)(
  "sends the native $action action for a $status Pi goal without touching the draft",
  async ({ status, label, action, command }) => {
    const { install, router, thread } = piConversation({
      status,
      objective: "Check the composer fixtures",
      tokensUsed: 25,
      tokenBudget: 25,
    });
    using _environment = install();
    await router.load();
    await using _app = await render(<AppRoot router={router} />, { router: false });
    await expect.element(page.getByText(`Answer 0 for ${thread.id}.`)).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: `${label} · 25 / 25 tokens` }))
      .toBeVisible();
    const editor = page.getByTestId("composer-editor");
    await userEvent.click(editor);
    await userEvent.type(editor, "Keep this draft");
    const control = page.getByRole("button", { name: action, exact: true });
    await expect.element(control).toBeVisible();
    await control.click();
    await vi.waitFor(() =>
      expect(dispatchedCommands().filter(({ type }) => type === "message.dispatch")).toEqual([
        expect.objectContaining({ threadId: thread.id, text: command, attachments: [] }),
      ]),
    );
    await rejectPendingCommand("Pi command refused by the fixture.");
    await expect.element(page.getByText("Pi command refused by the fixture.")).toBeVisible();
    expect(editor.element().textContent).toBe("Keep this draft");
  },
);
