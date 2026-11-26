import type { ChatComposerProps } from "./ChatComposer";
import type { PromptUltrathink } from "./TraitsPicker";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { type AppModelOption } from "../../modelSelection";
import { useGT, useMessages } from "gt-react";
import { CircleAlertIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { ComposerControl } from "./ComposerControl";
import {
  ComposerFooterModeControls,
  ComposerModelPicker,
  type RuntimeModeOption,
} from "./ComposerFooterControls";
import {
  type EnvironmentId,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type RuntimeMode,
  type ServerProvider,
} from "@t3tools/contracts";
import type { EffortDisplay } from "@t3tools/contracts/settings";
import { cn } from "~/lib/utils";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { observeResize } from "~/lib/observeResize";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveComposerTraitsInput } from "./composerProviderState";
import { useApplyThreadModelPick } from "./useApplyThreadModelPick";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  ComposerEffortColumn,
  ComposerPickerFooter,
  describeComposerEffort,
} from "./ComposerModelEffort";
import type { useComposerProviderModel } from "./useComposerProviderModel";
import { resolveComposerControlsOwnership } from "./composerControlsOwnership";

/**
 * The composer footer controls: the model picker (which also holds effort, speed and
 * permissions), mode controls and the overflow menu for blocks that do not fit. Rendered in the
 * expanded footer or the resting controls host.
 */
// Model and effort share one trigger; it stays filled while its popup is open.
const MODEL_TRIGGER_STATES = "data-popup-open:bg-accent data-popup-open:text-foreground";

function PiContextRing({
  usage,
  compositionOpen,
  compositionPanelId,
  onToggleComposition,
}: {
  usage: NonNullable<ChatComposerProps["piContextWindow"]>;
  compositionOpen: boolean;
  compositionPanelId: string;
  onToggleComposition: () => void;
}) {
  const gt = useGT();
  const used = formatContextWindowTokens(usage.usedTokens);
  const percent = usage.usedPercentage;
  const label =
    percent !== null && usage.maxTokens != null
      ? gt("Context: {percent}% used · {used} / {total} tokens", {
          percent: Math.round(percent),
          used,
          total: formatContextWindowTokens(usage.maxTokens),
        })
      : gt("Context: {used} tokens used", { used });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-expanded={compositionOpen}
            aria-controls={compositionOpen ? compositionPanelId : undefined}
            aria-label={gt("Context composition: {label}", { label })}
            data-pi-context-ring
            onClick={onToggleComposition}
            className="inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" strokeWidth="2">
          <circle cx="8" cy="8" r="6" stroke="currentColor" className="opacity-30" />
          {percent !== null && percent > 0 ? (
            <circle
              cx="8"
              cy="8"
              r="6"
              pathLength="100"
              stroke="currentColor"
              strokeDasharray={`${percent} 100`}
              transform="rotate(-90 8 8)"
            />
          ) : null}
        </svg>
        <span
          aria-hidden="true"
          className={cn(
            "ms-1.5 text-xs tabular-nums",
            percent === null
              ? ""
              : percent > 90
                ? "text-destructive"
                : percent > 70
                  ? "text-warning"
                  : "",
          )}
        >
          {usage.maxTokens != null ? `${used}/${formatContextWindowTokens(usage.maxTokens)}` : used}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function PiFooterMetrics({ label, afterContext }: { label: string; afterContext: boolean }) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the full metrics group is visible only when both observed widths fit
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const content = labelRef.current;
    if (!trigger || !content) return;
    const measure = () =>
      setFits(content.getBoundingClientRect().width <= trigger.getBoundingClientRect().width);
    measure();
    return observeResize([trigger, content], measure);
  }, []);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            ref={triggerRef}
            data-pi-footer-metrics
            tabIndex={fits ? 0 : undefined}
            className={cn(
              "me-1 hidden min-w-0 overflow-hidden whitespace-nowrap text-xs text-muted-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @min-[32rem]/composer-surface:block",
              !fits && "invisible order-first",
            )}
          />
        }
      >
        <span ref={labelRef} className="inline-block w-max">
          {afterContext ? (
            <span aria-hidden="true" className="me-1.5">
              ·
            </span>
          ) : null}
          {label}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

