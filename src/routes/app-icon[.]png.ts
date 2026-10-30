import { createFileRoute } from "@tanstack/react-router";
import { readPublicBranding } from "@/lib/branding.server";

export const Route = createFileRoute("/app-icon.png")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const branding = await readPublicBranding();
        if (!branding.logo) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: new URL("/icons/default.png", request.url).href,
              "Cache-Control": "no-store",
            },
          });
        }
        const bytes = Uint8Array.from(atob(branding.logo.split(",")[1]), (char) =>
          char.charCodeAt(0),
        );
        return new Response(bytes, {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
