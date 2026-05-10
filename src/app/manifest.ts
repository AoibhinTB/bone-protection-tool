import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bone Protection Tool",
    short_name: "Bone Protection",
    description:
      "Clinical decision support for bone protection and osteoporosis management in Ireland (NOGG 2024, NICE NG23/NG187, FRAX Ireland, IOF, ISCD).",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    categories: ["medical", "health", "productivity"],
  };
}
