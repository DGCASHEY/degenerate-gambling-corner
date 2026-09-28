import { unstable_rethrow } from "next/navigation";
import { currentUserId } from "../lib/supabase/server";
import { getAccount, getBalance, unitsToCoins } from "../lib/wallet";
import { HomeView, type Player } from "./home-view";

// Who is looking, and their balance. If the lookup fails (Supabase settings
// missing, database asleep), show the signed-out page rather than a 500.
async function loadPlayer(): Promise<Player> {
  try {
    const id = await currentUserId();
    if (!id) return null;
    const [account, balance] = await Promise.all([getAccount(id), getBalance(id)]);
    if (!account) return null;
    return { username: account.username, coins: unitsToCoins(balance) };
  } catch (error) {
    unstable_rethrow(error); // let Next.js's own signals through
    console.error("Homepage could not load the player:", error);
    return null;
  }
}

export default async function Home() {
  return <HomeView player={await loadPlayer()} />;
}
