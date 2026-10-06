import { requireUser } from "@/lib/dal";
import { goalsForUser } from "@/lib/goals";
import { Galaxy } from "@/components/galaxy/galaxy";
import { getSocial } from "@/app/actions/connections";
import { getMultiverses } from "@/app/actions/multiverse";

export default async function Home() {
  const user = await requireUser();
  const [goals, social, multiverses] = await Promise.all([goalsForUser(user.id), getSocial(), getMultiverses()]);

  return (
    <Galaxy
      initialGoals={goals}
      initialSocial={social}
      initialMultiverses={multiverses}
      user={{ id: user.id, name: user.name }}
    />
  );
}
