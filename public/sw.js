async function showBrandedNotification(payload) {
  let branding = { name: "CRM", revision: "default" };
  try {
    const response = await fetch("/api/branding", { cache: "no-store" });
    if (response.ok) branding = await response.json();
  } catch {
    /* Use the neutral identity while offline. */
  }
  const icon = `/app-icon.png?v=${encodeURIComponent(branding.revision)}`;
  const title =
    payload.title && payload.title !== "CRM"
      ? `${branding.name} · ${payload.title}`
      : branding.name;
  return self.registration.showNotification(title, {
    body: payload.body || "Há uma atualização no seu CRM.",
    icon,
    badge: icon,
    tag: payload.tag || "crm-notification",
    renotify: Boolean(payload.renotify),
    data: { url: payload.url || "/tarefas" },
  });
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "Você tem uma nova notificação." };
  }

  event.waitUntil(showBrandedNotification(payload));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/tarefas", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existingClient) {
        existingClient.navigate(targetUrl);
        return existingClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
