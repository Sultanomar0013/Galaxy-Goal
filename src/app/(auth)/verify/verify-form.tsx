"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { resendCode, verifyEmail } from "@/app/actions/auth";
import styles from "../auth.module.css";

const COOLDOWN = 60;

export function VerifyForm({ email, sendFailed }: { email: string; sendFailed: boolean }) {
  const [verifyState, verifyAction, verifying] = useActionState(verifyEmail, undefined);
  const [resendState, resendAction, resending] = useActionState(resendCode, undefined);

  // Mirrors the server's resend cooldown so the button isn't clickable while it would be refused.
  const [wait, setWait] = useState(sendFailed ? 0 : COOLDOWN);
  const [sentAt, setSentAt] = useState<typeof resendState>(undefined);
  if (resendState !== sentAt) {
    setSentAt(resendState);
    if (resendState?.info) setWait(COOLDOWN);
  }
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  return (
    <>
      <p className={styles.subtitle}>
        We sent a 6-digit code to <strong>{email}</strong>. Enter it below to finish signing up.
      </p>

      {sendFailed && !resendState && (
        <p className={styles.banner}>We couldn&apos;t send the email. Use &ldquo;Send a new code&rdquo; to try again.</p>
      )}

      <form action={verifyAction} className={styles.form} noValidate>
        {verifyState?.error && <p className={styles.banner}>{verifyState.error}</p>}
        {verifyState?.info && <p className={styles.notice}>{verifyState.info}</p>}

        <input type="hidden" name="email" value={email} />
        <div className={styles.field}>
          <label htmlFor="code">Verification code</label>
          <input
            id="code"
            name="code"
            className={styles.code}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="000000"
            autoFocus
            required
          />
        </div>

        <button type="submit" className={styles.submit} disabled={verifying}>
          {verifying ? "Checking…" : "Verify and log in"}
        </button>
      </form>

      {resendState?.error && <p className={`${styles.banner} ${styles.gapTop}`}>{resendState.error}</p>}
      {resendState?.info && <p className={`${styles.notice} ${styles.gapTop}`}>{resendState.info}</p>}
      <form action={resendAction} className={styles.switch}>
        <input type="hidden" name="email" value={email} />
        Didn&apos;t get it? Check spam, or{" "}
        <button type="submit" className={styles.linkButton} disabled={resending || wait > 0}>
          {wait > 0 ? `send a new code in ${wait}s` : resending ? "sending…" : "send a new code"}
        </button>
      </form>
      <p className={styles.switch}>
        <Link href="/login">Back to log in</Link>
      </p>
    </>
  );
}
