import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicGalaxy } from "@/lib/connections";
import { PublicGalaxy } from "@/components/galaxy/galaxy";

// A read-only view of someone's galaxy, for anyone with the link (turned on in ☰ More → Share your galaxy).
// Only goals shared with all their connections are included; nothing here needs an account.

export async function generateMetadata(props: PageProps<"/g/[slug]">): Promise<Metadata> {
  const data = await publicGalaxy((await props.params).slug);
  return {
    title: data ? `${data.name}'s Goal Galaxy` : "Goal Galaxy",
    robots: { index: false, follow: false }, // shared by link, not meant for search engines
  };
}

export default async function PublicGalaxyPage(props: PageProps<"/g/[slug]">) {
  const data = await publicGalaxy((await props.params).slug);
  if (!data) notFound();
  return <PublicGalaxy name={data.name} goals={data.goals} />;
}
