import { useLocale, useMessages } from "gt-react";
import { useLayoutEffect, useState } from "react";
import {
  peekPreparedThreadTimeline,
  rememberReadyThreadTimeline,
  type PreparedThreadTimeline,
} from "../ChatView.logic";
import {
  computeStableMessagesTimelineRows,
  handoffRunsSignature,
  type MessagesTimelineRowsInput,
  sameRowsInput,
  deriveMessagesTimelineRowsWithState,
  type MessagesTimelineRow,
} from "./MessagesTimeline.logic";
import { type HandoffTimelineRun } from "./V2LifecycleRow";

const EMPTY_TIMELINE_RUNS: ReadonlyArray<HandoffTimelineRun> = [];

export function useStableHandoffRuns(
  runs: ReadonlyArray<HandoffTimelineRun>,
): ReadonlyArray<HandoffTimelineRun> {
  const [state, setState] = useState<{
    readonly source: ReadonlyArray<HandoffTimelineRun> | null;
    readonly signature: string;
    readonly value: ReadonlyArray<HandoffTimelineRun>;
  }>({ source: null, signature: "", value: EMPTY_TIMELINE_RUNS });
  if (state.source === runs) return state.value;
  const signature = handoffRunsSignature(runs);
  const value =
    signature === state.signature
      ? state.value
      : runs.map((run) => ({
          id: run.id,
          ordinal: run.ordinal,
          providerInstanceId: run.providerInstanceId,
          modelSelection: run.modelSelection,
        }));
  setState({ source: runs, signature, value });
  return value;
}

function resolvePreparedTimelineRows(
  identity: string,
  locale: string,
  input: MessagesTimelineRowsInput,
  resolve: Parameters<typeof deriveMessagesTimelineRowsWithState>[2],
  previous: PreparedThreadTimeline | null,
  remembered?: PreparedThreadTimeline,
): PreparedThreadTimeline {
  const reusable = previous?.identity === identity && previous.locale === locale ? previous : null;
  if (reusable && sameRowsInput(reusable.input, input)) return reusable;
  if (
    remembered?.identity === identity &&
    remembered.locale === locale &&
    sameRowsInput(remembered.input, input)
  ) {
    return remembered;
  }
  const projection = deriveMessagesTimelineRowsWithState(
    input,
    reusable?.projection ?? null,
    resolve,
  );
  return {
    identity,
    locale,
    input,
    projection,
    stable: computeStableMessagesTimelineRows(
      projection.rows,
      reusable?.stable ?? { byId: new Map(), result: [] },
    ),
  };
}

export function useIncrementalTimelineRows(
  identity: string,
  threadKey: string | null,
  remember: boolean,
  input: MessagesTimelineRowsInput,
): MessagesTimelineRow[] {
  // Keyed on locale: without a GTProvider, useMessages() returns a new function every render.
  const locale = useLocale();
  const resolve = useMessages();
  const [state, setState] = useState<PreparedThreadTimeline | null>(null);
  const prepared = resolvePreparedTimelineRows(
    identity,
    locale,
    input,
    resolve,
    state,
    peekPreparedThreadTimeline(threadKey),
  );
  if (state !== prepared) setState(prepared);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Remember only committed ready rows, never a render that React abandons.
  useLayoutEffect(() => {
    if (remember)
      rememberReadyThreadTimeline({ threadKey, entries: prepared.input.timelineEntries, prepared });
  }, [remember, threadKey, prepared]);
  return prepared.stable.result;
}
