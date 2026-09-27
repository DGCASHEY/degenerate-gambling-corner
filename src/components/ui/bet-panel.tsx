import type { ReactNode } from "react";
import { Button } from "./button";
import { Field, Input, SegmentedControl } from "./input";

type BetPanelProps = {
  // Unique per page, so two panels' Manual/Auto switches stay separate.
  id: string;
  // Game-specific settings (target, risk level, rows ...). Goes above the bet button.
  controls?: ReactNode;
  // The game itself: dice track, wheel, board. Takes the big area.
  stage: ReactNode;
};

/*
  The frame every Original sits in. Layout only: nothing here decides,
  calculates or sends a bet. Each game wires its own button to the server
  and animates whatever the server hands back.
*/
export function BetPanel({ id, controls, stage }: BetPanelProps) {
  return (
    <div className="group/panel flex flex-col-reverse overflow-hidden rounded-lg border border-border bg-surface lg:flex-row">
      <aside className="flex w-full flex-col gap-4 border-t border-border p-4 lg:w-80 lg:shrink-0 lg:border-t-0 lg:border-r">
        <SegmentedControl
          name={`${id}-mode`}
          label="Betting mode"
          defaultValue="manual"
          options={[
            { value: "manual", label: "Manual" },
            { value: "auto", label: "Auto" },
          ]}
        />

        <Field id={`${id}-amount`} label="Bet amount" hint="Play coins. Worth nothing.">
          <div className="flex gap-2">
            <Input
              id={`${id}-amount`}
              numeric
              inputMode="decimal"
              defaultValue="1.00"
              className="flex-1"
            />
            <Button variant="secondary" size="md" aria-label="Halve bet">
              ½
            </Button>
            <Button variant="secondary" size="md" aria-label="Double bet">
              2×
            </Button>
          </div>
        </Field>

        {controls}

        {/* Only visible while Auto is picked. */}
        <div className="hidden flex-col gap-4 group-has-[[data-mode=auto]:checked]/panel:flex">
          <Field
            id={`${id}-count`}
            label="Number of bets"
            hint="0 keeps going until you press stop."
          >
            <Input id={`${id}-count`} numeric inputMode="numeric" defaultValue="0" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field id={`${id}-stop-win`} label="Stop when up by">
              <Input id={`${id}-stop-win`} numeric inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field id={`${id}-stop-loss`} label="Stop when down by">
              <Input id={`${id}-stop-loss`} numeric inputMode="decimal" placeholder="0.00" />
            </Field>
          </div>
        </div>

        <div className="group-has-[[data-mode=auto]:checked]/panel:hidden">
          <Button size="lg" fullWidth>
            Place bet
          </Button>
        </div>
        <div className="hidden group-has-[[data-mode=auto]:checked]/panel:block">
          <Button size="lg" fullWidth>
            Start auto bet
          </Button>
        </div>
      </aside>

      <div className="flex min-h-72 flex-1 items-center justify-center bg-inset p-card">
        {stage}
      </div>
    </div>
  );
}
