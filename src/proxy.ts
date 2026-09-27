import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseAuthConfigured, supabaseUrl } from "./lib/supabase/env";

// Runs before each page request and refreshes the player's login cookie
// if it is about to expire. It does not decide who may do what; every page
// and action checks that for itself.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // A missing setting should break sign-in, not every page on the site.
  if (!supabaseAuthConfigured()) {
    console.error(
      "Supabase settings missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Login refresh skipped.",
    );
    return response;
  }

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Skip images, fonts and other static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|mascot/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
