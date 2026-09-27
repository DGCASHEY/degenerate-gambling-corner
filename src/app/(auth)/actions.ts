"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authClient } from "../../lib/supabase/server";
import { isUsernameTaken } from "../../lib/wallet";

export type FormState = { error?: string; done?: string };

const USERNAME = /^[a-z0-9_]{3,20}$/;

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const ageConfirmed = form.get("age_confirmed") === "on";

  if (!ageConfirmed) {
    return { error: "You must be 18 or older to make an account. Tick the box if you are." };
  }
  if (!USERNAME.test(username)) {
    return { error: "Usernames are 3 to 20 characters: lowercase letters, numbers and underscores." };
  }
  if (password.length < 8) {
    return { error: "Passwords need at least 8 characters." };
  }
  if (await isUsernameTaken(username)) {
    return { error: `"${username}" is taken. Pick another.` };
  }

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await authClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // The database refuses to create an account without age_confirmed.
      data: { username, age_confirmed: true },
      emailRedirectTo: `${origin}/auth/confirm`,
    },
  });

  if (error) {
    return { error: `Sign-up failed: ${error.message}. Check the details and try again.` };
  }
  return { done: `Check ${email} for a confirmation link. Your 5,000 coins are waiting.` };
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");

  const supabase = await authClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "That email and password do not match an account. Check both and try again." };
  }
  redirect("/account");
}

export async function signOut() {
  const supabase = await authClient();
  await supabase.auth.signOut();
  redirect("/login");
}
