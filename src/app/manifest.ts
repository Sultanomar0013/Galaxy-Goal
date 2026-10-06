import type { MetadataRoute } from "next";

// Lets browsers install Goal Galaxy as an app (home screen / desktop). Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Goal Galaxy",
    short_name: "Goal Galaxy",
    description: "Your goals as a solar system",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#04050d",
    theme_color: "#04050d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
