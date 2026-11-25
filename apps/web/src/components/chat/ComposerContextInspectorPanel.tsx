import { useGT } from "gt-react";
import { memo, useState } from "react";
import { type ContextCompositionPartition, formatContextWindowTokens } from "~/lib/contextWindow";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { ComposerBanner } from "./ComposerBanner";
import type { ChatComposerProps } from "./ChatComposer";

interface ComposerContextInspectorPanelProps {
  id: string;
  /** Pi's inspector partitions in its order; null before Pi has captured the context. */
  partitions: ReadonlyArray<ContextCompositionPartition> | null;
  contextWindow: ChatComposerProps["piContextWindow"];
  onDismiss: () => void;
}

/**
 * The context composition of Pi's terminal inspector, rendered in the composer's top drawer.
 * Pi computes the estimates; this only lays them out.
 */
export const ComposerContextInspectorPanel = memo(function ComposerContextInspectorPanel({
  id,
  partitions,
  contextWindow,
  onDismiss,
}: ComposerContextInspectorPanelProps) {
  const gt = useGT();
  const [collapsed, setCollapsed] = useState(false);
  const title = gt("Context composition (estimated)");
  const close = gt("Close context composition");
  const total = partitions?.reduce((sum, { tokens }) => sum + tokens, 0) ?? 0;
  const windowTokens = contextWindow?.maxTokens ?? null;
  const totalLine =
    partitions !== null && windowTokens !== null && windowTokens > 0
      ? gt("Estimated total {total} tokens · {percent}% of {window}", {
          total: formatContextWindowTokens(total),
          percent: Math.round((total / windowTokens) * 100),
          window: formatContextWindowTokens(windowTokens),
        })
      : partitions !== null
        ? gt("Estimated total {total} tokens", { total: formatContextWindowTokens(total) })
        : null;
  return (
    <Collapsible
      id={id}
      data-pi-context-composition={collapsed ? "collapsed" : "expanded"}
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
    >
      <CollapsibleTrigger
        render={<ComposerBanner.Row render={<button type="button" />} />}
        title={collapsed ? gt("Show the context composition") : gt("Hide the context composition")}
        data-pi-context-composition-toggle={collapsed ? "collapsed" : "expanded"}
        className="px-4 py-1.5"
      >
        <ComposerBanner.Content>
          <span className="min-w-0 truncate text-muted-foreground">{title}</span>
          {collapsed && totalLine !== null ? (
            <>
              <ComposerBanner.Separator />
              <span className="min-w-0 flex-1 truncate text-secondary-label tabular-nums">
                {totalLine}
              </span>
            </>
          ) : null}
        </ComposerBanner.Content>
        <ComposerBanner.Actions className="gap-0">
          <ComposerBanner.ToggleIcon expanded={!collapsed} />
          <ComposerBanner.Dismiss
            render={<span role="button" tabIndex={0} />}
            aria-label={close}
            title={close}
            data-pi-context-composition-dismiss
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDismiss();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onDismiss();
            }}
          />
        </ComposerBanner.Actions>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ComposerBanner.Scroll>
          <ComposerBanner.Body className="ps-6 pe-4 pb-1 wrap-anywhere sm:ps-5.5">
            {partitions === null ? (
              <p className="text-foreground/85">
                {gt("Send a message to capture the context breakdown.")}
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5" data-pi-context-composition-rows>
                  {partitions.map(({ name, tokens }) => {
                    const percent = total > 0 ? (tokens / total) * 100 : 0;
                    return (
                      <div
                        key={name}
                        className="flex items-center gap-3"
                        data-pi-context-composition-row
                      >
                        <span className="min-w-0 truncate text-foreground/85">{name}</span>
                        <span
                          aria-hidden
                          className="h-1.5 min-w-6 flex-1 overflow-hidden rounded-full bg-muted"
                        >
                          <span
                            className="block h-full rounded-full bg-primary/70"
                            style={{ width: `${percent}%` }}
                          />
                        </span>
                        <span className="w-12 shrink-0 text-right text-muted-foreground tabular-nums">
                          {percent.toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-muted-foreground tabular-nums">{totalLine}</p>
              </>
            )}
          </ComposerBanner.Body>
        </ComposerBanner.Scroll>
      </CollapsiblePanel>
    </Collapsible>
  );
});
