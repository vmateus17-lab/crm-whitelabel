/** Preserve a private view after login without allowing external redirects. */
export function safeLoginRedirect(value: string | null, origin: string): string {
  if (!value || value.startsWith("//") || value.includes("\\")) return "/dashboard";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname === "/login" || url.username || url.password)
      return "/dashboard";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
