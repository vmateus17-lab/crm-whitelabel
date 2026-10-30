import { createFileRoute } from "@tanstack/react-router";
import { readPublicBranding } from "@/lib/branding.server";
import { brandingManifest } from "@/lib/branding";

export const Route = createFileRoute("/app.webmanifest")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(brandingManifest(await readPublicBranding()), {
          headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" },
        }),
    },
  },
});
