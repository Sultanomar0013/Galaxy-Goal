import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import styles from "./auth.module.css";

// Logged-in users have no business on /login or /signup.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.brand}>Goal Galaxy</h1>
        {children}
      </div>
    </main>
  );
}
