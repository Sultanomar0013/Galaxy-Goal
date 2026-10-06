import type { GoalDTO } from "@/lib/goals";
import type { SocialState } from "@/app/actions/connections";
import type { MultiverseDTO } from "@/app/actions/multiverse";

// The engine calls these server actions by name (see API in galaxy.tsx); a read-only galaxy gets stubs.
type Api = Record<string, (...args: never[]) => Promise<unknown>>;

export type GalaxyOptions = {
  initialGoals: GoalDTO[];
  initialSocial: SocialState | null;
  initialMultiverses: MultiverseDTO[];
  user: { id: string; name: string };
  api: Api;
  // a shared link: no editing, no connections, no live updates
  readOnly?: boolean;
};

export function startGalaxy(root: HTMLElement, options: GalaxyOptions): () => void;
