"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUserId } from "../../lib/supabase/server";
import { claimFaucet, setPrivacy, unitsToCoins, type FaucetTap } from "../../lib/wallet";
import { formatCoins } from "../../components/ui/format";

export type ActionState = { message?: string; error?: string };

async function requireUser(): Promise<string> {
  const id = await currentUserId();
  if (!id) redirect("/login");
  return id;
}

const faucetErrors: Record<string, string> = {
  faucet_not_ready: "That tap is not ready yet. The timer on the card says when it will be.",
  idempotency_key_reused: "That button was already used. Reload the page and try again.",
};

export async function claimFaucetAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const player = await requireUser();
  const tap = form.get("tap");
  // One key per rendered button. A double-click sends the same key twice,
  // and the database pays out once.
  const key = String(form.get("key") ?? "");

  if (tap !== "hourly" && tap !== "daily") return { error: "Unknown faucet tap." };
  if (key.length < 8) return { error: "The request was missing its key. Reload the page and try again." };

  const result = await claimFaucet(player, tap as FaucetTap, key);
  revalidatePath("/account");

  if (!result.ok) {
    return { error: faucetErrors[result.code] ?? `The faucet refused: ${result.code}.` };
  }
  return { message: `+${formatCoins(unitsToCoins(result.amount))} coins. Still worth nothing.` };
}

export async function savePrivacyAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const player = await requireUser();
  await setPrivacy(player, {
    showInFeed: form.get("show_in_feed") === "on",
    showOnLeaderboard: form.get("show_on_leaderboard") === "on",
    publicProfile: form.get("public_profile") === "on",
  });
  revalidatePath("/account");
  return { message: "Saved." };
}
