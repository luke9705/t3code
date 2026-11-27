import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthProvidersManageScope } from "@t3tools/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { T, useGT } from "gt-react";
import { useRef, useState } from "react";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { m } from "~/i18n/messages";
import { readProjects } from "~/state/entities";
import { useEnvironment, useEnvironmentProviders } from "~/state/environments";
import {
  PI_CODE_UPSTREAM_BASELINE,
  T3_UPSTREAM_REPOSITORY,
  piCodeUpstreamReleaseAtom,
} from "~/state/piCodeUpstreamRelease";
import { localEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "~/state/server";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  collectProviderUpdateCandidates,
  hasOneClickUpdateProviderCandidate,
  isProviderUpdateActive,
} from "../ProviderUpdateLaunchNotification.logic";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SidebarMenuItem } from "../ui/sidebar";
import { DesktopUpdateStatusIcon } from "./DesktopUpdateStatusIcon";

function useSidebarPiCliUpdate() {
  const gt = useGT();
  const navigate = useNavigate();
  const environmentId = useAtomValue(localEnvironmentIdAtom);
  const environment = useEnvironment(environmentId);
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const providersByEnvironment = useEnvironmentProviders();
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, { reportFailure: false });
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const providers =
    (environmentId === null ? undefined : providersByEnvironment.get(environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const candidate = collectProviderUpdateCandidates(providers).find(
    ({ driver }) => driver === "pi",
  );
  if (
    environmentId === null ||
    environment?.connection.phase !== "connected" ||
    !canManage ||
    !candidate ||
    providers.some((provider) => provider.driver === "pi" && isProviderUpdateActive(provider))
  ) {
    return null;
  }

  const canInstall = hasOneClickUpdateProviderCandidate(candidate, providers);
  const version = candidate.versionAdvisory.latestVersion;
  const update = async () => {
    if (inFlight.current || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    if (!canInstall) {
      await navigate({ to: "/settings/providers" });
      return;
    }
    inFlight.current = true;
    setPending(true);
    const result = await updateProvider({
      environmentId,
      input: { provider: candidate.driver, instanceId: candidate.instanceId },
    });
    inFlight.current = false;
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not update {provider}", { provider: "Pi CLI" }),
          description: thrownErrorMessage(squashAtomCommandFailure(result), m),
        }),
      );
    }
  };

  return { canInstall, pending, update, version };
}

function upstreamReviewPrompt(version: string): string {
  // oxlint-disable-next-line t3code/no-untranslated-copy -- editable agent prompt, not UI copy
  return `Review upstream T3 Code ${version} (${T3_UPSTREAM_REPOSITORY}/releases/tag/${version}) for potential improvements to Pi Code.

Compare the upstream release notes and relevant Git changes since Pi Code’s registered upstream base (${PI_CODE_UPSTREAM_BASELINE.version}; commit ${PI_CODE_UPSTREAM_BASELINE.commit}). Check the current Pi Code fork (luke9705/t3code, branch pi-code) before assuming a change is missing. If the checkout is not in the current workspace, look for it at ~/t3code.

Give me a TL;DR of the user-visible features, workflow improvements, and important fixes that are not already present. Group related changes into a short numbered list so I can pick what to port. For each entry, tell me what changes for me, whether it fits Pi Code’s native Pi workflow, and any notable dependencies, effort, or regressions to watch for. Flag changes that are already present or not relevant separately. Link to the upstream PRs or commits for the strongest candidates.

This is a review only. Do not modify the checkout, merge upstream, or port anything until I choose which items to bring over.`;
}

