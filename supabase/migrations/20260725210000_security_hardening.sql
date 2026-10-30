-- Security hardening for CRM tenant isolation and private attachments.
-- This migration is intentionally idempotent so it can also repair projects
-- whose schema was initially created outside the checked-in migrations.

-- Prevent object shadowing through a caller-controlled search_path. Trigger
-- execution does not require clients to call this function directly.
ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;

-- Bring locally missing application columns under migration control.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS services TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS proposal_sent_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS negotiation_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS loss_reason TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS loss_reason_details TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS source TEXT;

CREATE TABLE IF NOT EXISTS public.lead_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'slate',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_label_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES public.lead_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stage_key TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_labels_user ON public.lead_labels(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_lead ON public.lead_label_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_label_assignments_label ON public.lead_label_assignments(label_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_user ON public.pipeline_stages(user_id);

-- Keep new payloads within reasonable bounds. NOT VALID avoids rejecting the
-- migration because of legacy rows while still enforcing the checks on writes.
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_security_size_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_security_size_check CHECK (
  char_length(name) <= 200
  AND char_length(COALESCE(company, '')) <= 200
  AND char_length(COALESCE(contact, '')) <= 320
  AND char_length(COALESCE(whatsapp, '')) <= 32
  AND char_length(COALESCE(notes, '')) <= 10000
  AND char_length(COALESCE(source, '')) <= 100
  AND jsonb_typeof(attachments) = 'array'
  AND jsonb_array_length(attachments) <= 20
  AND pg_column_size(attachments) <= 262144
) NOT VALID;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_security_size_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_security_size_check CHECK (
  char_length(name) <= 200
  AND char_length(COALESCE(company, '')) <= 200
  AND char_length(COALESCE(contact, '')) <= 320
  AND char_length(COALESCE(whatsapp, '')) <= 32
  AND char_length(COALESCE(notes, '')) <= 10000
  AND char_length(COALESCE(whatsapp_log, '')) <= 50000
  AND char_length(COALESCE(source, '')) <= 100
  AND COALESCE(array_length(folder_links, 1), 0) <= 50
) NOT VALID;

ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_security_size_check;
ALTER TABLE public.notes ADD CONSTRAINT notes_security_size_check CHECK (
  char_length(title) <= 200
  AND char_length(content) <= 100000
) NOT VALID;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_security_size_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_security_size_check CHECK (
  char_length(description) <= 500
  AND char_length(COALESCE(contract_url, '')) <= 2048
) NOT VALID;

ALTER TABLE public.task_columns DROP CONSTRAINT IF EXISTS task_columns_security_size_check;
ALTER TABLE public.task_columns ADD CONSTRAINT task_columns_security_size_check CHECK (
  char_length(name) <= 100
) NOT VALID;

ALTER TABLE public.task_cards DROP CONSTRAINT IF EXISTS task_cards_security_size_check;
ALTER TABLE public.task_cards ADD CONSTRAINT task_cards_security_size_check CHECK (
  char_length(title) <= 300
  AND char_length(COALESCE(description, '')) <= 10000
  AND COALESCE(array_length(labels, 1), 0) <= 20
  AND char_length(array_to_string(labels, ',')) <= 1600
  AND jsonb_typeof(checklist) = 'array'
  AND jsonb_array_length(checklist) <= 100
  AND pg_column_size(checklist) <= 262144
  AND jsonb_typeof(attachments) = 'array'
  AND jsonb_array_length(attachments) <= 20
  AND pg_column_size(attachments) <= 262144
) NOT VALID;

ALTER TABLE public.lead_labels DROP CONSTRAINT IF EXISTS lead_labels_security_size_check;
ALTER TABLE public.lead_labels ADD CONSTRAINT lead_labels_security_size_check CHECK (
  char_length(name) <= 100
  AND char_length(color) <= 50
) NOT VALID;

ALTER TABLE public.pipeline_stages DROP CONSTRAINT IF EXISTS pipeline_stages_security_size_check;
ALTER TABLE public.pipeline_stages ADD CONSTRAINT pipeline_stages_security_size_check CHECK (
  char_length(stage_key) <= 100
  AND char_length(label) <= 100
  AND char_length(COALESCE(color, '')) <= 50
) NOT VALID;

-- Rebuild every application policy so permissive legacy policies cannot be
-- combined with the owner-only policies below (Postgres policies are OR'ed).
DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'leads',
        'clients',
        'payments',
        'notes',
        'todos',
        'task_columns',
        'task_cards',
        'lead_labels',
        'lead_label_assignments',
        'pipeline_stages'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END
$$;

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_label_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_owner_select ON public.leads FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY leads_owner_insert ON public.leads FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY leads_owner_update ON public.leads FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY leads_owner_delete ON public.leads FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY clients_owner_select ON public.clients FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY clients_owner_insert ON public.clients FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY clients_owner_update ON public.clients FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY clients_owner_delete ON public.clients FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY payments_owner_select ON public.payments FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY payments_owner_insert ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      client_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.clients
        WHERE clients.id = payments.client_id
          AND clients.user_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY payments_owner_update ON public.payments FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (
      client_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.clients
        WHERE clients.id = payments.client_id
          AND clients.user_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY payments_owner_delete ON public.payments FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY notes_owner_select ON public.notes FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY notes_owner_insert ON public.notes FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY notes_owner_update ON public.notes FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY notes_owner_delete ON public.notes FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY todos_owner_select ON public.todos FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY todos_owner_insert ON public.todos FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY todos_owner_update ON public.todos FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY todos_owner_delete ON public.todos FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY task_columns_owner_select ON public.task_columns FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY task_columns_owner_insert ON public.task_columns FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY task_columns_owner_update ON public.task_columns FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY task_columns_owner_delete ON public.task_columns FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY task_cards_owner_select ON public.task_cards FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY task_cards_owner_insert ON public.task_cards FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.task_columns
      WHERE task_columns.id = task_cards.column_id
        AND task_columns.user_id = (SELECT auth.uid())
    )
    AND (
      client_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.clients
        WHERE clients.id = task_cards.client_id
          AND clients.user_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY task_cards_owner_update ON public.task_cards FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.task_columns
      WHERE task_columns.id = task_cards.column_id
        AND task_columns.user_id = (SELECT auth.uid())
    )
    AND (
      client_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.clients
        WHERE clients.id = task_cards.client_id
          AND clients.user_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY task_cards_owner_delete ON public.task_cards FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY lead_labels_owner_select ON public.lead_labels FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY lead_labels_owner_insert ON public.lead_labels FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY lead_labels_owner_update ON public.lead_labels FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY lead_labels_owner_delete ON public.lead_labels FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY pipeline_stages_owner_select ON public.pipeline_stages FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
CREATE POLICY pipeline_stages_owner_insert ON public.pipeline_stages FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY pipeline_stages_owner_update ON public.pipeline_stages FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY pipeline_stages_owner_delete ON public.pipeline_stages FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY lead_label_assignments_owner_select ON public.lead_label_assignments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leads
      JOIN public.lead_labels ON lead_labels.id = lead_label_assignments.label_id
      WHERE leads.id = lead_label_assignments.lead_id
        AND leads.user_id = (SELECT auth.uid())
        AND lead_labels.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY lead_label_assignments_owner_insert ON public.lead_label_assignments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.leads
      JOIN public.lead_labels ON lead_labels.id = lead_label_assignments.label_id
      WHERE leads.id = lead_label_assignments.lead_id
        AND leads.user_id = (SELECT auth.uid())
        AND lead_labels.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY lead_label_assignments_owner_update ON public.lead_label_assignments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leads
      JOIN public.lead_labels ON lead_labels.id = lead_label_assignments.label_id
      WHERE leads.id = lead_label_assignments.lead_id
        AND leads.user_id = (SELECT auth.uid())
        AND lead_labels.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.leads
      JOIN public.lead_labels ON lead_labels.id = lead_label_assignments.label_id
      WHERE leads.id = lead_label_assignments.lead_id
        AND leads.user_id = (SELECT auth.uid())
        AND lead_labels.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY lead_label_assignments_owner_delete ON public.lead_label_assignments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leads
      JOIN public.lead_labels ON lead_labels.id = lead_label_assignments.label_id
      WHERE leads.id = lead_label_assignments.lead_id
        AND leads.user_id = (SELECT auth.uid())
        AND lead_labels.user_id = (SELECT auth.uid())
    )
  );

-- Authentication is mandatory throughout the CRM. Removing direct privileges
-- from anon adds a second barrier if RLS is ever changed accidentally.
REVOKE ALL PRIVILEGES ON TABLE
  public.leads,
  public.clients,
  public.payments,
  public.notes,
  public.todos,
  public.task_columns,
  public.task_cards,
  public.lead_labels,
  public.lead_label_assignments,
  public.pipeline_stages
FROM anon;

-- Private Storage bucket with server-enforced size/MIME restrictions.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crm-attachments',
  'crm-attachments',
  false,
  5242880,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        COALESCE(qual, '') LIKE '%crm-attachments%'
        OR COALESCE(with_check, '') LIKE '%crm-attachments%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', policy_row.policyname);
  END LOOP;
END
$$;

CREATE POLICY crm_attachments_owner_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'crm-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY crm_attachments_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crm-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[2] IN ('leads', 'tasks')
  );
CREATE POLICY crm_attachments_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'crm-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'crm-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[2] IN ('leads', 'tasks')
  );
CREATE POLICY crm_attachments_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'crm-attachments'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
