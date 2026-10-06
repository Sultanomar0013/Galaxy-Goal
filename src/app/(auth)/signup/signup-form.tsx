"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signup } from "@/app/actions/auth";
import styles from "../auth.module.css";

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);

  return (
    <>
      <p className={styles.subtitle}>Create an account to start charting your goals.</p>
      <form action={action} className={styles.form} noValidate>
        {state?.message && <p className={styles.banner}>{state.message}</p>}

        <div className={styles.field}>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" autoComplete="name" defaultValue={state?.name} required />
          {state?.errors?.name && <p className={styles.error}>{state.errors.name[0]}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" defaultValue={state?.email} required />
          {state?.errors?.email && <p className={styles.error}>{state.errors.email[0]}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="new-password" required />
          {state?.errors?.password && (
            <ul className={styles.errorList}>
              {state.errors.password.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className={styles.switch}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </>
  );
}
