import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "../../components/ui/card";
import { Verifier } from "./verifier";

export const metadata: Metadata = {
  title: "Check a result — Degenerate Gambling Corner",
  description: "Paste a revealed secret, your client word and a spin number. Your browser works out the result itself.",
};

type Search = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function FairnessPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-gutter py-12">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-sm text-fg-muted hover:text-fg">
          ← Degenerate Gambling Corner
        </Link>
        <h1 className="text-3xl font-bold text-fg">Check a result</h1>
        <p className="text-base text-fg-muted">
          Every result here comes from three things: our secret, your client word, and a spin number.
          We show you the secret&apos;s fingerprint before you bet, and the secret itself once you retire
          it. Paste them below and your browser works out the numbers on its own. We are not involved.
        </p>
      </header>

      <Verifier
        initialSecret={first(params.seed)}
        initialWord={first(params.word)}
        initialSpin={first(params.spin) || "0"}
        initialFingerprint={first(params.hash)}
      />

      <Card title="The recipe" description="Short enough to check with any programming language.">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-fg-muted">
          <li>
            <span className="text-fg">Fingerprint</span> = SHA-256 of the secret, written as hex. This is
            what you see before betting.
          </li>
          <li>
            <span className="text-fg">Block</span> = HMAC-SHA256 with the secret as the key and{" "}
            <code className="font-mono text-fg">word:spin:round</code> as the message. Round starts at 0.
          </li>
          <li>
            Each 4 bytes of a block, read as one whole number and divided by 2<sup>32</sup>, is one
            number from 0 up to (not including) 1.
          </li>
          <li>Games that need more than 8 numbers take the next block: round 1, then 2, and so on.</li>
          <li>Each game turns these numbers into its result. Those rules appear here as the games do.</li>
        </ol>
      </Card>

      <p className="text-sm text-fg-subtle">
        Why you can trust this: the fingerprint can only ever match one secret, so we can&apos;t change the
        secret after you see it. We can&apos;t pick a secret that suits your word either, because we seal it
        before you choose. And the spin number only goes up.
      </p>
    </main>
  );
}
