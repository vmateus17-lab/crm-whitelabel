import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { error: "E-mail ou senha incorretos." };
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function formatBRL(value: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value ?? 0);
}

/** Convert a raw number (cents) to display string like "2.000,00" */
export function numberToBRLInput(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Parse a BRL input string like "2.000,00" back to a number */
export function parseBRLInput(input: string): number {
  if (!input) return 0;
  // Remove everything except digits and comma
  const cleaned = input.replace(/[^\d,]/g, "");
  // Replace comma with dot for parsing
  const normalized = cleaned.replace(",", ".");
  const result = parseFloat(normalized);
  return isNaN(result) ? 0 : result;
}

/** Handle BRL input change: keeps only digits and formats as BRL */
export function handleBRLInputChange(rawValue: string): { display: string; numeric: number } {
  // Strip non-digits
  const digits = rawValue.replace(/\D/g, "");
  if (!digits) return { display: "", numeric: 0 };
  // Convert to number with 2 decimal places
  const numeric = parseInt(digits, 10) / 100;
  const display = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
  return { display, numeric };
}

/** Format phone number as (XX) XXXXX-XXXX */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

/** Strip phone formatting, keeping only digits */
export function stripPhone(value: string): string {
  return value.replace(/\D/g, "");
}

/** Convert a phone number to WhatsApp format with country code 55 (Brazil) */
export function toWhatsAppNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  // Already has country code 55
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  // Add Brazil country code
  return `55${digits}`;
}
