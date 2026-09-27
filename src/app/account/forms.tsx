"use client";

import { useActionState } from "react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/input";
import { claimFaucetAction, savePrivacyAction, type ActionState } from "./actions";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="text-sm text-loss">{state.error}</p>;
  if (state.message) return <p role="status" className="text-sm text-win">{state.message}</p>;
  return null;
}

export function FaucetButton({
  tap,
  idempotencyKey,
  label,
  waitText,
}: {
  tap: "hourly" | "daily";
  idempotencyKey: string;
  label: string;
  // null when the tap is ready now.
  waitText: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(claimFaucetAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="tap" value={tap} />
      <input type="hidden" name="key" value={idempotencyKey} />
      <Button type="submit" fullWidth disabled={pending || waitText !== null}>
        {waitText ?? label}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function PrivacyForm({
  showInFeed,
  showOnLeaderboard,
  publicProfile,
}: {
  showInFeed: boolean;
  showOnLeaderboard: boolean;
  publicProfile: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(savePrivacyAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Switch id="show_in_feed" name="show_in_feed" label="Show my bets in the live feed" description="Off: your bets appear as Incognito." defaultChecked={showInFeed} />
      <Switch id="show_on_leaderboard" name="show_on_leaderboard" label="Show me on the leaderboard" defaultChecked={showOnLeaderboard} />
      <Switch id="public_profile" name="public_profile" label="Public profile" description="Anyone with the link can see your stats." defaultChecked={publicProfile} />
      <div className="flex items-center gap-4">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save privacy settings
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
