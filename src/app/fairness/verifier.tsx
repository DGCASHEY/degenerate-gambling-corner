"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Field, Input } from "../../components/ui/input";
import { Table, Td, Th } from "../../components/ui/table";
import { fairNumbers, fingerprint, MAX_NUMBERS_PER_SPIN } from "../../lib/fairness";

// Works out everything in the visitor's own browser. Nothing typed here is
// sent anywhere.

type Worked = { key: string; hash: string; numbers: number[] | null };

type Props = {
  initialSecret: string;
  initialWord: string;
  initialSpin: string;
  initialFingerprint: string;
};

function wholeNumber(value: string, max: number): number | null {
  if (!/^\d{1,16}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n <= max ? n : null;
}

export function Verifier({ initialSecret, initialWord, initialSpin, initialFingerprint }: Props) {
  const [secret, setSecret] = useState(initialSecret);
  const [word, setWord] = useState(initialWord);
  const [spin, setSpin] = useState(initialSpin);
  const [count, setCount] = useState("8");
  const [shown, setShown] = useState(initialFingerprint);
  const [worked, setWorked] = useState<Worked | null>(null);

  const spinNumber = wholeNumber(spin, Number.MAX_SAFE_INTEGER);
  const countNumber = wholeNumber(count, MAX_NUMBERS_PER_SPIN);
  const canWorkOut = word !== "" && spinNumber !== null && countNumber !== null && countNumber >= 1;
  const key = JSON.stringify([secret, word, spinNumber, countNumber]);

  useEffect(() => {
    if (secret === "") return;
    let current = true;
    (async () => {
      const hash = await fingerprint(secret);
      const numbers = canWorkOut ? await fairNumbers(secret, word, spinNumber!, countNumber!) : null;
      if (current) setWorked({ key, hash, numbers });
    })();
    return () => {
      current = false;
    };
  }, [key, secret, word, spinNumber, countNumber, canWorkOut]);

  // Only show a result that belongs to what is typed right now.
  const result = secret !== "" && worked?.key === key ? worked : null;
  const shownClean = shown.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-gutter">
      <Card title="Your three values" description="Everything below is worked out on this device. Nothing you type is sent to us.">
        <div className="flex flex-col gap-4">
          <Field
            id="seed"
            label="Revealed secret"
            hint="64 characters, 0–9 and a–f. You get it when you change your client word."
            error={secret !== "" && !/^[0-9a-f]{64}$/.test(secret) ? "Our secrets are exactly 64 characters of 0–9 and a–f. This one isn't, so it isn't one of ours. The numbers below are still worked out from it." : undefined}
          >
            <Input id="seed" value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} autoComplete="off" numeric />
          </Field>
          <Field id="word" label="Client word" hint="Exactly as it was, including capitals.">
            <Input id="word" value={word} onChange={(e) => setWord(e.target.value)} spellCheck={false} autoComplete="off" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="spin" label="Spin number" error={spinNumber === null ? "A whole number, 0 or more." : undefined} hint="The first spin with a secret is 0.">
              <Input id="spin" value={spin} onChange={(e) => setSpin(e.target.value)} inputMode="numeric" numeric />
            </Field>
            <Field id="count" label="How many numbers" error={countNumber === null || countNumber < 1 ? `From 1 to ${MAX_NUMBERS_PER_SPIN}.` : undefined} hint="Games that need more take more.">
              <Input id="count" value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" numeric />
            </Field>
          </div>
          <Field id="shown" label="Fingerprint you were shown (optional)" hint="Paste it to have it compared for you.">
            <Input id="shown" value={shown} onChange={(e) => setShown(e.target.value)} spellCheck={false} autoComplete="off" numeric />
          </Field>
        </div>
      </Card>

      <Card title="The secret's fingerprint" description="SHA-256 of the secret. It should equal the one you saw before betting.">
        {result ? (
          <div className="flex flex-col gap-2">
            <p className="font-mono text-sm break-all text-fg" data-testid="fingerprint">{result.hash}</p>
            {shownClean === "" ? null : shownClean === result.hash ? (
              <p role="status" className="text-sm text-win">
                Matches the fingerprint you were shown. The secret was not swapped after you saw it.
              </p>
            ) : (
              <p role="alert" className="text-sm text-loss">
                Does not match. Check the paste for a missing character first. If it is exact, we swapped
                the secret, and you should tell people.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-fg-subtle">Paste a secret to see its fingerprint.</p>
        )}
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-fg">The numbers</h2>
        {result?.numbers ? (
          <Table>
            <thead>
              <tr>
                <Th numeric>#</Th>
                <Th numeric>Number (0 to 1)</Th>
              </tr>
            </thead>
            <tbody>
              {result.numbers.map((n, i) => (
                <tr key={i}>
                  <Td numeric>{i + 1}</Td>
                  <Td numeric>{String(n)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-fg-subtle">Fill in the secret, word and spin number to see them.</p>
        )}
      </section>
    </div>
  );
}