function useSidebarT3UpstreamUpdate() {
  const gt = useGT();
  const release = AsyncResult.getOrElse(useAtomValue(piCodeUpstreamReleaseAtom), () => null);
  const environmentId = useAtomValue(localEnvironmentIdAtom);
  const openDraft = useNewThreadHandler();
  const scratch = useScratchProject();
  if (!release) return null;

  const startReview = async () => {
    const result = await settlePromise(async () => {
      const forkProject = readProjects().find(
        ({ environmentId: id, archivedAt, repositoryIdentity }) =>
          id === environmentId &&
          archivedAt == null &&
          repositoryIdentity?.provider === "github" &&
          repositoryIdentity.owner?.toLowerCase() === "luke9705" &&
          repositoryIdentity.name?.toLowerCase() === "t3code",
      );
      const scratchEnvironment = scratch.scratchEnvironmentId(environmentId);
      const project =
        forkProject ??
        (scratchEnvironment ? await scratch.openScratchProject(scratchEnvironment) : null);
      if (!project) {
        if (!scratchEnvironment) throw new Error(gt("Connect to the Pi Code environment first."));
        return;
      }
      await openDraft(scopeProjectRef(project.environmentId, project.id), {
        envMode: "local",
        prompt: upstreamReviewPrompt(release),
      });
    });
    if (result._tag === "Failure") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not open the upstream review"),
          description: thrownErrorMessage(squashAtomCommandFailure(result), m),
        }),
      );
    }
  };

  return { release, startReview };
}

export function useSidebarPiCodeUpdates() {
  return { cli: useSidebarPiCliUpdate(), upstream: useSidebarT3UpstreamUpdate() };
}

export function SidebarPiCodeUpdates({
  updates: { cli, upstream },
  otherUpdate,
}: {
  readonly updates: ReturnType<typeof useSidebarPiCodeUpdates>;
  readonly otherUpdate?: { label: string; run: () => void };
}) {
  const gt = useGT();

  return (
    <SidebarMenuItem className="ml-auto shrink-0">
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <button
              type="button"
              aria-label={gt("Updates available")}
              className="relative inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-sidebar-control-surface text-sidebar-foreground outline-hidden ring-ring transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-inset"
            />
          }
        >
          <DesktopUpdateStatusIcon status="idle" />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0.5 right-0.5 flex gap-0.5"
          >
            {cli ? (
              <span className="size-1.5 rounded-full bg-warning ring-1 ring-sidebar-control-surface" />
            ) : null}
            {upstream ? (
              <span className="size-1.5 rounded-full bg-primary ring-1 ring-sidebar-control-surface" />
            ) : null}
          </span>
        </AlertDialogTrigger>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Updates available</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>Choose which update to act on.</T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col divide-y px-6 pb-4">
            {cli ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex items-center gap-2 font-medium">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-warning"
                    />
                    {gt("{provider} {version} available", {
                      provider: "Pi CLI",
                      version: cli.version,
                    })}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    <T>New sessions will use the updated CLI.</T>
                  </p>
                </div>
                <AlertDialogClose
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={cli.pending}
                      onClick={() => void cli.update()}
                    />
                  }
                >
                  {cli.pending
                    ? gt("Updating {provider}", { provider: "Pi CLI" })
                    : cli.canInstall
                      ? gt("Update {provider}", { provider: "Pi CLI" })
                      : gt("Open provider settings")}
                </AlertDialogClose>
              </div>
            ) : null}
            {upstream ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex items-center gap-2 font-medium">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                    />
                    {gt("Upstream T3 Code {version} is available", { version: upstream.release })}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {gt(
                      "Pi Code is based on {version}. Open an unsent draft to review what to port.",
                      { version: PI_CODE_UPSTREAM_BASELINE.version },
                    )}
                  </p>
                </div>
                <AlertDialogClose
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void upstream.startReview()}
                    />
                  }
                >
                  <T>Open review chat</T>
                </AlertDialogClose>
              </div>
            ) : null}
            {otherUpdate ? (
              <div className="flex justify-end py-3">
                <AlertDialogClose
                  render={<Button variant="outline" size="sm" onClick={otherUpdate.run} />}
                >
                  {otherUpdate.label}
                </AlertDialogClose>
              </div>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              <T>Close</T>
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SidebarMenuItem>
  );
}
