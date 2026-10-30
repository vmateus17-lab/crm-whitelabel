import type { AttachmentItem } from "@/components/AttachmentViewerModal";
import type { Json } from "@/integrations/supabase/types";
import { normalizeReminderOffsets, type ReminderOffsetMinutes } from "./reminders.ts";

export type LeadStage = "novo" | "contatado" | "proposta" | "negociacao" | "ganho" | "perdido";

export interface Lead {
  id: string;
  name: string;
  company: string | null;
  contact: string | null;
  whatsapp: string | null;
  stage: LeadStage;
  estimated_value: number | null;
  notes: string | null;
  services: string[];
  source: string | null;
  created_at: string;
  contacted_at: string | null;
  proposal_sent_at: string | null;
  negotiation_at: string | null;
  closed_at: string | null;
  follow_up_at: string | null;
  follow_up_has_time: boolean;
  reminder_offsets_minutes: ReminderOffsetMinutes[];
  deleted_at: string | null;
  attachments?: AttachmentItem[];
  converted_client_id?: string | null;
}

export interface LeadLabel {
  id: string;
  name: string;
  color: string;
}

export interface LabelAssignment {
  lead_id: string;
  label_id: string;
}

/** Only editable registration fields: never change identity, ownership or stage history. */
export function buildLeadUpdate(form: Partial<Lead>) {
  return {
    name: form.name?.trim().slice(0, 200) ?? "",
    company: form.company?.trim().slice(0, 200) || null,
    contact: form.contact?.trim().slice(0, 320) || null,
    whatsapp: form.whatsapp?.slice(0, 32) || null,
    estimated_value: form.estimated_value ?? 0,
    notes: form.notes?.slice(0, 10_000) || null,
    services: [...(form.services ?? [])],
    source: form.source ?? null,
    follow_up_at: form.follow_up_at ?? null,
    follow_up_has_time: form.follow_up_has_time ?? false,
    reminder_offsets_minutes: normalizeReminderOffsets(form.reminder_offsets_minutes),
    attachments: (form.attachments ?? []) as unknown as Json,
  };
}
