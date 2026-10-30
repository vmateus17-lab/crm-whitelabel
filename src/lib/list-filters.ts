import { useCallback, useEffect, useRef, useState } from "react";
import { readFilterParams, writeFilterParams } from "@/lib/filter-utils";

export type SavedFilterView = { id: string; name: string; filters: Record<string, string> };

export function useListFilters<T extends Record<string, string>>(
  defaults: T,
  namespace: string,
  userId?: string,
  allowed: Partial<Record<keyof T, readonly string[]>> = {},
) {
  const defaultsRef = useRef(defaults);
  const allowedRef = useRef(allowed);
  const [filters, updateFilters] = useState<T>(() =>
    readFilterParams(
      new URLSearchParams(typeof window === "undefined" ? "" : window.location.search),
      defaults,
      allowed,
    ),
  );
  const currentRef = useRef(filters);
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);
  const storageKey = userId ? `crm:views:${userId}:${namespace}` : null;

  const setFilters = useCallback((partial: Partial<T>) => {
    const next = { ...currentRef.current, ...partial };
    currentRef.current = next;
    updateFilters(next);
    const url = new URL(window.location.href);
    url.search = writeFilterParams(url.searchParams, next, defaultsRef.current).toString();
    window.history.replaceState(window.history.state, "", url);
  }, []);
  const setFilter = useCallback(
    (key: keyof T, value: string) => {
      setFilters({ [key]: value } as Partial<T>);
    },
    [setFilters],
  );
  const resetFilters = useCallback(() => setFilters(defaultsRef.current), [setFilters]);

  useEffect(() => {
    const restore = () => {
      const next = readFilterParams(
        new URLSearchParams(window.location.search),
        defaultsRef.current,
        allowedRef.current,
      );
      currentRef.current = next;
      updateFilters(next);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!storageKey) {
        setSavedViews([]);
        return;
      }
      try {
        const values: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
        setSavedViews(
          Array.isArray(values)
            ? values
                .filter((view): view is SavedFilterView =>
                  Boolean(
                    view &&
                    typeof view.id === "string" &&
                    typeof view.name === "string" &&
                    view.name.length <= 80 &&
                    view.filters &&
                    typeof view.filters === "object" &&
                    !Array.isArray(view.filters) &&
                    Object.values(view.filters).every((value) => typeof value === "string"),
                  ),
                )
                .slice(0, 20)
            : [],
        );
      } catch {
        setSavedViews([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  const persist = (next: SavedFilterView[]) => {
    if (!storageKey) return false;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSavedViews(next);
      return true;
    } catch {
      return false;
    }
  };
  const saveView = (name: string): boolean => {
    const title = name.trim().slice(0, 80);
    if (!title || !storageKey || savedViews.length >= 20) return false;
    const existing = savedViews.find(
      (view) => view.name.toLocaleLowerCase("pt-BR") === title.toLocaleLowerCase("pt-BR"),
    );
    const view = {
      id: existing?.id ?? crypto.randomUUID(),
      name: title,
      filters: { ...currentRef.current },
    };
    return persist(
      existing
        ? savedViews.map((item) => (item.id === existing.id ? view : item))
        : [...savedViews, view],
    );
  };
  const applyView = (view: SavedFilterView) => {
    const params = new URLSearchParams(view.filters);
    setFilters(readFilterParams(params, defaultsRef.current, allowedRef.current));
  };
  const deleteView = (id: string) => persist(savedViews.filter((view) => view.id !== id));

  return {
    filters,
    setFilter,
    setFilters,
    resetFilters,
    savedViews,
    saveView,
    applyView,
    deleteView,
    activeCount: Object.keys(defaults).filter((key) => filters[key] !== defaults[key]).length,
  };
}
