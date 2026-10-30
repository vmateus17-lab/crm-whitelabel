import { createFileRoute } from "@tanstack/react-router";
import { readPublicBranding } from "@/lib/branding.server";

export const Route = createFileRoute("/api/branding")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(await readPublicBranding(), {
          headers: { "Cache-Control": "no-store" },
        }),
    },
  },
});
