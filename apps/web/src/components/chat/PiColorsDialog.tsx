import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { useState, type CSSProperties } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

const hex = /^#[0-9a-f]{6}$/i;
const HexColor = Schema.String.check(Schema.isPattern(hex));
const Palette = Schema.Struct({ build: HexColor, plan: HexColor, accent: HexColor });
type Palette = typeof Palette.Type;
const defaults: Palette = { build: "#73b9f8", plan: "#cc5ce9", accent: "#b7d6f2" };

export function usePiColors() {
  return useLocalStorage("t3code:pi-colors", defaults, Palette);
}

export function piColorsStyle(palette: Palette): CSSProperties {
  return {
    "--pi-build-indicator": palette.build,
    "--pi-plan-indicator": palette.plan,
    "--pi-foreground-accent": palette.accent,
  } as CSSProperties;
}

export function PiColorsDialog({
  colors,
  onSave,
  onClose,
}: {
  readonly colors: Palette;
  readonly onSave: (colors: Palette) => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState(colors);
  const valid = Object.values(draft).every((value) => hex.test(value));
  const fields = [
    { key: "build", label: gt("Build indicators") },
    { key: "plan", label: gt("Plan indicators") },
    { key: "accent", label: gt("Theme accent") },
  ] as const;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            <T>Pi colors</T>
          </DialogTitle>
          <DialogDescription>
            <T>Customize the colors used by Pi in T3 Code.</T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            {fields.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{label}</span>
                <span
                  aria-hidden
                  className="size-4 rounded-sm border border-border"
                  style={{ backgroundColor: hex.test(draft[key]) ? draft[key] : colors[key] }}
                />
                <Input
                  nativeInput
                  font="mono"
                  className="w-28"
                  spellCheck={false}
                  maxLength={7}
                  aria-invalid={!hex.test(draft[key])}
                  value={draft[key]}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                />
              </label>
            ))}
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            <T>Cancel</T>
          </DialogClose>
          <Button
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              onSave(draft);
              onClose();
            }}
          >
            <T>Save</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