export function ComposerControlsBar(props: {
  environmentId: EnvironmentId;
  workspaceCwd: string | null;
  routeKind: ChatComposerProps["routeKind"];
  routeThreadRef: ChatComposerProps["routeThreadRef"];
  draftId: ChatComposerProps["draftId"];
  selectedProvider: ProviderDriverKind;
  selectedInstanceId: ProviderInstanceId;
  selectedModel: string;
  selectedProviderModels: ServerProvider["models"];
  composerModelOptions: ReturnType<typeof useComposerProviderModel>["composerModelOptions"];
  reportedModelSelection: ChatComposerProps["reportedModelSelection"];
  piContextWindow?: ChatComposerProps["piContextWindow"];
  piFooterMetrics?: string | undefined;
  /** The context composition card above the composer; the ring toggles it. */
  contextInspectorOpen: boolean;
  contextInspectorPanelId: string;
  onToggleContextInspector: () => void;
  promptUltrathink: PromptUltrathink;
  onPromptEdit: (edit: (prompt: string) => string) => void;
  effortDisplay: EffortDisplay;
  /** The strip under a new thread names the permissions, so the row does not repeat them. */
  permissionsShownInStrip: boolean;
  compatibleRuntimeMode: RuntimeMode;
  defaultRuntimeMode: RuntimeMode | undefined;
  compatibleRuntimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  composerControlsCollapsed: boolean;
  composerControlsHidden: boolean;
  restingHiddenBlockCount: number;
  iconOnlyBlockCount: number;
  showProviderUnavailable: boolean;
  providerSetupInstanceId: ProviderInstanceId | undefined;
  onOpenProviderSetup: ChatComposerProps["onOpenProviderSetup"];
  providerCatalogPending: boolean;
  isSendBusy: boolean;
  multipleModelsEnabled: boolean;
  multipleModelSelections: ChatComposerProps["multipleModelSelections"];
  onMultipleModelSelectionsChange: ChatComposerProps["onMultipleModelSelectionsChange"];
  selectedModelSelection: ModelSelection;
  onProviderModelSelect: ChatComposerProps["onProviderModelSelect"];
  activeThreadModelSelection: ChatComposerProps["activeThreadModelSelection"];
  selectedModelForPickerWithCustomFallback: string;
  lockedProvider: ChatComposerProps["lockedProvider"];
  lockedContinuationGroupKey: string | null;
  providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings: ChatComposerProps["keybindings"];
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  terminalOpen: boolean;
  modelPickerOpen: boolean;
  onModelPickerOpenChange: (open: boolean) => void;
  modelPickerIconClassName: string | undefined;
  getModelDisabledReason: ChatComposerProps["getModelDisabledReason"];
}) {
  const {
    environmentId,
    routeKind,
    routeThreadRef,
    draftId,
    selectedProvider,
    selectedInstanceId,
    selectedModel,
    selectedProviderModels,
    composerModelOptions,
    reportedModelSelection,
    contextInspectorOpen,
    contextInspectorPanelId,
    onToggleContextInspector,
    promptUltrathink,
    onPromptEdit,
    compatibleRuntimeMode,
    defaultRuntimeMode,
    compatibleRuntimeModeOptions,
    handleRuntimeModeChange,
    composerControlsCollapsed,
    composerControlsHidden,
    restingHiddenBlockCount: measuredHiddenBlockCount,
    iconOnlyBlockCount,
    showProviderUnavailable,
    providerSetupInstanceId,
    onOpenProviderSetup,
    providerCatalogPending,
    isSendBusy,
    multipleModelsEnabled,
    multipleModelSelections,
    onMultipleModelSelectionsChange,
    selectedModelSelection,
    onProviderModelSelect,
    activeThreadModelSelection,
    selectedModelForPickerWithCustomFallback,
    lockedProvider,
    lockedContinuationGroupKey,
    providerInstanceEntries,
    keybindings,
    modelOptionsByInstance,
    terminalOpen,
    modelPickerOpen,
    onModelPickerOpenChange,
    modelPickerIconClassName,
    getModelDisabledReason,
  } = props;
  const accessMatchesDefault = compatibleRuntimeMode === defaultRuntimeMode;
  const {
    accessDisplay,
    showModeBlock,
    hiddenBlockCount: restingHiddenBlockCount,
    hiddenBlockIds: hiddenRestingBlockIds,
    overflowShowsPermissions,
    pickerOwnsModeShortcut,
  } = resolveComposerControlsOwnership({
    matchesDefault: accessMatchesDefault || props.permissionsShownInStrip,
    collapsed: composerControlsCollapsed,
    measuredHiddenBlockCount,
  });
  const controlSize = composerControlsCollapsed ? "xs" : "sm";
  // Existing Pi processes can still publish an unprefixed or missing decode rate.
  const piFooterMetrics =
    props.piFooterMetrics
      ?.replace(/^(?=\d+(?:\.\d+)? tok\/s(?: · |$))/, "TPS ")
      .replace(/^(?=TTFT )/, "TPS ~ · ") ??
    (props.piContextWindow ? "TPS ~ · TTFT ~ · Cache ~" : undefined);
  const gt = useGT();
  const m = useMessages();
  const applyThreadModelPick = useApplyThreadModelPick();
  const applyRouteThreadModelPick = useStableCallback(() => applyThreadModelPick(routeThreadRef));
  const traitsInput = resolveComposerTraitsInput({
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server"
      ? { threadRef: routeThreadRef, onDraftModelOptionsChange: applyRouteThreadModelPick }
      : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    reportedModelSelection,
    promptUltrathink,
    onPromptEdit,
  });
  const effort = describeComposerEffort(traitsInput, props.effortDisplay, controlSize, m);
  const restingBlockDefs = showModeBlock
    ? [
        {
          id: "mode",
          content: (
            <ComposerFooterModeControls
              runtimeMode={compatibleRuntimeMode}
              runtimeModeOptions={compatibleRuntimeModeOptions}
              size={controlSize}
              hidden={composerControlsHidden || restingHiddenBlockCount > 0}
              accessDisplay={accessDisplay}
              emphasized={!accessMatchesDefault}
              onRuntimeModeChange={handleRuntimeModeChange}
            />
          ),
        },
      ]
    : [];
  // Its own element, so typing (which rebuilds the controls around it) leaves it cached.
  const composerModelPicker = (
    <ComposerModelPicker
      environmentId={environmentId}
      workspaceCwd={props.workspaceCwd}
      compact={false}
      isComposerOwned
      // The trigger grows away from this edge when its model or effort label changes.
      popupAlign={composerControlsCollapsed ? "start" : "end"}
      disabled={providerCatalogPending || isSendBusy}
      multipleModelsEnabled={multipleModelsEnabled}
      multipleModelSelections={multipleModelSelections}
      onMultipleModelSelectionsChange={onMultipleModelSelectionsChange}
      selectedModelSelection={selectedModelSelection}
      onProviderModelSelect={onProviderModelSelect}
      activeInstanceId={
        providerCatalogPending
          ? (activeThreadModelSelection?.instanceId ?? selectedInstanceId)
          : selectedInstanceId
      }
      model={
        providerCatalogPending
          ? (activeThreadModelSelection?.model ?? selectedModelForPickerWithCustomFallback)
          : selectedModelForPickerWithCustomFallback
      }
      lockedProvider={lockedProvider}
      lockedContinuationGroupKey={lockedContinuationGroupKey}
      instanceEntries={providerInstanceEntries}
      keybindings={keybindings}
      modelOptionsByInstance={modelOptionsByInstance}
      size={controlSize}
      triggerClassName={cn(
        "group/model-trigger",
        MODEL_TRIGGER_STATES,
        composerControlsCollapsed ? "min-w-13 shrink text-xs!" : "min-w-13",
      )}
      triggerSuffix={effort.suffix}
      triggerDetail={effort.detail}
      triggerShortcuts={
        pickerOwnsModeShortcut ? "composer.effort composer.mode" : "composer.effort"
      }
      effortColumn={<ComposerEffortColumn traits={traitsInput} />}
      footer={
        <ComposerPickerFooter
          traits={traitsInput}
          runtimeMode={compatibleRuntimeMode}
          runtimeModeOptions={compatibleRuntimeModeOptions}
          onRuntimeModeChange={handleRuntimeModeChange}
        />
      }
      terminalOpen={terminalOpen}
      open={modelPickerOpen}
      instanceIndicatorBackground={
        composerControlsCollapsed
          ? "color-mix(in srgb, var(--chat-composer-glass-surface) var(--glass-opacity), transparent)"
          : "var(--contrast-input)"
      }
      {...(modelPickerIconClassName
        ? { activeProviderIconClassName: modelPickerIconClassName }
        : {})}
      onOpenChange={onModelPickerOpenChange}
      getModelDisabledReason={getModelDisabledReason}
      onOpenProviderSetup={onOpenProviderSetup}
    />
  );
  return showProviderUnavailable ? (
    <ComposerControl
      type="button"
      disabled={!providerSetupInstanceId}
      onClick={() => {
        if (providerSetupInstanceId) {
          onOpenProviderSetup(providerSetupInstanceId);
        }
      }}
      data-chat-provider-unavailable="true"
      className="shrink-0"
    >
      <CircleAlertIcon className="size-4" />
      {providerSetupInstanceId ? gt("Open provider settings") : gt("No provider available")}
    </ComposerControl>
  ) : (
    <>
      {selectedProvider === "pi" && props.piContextWindow ? (
        <PiContextRing
          usage={props.piContextWindow}
          compositionOpen={contextInspectorOpen}
          compositionPanelId={contextInspectorPanelId}
          onToggleComposition={onToggleContextInspector}
        />
      ) : null}
      {selectedProvider === "pi" && piFooterMetrics && !composerControlsCollapsed ? (
        <PiFooterMetrics label={piFooterMetrics} afterContext={!!props.piContextWindow} />
      ) : null}
      {composerModelPicker}

      <>
        {restingBlockDefs.map((def, index) => {
          const hidden = index >= restingBlockDefs.length - restingHiddenBlockCount;
          return (
            <div
              key={def.id}
              data-resting-block={def.id}
              data-composer-block-icon-only={
                index >= restingBlockDefs.length - iconOnlyBlockCount ? "true" : "false"
              }
              aria-hidden={hidden || undefined}
              inert={hidden || undefined}
              className={cn(
                "flex w-max min-w-max shrink-0 items-center gap-1",
                hidden && "pointer-events-none invisible absolute",
                index >= restingBlockDefs.length - iconOnlyBlockCount &&
                  "[&_[data-composer-control-label]]:pointer-events-none [&_[data-composer-control-label]]:invisible [&_[data-composer-control-label]]:absolute [&_[data-composer-control-label]]:w-max [&_[data-composer-control-label]]:max-w-none [&_[data-composer-control-compact-icon]]:[visibility:inherit] [&_[data-composer-control-compact-icon]]:relative",
              )}
            >
              {def.content}
            </div>
          );
        })}
        <div
          data-resting-controls-overflow
          aria-hidden={hiddenRestingBlockIds.length === 0 || undefined}
          inert={hiddenRestingBlockIds.length === 0 || undefined}
          className={cn(
            "min-w-0 shrink-0",
            hiddenRestingBlockIds.length === 0 && "pointer-events-none invisible absolute",
          )}
        >
          <CompactComposerControlsMenu
            runtimeMode={compatibleRuntimeMode}
            runtimeModeOptions={compatibleRuntimeModeOptions}
            size={controlSize}
            hidden={composerControlsHidden || hiddenRestingBlockIds.length === 0}
            // Permissions join the overflow only when their normal home is in it.
            showPermissions={overflowShowsPermissions}
            onRuntimeModeChange={handleRuntimeModeChange}
          />
        </div>
      </>
    </>
  );
}
