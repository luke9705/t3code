import { type decodePiJobs, decodePiPresentation } from "@t3tools/shared/piPresentation";
import { T, useGT, useLocale } from "gt-react";
import { memo } from "react";

import { formatContextWindowTokens as tokens } from "../../lib/contextWindow";
import { InlineButton } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

export const PiComposerFooter = memo(function PiComposerFooter(props: {
  readonly usage: {
    readonly usedTokens: number;
    readonly maxTokens?: number | null | undefined;
    readonly usedPercentage: number | null;
  } | null;
  readonly model: string | null;
  readonly workspace: string | null;
  readonly statistics: string | undefined;
  readonly mode: "plan" | "build" | null;
  readonly onToggleMode: (() => void) | undefined;
  readonly onOpenTrackingJournal?: (() => void) | undefined;
  readonly jobs?: ReturnType<typeof decodePiJobs>;
  readonly jobsOpen?: boolean;
  readonly shellOnly?: boolean;
  readonly onJobsOpenChange?: (open: boolean) => void;
  readonly inspectorOpen: boolean;
  readonly onInspectorOpenChange: (open: boolean) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const stats = props.statistics ? decodePiPresentation(props.statistics) : null;
  const shownJobs = props.shellOnly
    ? props.jobs?.filter(({ kind, status }) => kind === "shell" && status === "running")
    : props.jobs;
  const percentage = props.usage?.usedPercentage ?? null;
  const used = props.usage ? tokens(props.usage.usedTokens) : "?";
  const capacity = props.usage?.maxTokens ? tokens(props.usage.maxTokens) : "?";
  const tone =
    percentage === null
      ? undefined
      : percentage > 90
        ? "text-destructive"
        : percentage > 70
          ? "text-warning-foreground"
          : undefined;
  const counts = stats?.composition ?? null;
  const total = counts?.reduce((sum, count) => sum + count, 0) ?? 0;
  const format = (value: number) =>
    value.toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const names = [
    gt("System instructions"),
    gt("AGENTS.md / project instructions"),
    gt("Tool definitions"),
    gt("Memories"),
    gt("Skill catalog"),
    gt("Conversation and tool results"),
  ];
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 px-2 pb-1 text-xs text-muted-foreground"
      data-testid="pi-composer-footer"
    >
      {props.mode && (
        <InlineButton
          onClick={props.onToggleMode}
          disabled={!props.onToggleMode}
          aria-label={props.mode === "plan" ? gt("Exit Pi Plan mode") : gt("Enter Pi Plan mode")}
        >
          <span
            className={
              props.mode === "plan" ? "text-(--pi-plan-indicator)" : "text-(--pi-build-indicator)"
            }
          >
            {props.mode === "plan" ? gt("Plan mode") : gt("Build mode")}
          </span>
        </InlineButton>
      )}
      <Dialog open={props.inspectorOpen} onOpenChange={props.onInspectorOpenChange}>
        <DialogTrigger render={<InlineButton />}>
          <span className={tone ?? "text-(--pi-foreground-accent)"}>
            {gt("Context {percent} · {used} / {capacity}", {
              percent: percentage === null ? "?" : format(percentage) + "%",
              used,
              capacity,
            })}
          </span>
        </DialogTrigger>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              <T>Context composition (estimated)</T>
            </DialogTitle>
            <DialogDescription>
              <T>Estimated token shares in the last request captured by Pi.</T>
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {counts ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-3 text-sm">
                {names.map((name, index) => (
                  <div key={index} className="contents">
                    <dt>{name}</dt>
                    <dd className="text-right tabular-nums text-muted-foreground">
                      {format(total ? ((counts[index] ?? 0) * 100) / total : 0)}%
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                <T>No context breakdown captured yet. Send a message to Pi first.</T>
              </p>
            )}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
      {(props.jobsOpen || (props.jobs?.length ?? 0) > 0) && (
        <Dialog open={props.jobsOpen ?? false} onOpenChange={props.onJobsOpenChange}>
          {(props.jobs?.length ?? 0) > 0 && (
            <DialogTrigger render={<InlineButton />}>
              {gt("Pi jobs: {count} running", {
                count: props.jobs?.filter((job) => job.status === "running").length ?? 0,
              })}
            </DialogTrigger>
          )}
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>
                {props.shellOnly ? <T>Active Pi shells</T> : <T>Pi jobs</T>}
              </DialogTitle>
              <DialogDescription>
                {props.shellOnly ? (
                  <T>Shell jobs running in this Pi session.</T>
                ) : (
                  <T>Recent shell and subagent jobs recorded by this Pi session.</T>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              {!shownJobs?.length && (
                <p className="text-sm text-muted-foreground">
                  <T>No running shells.</T>
                </p>
              )}
              <ul className="divide-y divide-border text-sm">
                {shownJobs?.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                    {job.kind === "shell" ? <T>Shell</T> : <T>Subagent</T>}
                    <span className="break-all font-mono text-xs text-muted-foreground">
                      {job.id}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {job.status === "running" ? (
                        job.background ? (
                          <T>Running in background</T>
                        ) : (
                          <T>Running in foreground</T>
                        )
                      ) : job.status === "completed" ? (
                        <T>Completed</T>
                      ) : job.status === "failed" ? (
                        <T>Failed</T>
                      ) : (
                        <T>Cancelled</T>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      )}
      {props.onOpenTrackingJournal && (
        <InlineButton onClick={props.onOpenTrackingJournal}>
          <T>Tracking in progress</T>
        </InlineButton>
      )}
      {props.model && (
        <span>
          {props.model}
          {stats?.physicalModel ? " → " + stats.physicalModel : ""}
          {stats?.effort ? " · " + stats.effort : ""}
        </span>
      )}
      {stats?.decode != null && <span>{gt("{rate} tok/s", { rate: format(stats.decode) })}</span>}
      {stats?.prefill != null && (
        <span>{gt("Prefill {rate} tok/s", { rate: format(stats.prefill) })}</span>
      )}
      {stats?.ttft != null && (
        <span>{gt("TTFT {seconds}s", { seconds: format(stats.ttft / 1000) })}</span>
      )}
      {stats?.cache != null && (
        <span>{gt("Cache {percent}%", { percent: format(stats.cache) })}</span>
      )}
      {props.workspace && (
        <span className="min-w-0 truncate" title={props.workspace}>
          {props.workspace}
        </span>
      )}
    </div>
  );
});
