import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { useIncrementalTimelineEntries } from "../../hooks/useIncrementalTimelineEntries";
import type { TimelineEntriesInput, TimelineEntry } from "../../session-logic";
import { useTimelineVisibleTurnItems } from "../../state/entities";
import {
  isPiModeCommand,
  resolveThreadSwitchTimeline,
  timelineHasEphemeralPreviewUrls,
} from "../ChatView.logic";
import { MessagesTimeline } from "./MessagesTimeline";

function isHiddenPiModeEntry(entry: TimelineEntry): boolean {
  return (
    entry.kind === "message" &&
    entry.message.role === "user" &&
    !entry.message.attachments?.length &&
    isPiModeCommand(entry.message.text)
  );
}

/**
 * The timeline with the streamed text. ChatView reads the thread through its quiet
 * atoms, which hold through text deltas; this reads the live turn items, so a
 * reasoning delta re-renders the timeline without re-rendering ChatView. Streamed
 * assistant text reaches only its own row, through useAssistantMessageText.
 */
export function ThreadTimeline({
  threadDetailRef,
  entriesInput,
  draftEntries,
  activeThreadKey,
  syncing,
  detailLoading,
  hidePiModeCommands,
  ...timelineProps
}: Omit<ComponentProps<typeof MessagesTimeline>, "timelineEntries"> & {
  /** Null until the thread's detail may load; see resolveThreadDetailRef. */
  threadDetailRef: ScopedThreadRef | null;
  entriesInput: Omit<TimelineEntriesInput, "visibleTurnItems">;
  /** A local draft's optimistic rows; null for a server thread. */
  draftEntries: ReadonlyArray<TimelineEntry> | null;
  activeThreadKey: string | null;
  syncing: boolean;
  detailLoading: boolean;
  hidePiModeCommands: boolean;
}) {
  const visibleTurnItems = useTimelineVisibleTurnItems(threadDetailRef);
  const serverEntries = useIncrementalTimelineEntries(activeThreadKey, {
    ...entriesInput,
    visibleTurnItems,
  });
  const allEntries = draftEntries ?? serverEntries;
  const entries =
    hidePiModeCommands && allEntries.some(isHiddenPiModeEntry)
      ? allEntries.filter((entry) => !isHiddenPiModeEntry(entry))
      : allEntries;
  const cacheable = !timelineHasEphemeralPreviewUrls(entries);
  const displayedEntries = resolveThreadSwitchTimeline({
    loading: detailLoading,
    activeThreadKey,
    nextEntries: entries,
  });
  const showingCachedEntries = displayedEntries !== entries;
  return (
    <MessagesTimeline
      {...timelineProps}
      cachedPaintOnly={showingCachedEntries}
      syncing={syncing}
      timelineEntries={displayedEntries}
      timelineCacheKey={activeThreadKey}
      rememberTimelineRows={!syncing && cacheable && entries.length > 0}
    />
  );
}
