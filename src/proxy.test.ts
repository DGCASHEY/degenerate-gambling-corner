import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

describe("proxy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("lets pages load when the Supabase settings are missing, instead of crashing every page", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await proxy(new NextRequest("https://dgcbet.net/"));

    expect(response.status).toBe(200);
  });
});
