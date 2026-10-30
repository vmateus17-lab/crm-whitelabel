import { createMiddleware, createStart } from "@tanstack/react-start";
import { withSecurityHeaders } from "@/lib/security-headers";

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();

  return {
    ...result,
    response: withSecurityHeaders(result.response, import.meta.env.PROD),
  };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware],
}));
