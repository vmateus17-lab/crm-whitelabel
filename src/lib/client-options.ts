const clientNameCollator = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});

/** Sort a copy so dropdown ordering never mutates the source client list. */
export function sortClientsByName<T extends { id: string; name: string }>(clients: readonly T[]) {
  return [...clients].sort(
    (a, b) => clientNameCollator.compare(a.name.trim(), b.name.trim()) || a.id.localeCompare(b.id),
  );
}
