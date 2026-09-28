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
          <li>
            <span className="text-fg">Dice</span>: roll = the first number × 10,000, rounded down, read as
            hundredths (0.00 to 99.99). Under T wins below T, over T wins above T. A win pays the bet × 99 ÷
            win chance, rounded down to 0.01.
          </li>
          <li>
            <span className="text-fg">Limbo</span>: k = the first number × 2<sup>32</sup>. Result = 99 × 2
            <sup>32</sup> ÷ (2<sup>32</sup> − k), rounded down to 0.01×, so never below 0.99×. A result at or
            above your target wins and pays the bet × the target, rounded down to 0.01.
          </li>
          <li>
            <span className="text-fg">Wheel</span>: segment = the first number × 30, rounded down (0 to 29,
            clockwise from the pointer). It pays the bet × that segment&apos;s multiplier on your risk
            level&apos;s wheel, rounded down to 0.01. Every multiplier is printed on the Wheel page.
          </li>
          <li>
            <span className="text-fg">Keno</span>: start with 1 to 40 in order. For each of the first 10
            numbers, take the one at position = number × how many are left, rounded down (0 is the lowest),
            and remove it. Those 10 are the draw. It pays the bet × the table&apos;s multiplier for your pick
            count and hits, rounded down to 0.01. The table is printed on the Keno page.
          </li>
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
