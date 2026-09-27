import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "./env";

// Knows who is signed in, from their login cookie. Used for signing up,
// signing in and out, and finding out who is asking.
export async function authClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a page render, where cookies are read-only. The
          // proxy refreshes the login cookie on the next request instead.
        }
      },
    },
  });
}

// The signed-in player's id, checked with Supabase (not just read from the
// cookie). null when nobody is signed in.
export async function currentUserId(): Promise<string | null> {
  const supabase = await authClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// The server's own connection. The only thing allowed to call the wallet
// functions. Never import this from a file that runs in the browser.
export function serverClient() {
  return createClient(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
