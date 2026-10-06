"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login } from "@/app/actions/auth";
import styles from "../auth.module.css";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <>
      <p className={styles.subtitle}>Welcome back. Log in to see your galaxy.</p>
      <form action={action} className={styles.form} noValidate>
        {state?.message && <p className={styles.banner}>{state.message}</p>}

        <div className={styles.field}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" defaultValue={state?.email} required />
          {state?.errors?.email && <p className={styles.error}>{state.errors.email[0]}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          {state?.errors?.password && <p className={styles.error}>{state.errors.password[0]}</p>}
        </div>

        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className={styles.switch}>
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </>
  );
}
