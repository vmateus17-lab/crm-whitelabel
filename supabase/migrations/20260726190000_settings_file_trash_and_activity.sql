-- Settings center, recoverable attachment trash, and user-visible activity history.

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  date_format text NOT NULL DEFAULT 'dd/MM/yyyy' CHECK (date_format IN ('dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd')),
  sidebar_collapsed boolean NOT NULL DEFAULT false,
  notify_due_soon boolean NOT NULL DEFAULT true,
  notify_overdue boolean NOT NULL DEFAULT true,
  notify_activity_summary boolean NOT NULL DEFAULT false,
  default_task_priority text CHECK (default_task_priority IS NULL OR default_task_priority IN ('baixa', 'media', 'alta', 'urgente')),
  default_task_column_id uuid REFERENCES public.task_columns(id) ON DELETE SET NULL,
  default_lead_stage text NOT NULL DEFAULT 'novo'
    CHECK (default_lead_stage IN ('novo', 'contatado', 'proposta', 'negociacao', 'ganho', 'perdido')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trashed_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('lead', 'task')),
  owner_id uuid NOT NULL,
  attachment jsonb NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trashed_attachments_shape_check CHECK (
    jsonb_typeof(attachment) = 'object'
    AND attachment ? 'path'
    AND attachment ? 'name'
    AND char_length(attachment->>'path') BETWEEN 1 AND 240
    AND char_length(attachment->>'name') BETWEEN 1 AND 300
    AND pg_column_size(attachment) <= 16384
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS trashed_attachments_user_path_key
ON public.trashed_attachments (user_id, (attachment->>'path'));

CREATE INDEX IF NOT EXISTS idx_trashed_attachments_user_deleted
ON public.trashed_attachments (user_id, deleted_at DESC);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  entity_type text NOT NULL CHECK (char_length(entity_type) BETWEEN 1 AND 40),
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created
ON public.activity_logs (user_id, created_at DESC);

DROP TRIGGER IF EXISTS set_user_settings_updated_at ON public.user_settings;
CREATE TRIGGER set_user_settings_updated_at
BEFORE UPDATE ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trashed_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_settings, public.trashed_attachments, public.activity_logs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings, public.trashed_attachments TO authenticated;
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;

DROP POLICY IF EXISTS user_settings_owner_select ON public.user_settings;
DROP POLICY IF EXISTS user_settings_owner_insert ON public.user_settings;
DROP POLICY IF EXISTS user_settings_owner_update ON public.user_settings;
DROP POLICY IF EXISTS user_settings_owner_delete ON public.user_settings;
CREATE POLICY user_settings_owner_select ON public.user_settings FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_settings_owner_insert ON public.user_settings FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    default_task_column_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.task_columns
      WHERE task_columns.id = user_settings.default_task_column_id
        AND task_columns.user_id = (SELECT auth.uid())
    )
  )
);
CREATE POLICY user_settings_owner_update ON public.user_settings FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    default_task_column_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.task_columns
      WHERE task_columns.id = user_settings.default_task_column_id
        AND task_columns.user_id = (SELECT auth.uid())
    )
  )
);
CREATE POLICY user_settings_owner_delete ON public.user_settings FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS trashed_attachments_owner_select ON public.trashed_attachments;
DROP POLICY IF EXISTS trashed_attachments_owner_insert ON public.trashed_attachments;
DROP POLICY IF EXISTS trashed_attachments_owner_update ON public.trashed_attachments;
DROP POLICY IF EXISTS trashed_attachments_owner_delete ON public.trashed_attachments;
CREATE POLICY trashed_attachments_owner_select ON public.trashed_attachments FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));
CREATE POLICY trashed_attachments_owner_insert ON public.trashed_attachments FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY trashed_attachments_owner_update ON public.trashed_attachments FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY trashed_attachments_owner_delete ON public.trashed_attachments FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS activity_logs_owner_select ON public.activity_logs;
DROP POLICY IF EXISTS activity_logs_owner_insert ON public.activity_logs;
CREATE POLICY activity_logs_owner_select ON public.activity_logs FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));
CREATE POLICY activity_logs_owner_insert ON public.activity_logs FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.trash_attachment(
  p_owner_type text,
  p_owner_id uuid,
  p_attachment jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_trash_id uuid;
  v_owner_exists boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_owner_type NOT IN ('lead', 'task') THEN
    RAISE EXCEPTION 'Invalid attachment owner type';
  END IF;
  IF jsonb_typeof(p_attachment) <> 'object' OR NOT (p_attachment ? 'path') OR NOT (p_attachment ? 'name') THEN
    RAISE EXCEPTION 'Invalid attachment metadata';
  END IF;

  IF p_owner_type = 'lead' THEN
    UPDATE public.leads
    SET attachments = COALESCE((
      SELECT jsonb_agg(item)
      FROM jsonb_array_elements(leads.attachments) AS item
      WHERE item->>'path' IS DISTINCT FROM p_attachment->>'path'
    ), '[]'::jsonb)
    WHERE id = p_owner_id AND user_id = v_user_id;
    v_owner_exists := FOUND;
  ELSE
    UPDATE public.task_cards
    SET attachments = COALESCE((
      SELECT jsonb_agg(item)
      FROM jsonb_array_elements(task_cards.attachments) AS item
      WHERE item->>'path' IS DISTINCT FROM p_attachment->>'path'
    ), '[]'::jsonb)
    WHERE id = p_owner_id AND user_id = v_user_id;
    v_owner_exists := FOUND;
  END IF;

  IF NOT v_owner_exists THEN
    RAISE EXCEPTION 'Attachment owner not found';
  END IF;

  INSERT INTO public.trashed_attachments (user_id, owner_type, owner_id, attachment)
  VALUES (v_user_id, p_owner_type, p_owner_id, p_attachment)
  ON CONFLICT (user_id, (attachment->>'path'))
  DO UPDATE SET deleted_at = now(), owner_type = EXCLUDED.owner_type, owner_id = EXCLUDED.owner_id
  RETURNING id INTO v_trash_id;

  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    'attachment_trashed',
    'attachment',
    v_trash_id,
    jsonb_build_object('name', p_attachment->>'name', 'owner_type', p_owner_type)
  );

  RETURN v_trash_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_trashed_attachment(p_trash_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_item public.trashed_attachments%ROWTYPE;
  v_owner_exists boolean;
BEGIN
  SELECT * INTO v_item
  FROM public.trashed_attachments
  WHERE id = p_trash_id AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trashed attachment not found';
  END IF;

  IF v_item.owner_type = 'lead' THEN
    UPDATE public.leads
    SET attachments = CASE
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(leads.attachments) AS item
        WHERE item->>'path' = v_item.attachment->>'path'
      ) THEN leads.attachments
      ELSE leads.attachments || jsonb_build_array(v_item.attachment)
    END
    WHERE id = v_item.owner_id AND user_id = v_user_id;
    v_owner_exists := FOUND;
  ELSE
    UPDATE public.task_cards
    SET attachments = CASE
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(task_cards.attachments) AS item
        WHERE item->>'path' = v_item.attachment->>'path'
      ) THEN task_cards.attachments
      ELSE task_cards.attachments || jsonb_build_array(v_item.attachment)
    END
    WHERE id = v_item.owner_id AND user_id = v_user_id;
    v_owner_exists := FOUND;
  END IF;

  IF NOT v_owner_exists THEN
    RAISE EXCEPTION 'Original record no longer exists';
  END IF;

  DELETE FROM public.trashed_attachments WHERE id = v_item.id;
  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    'attachment_restored',
    'attachment',
    v_item.id,
    jsonb_build_object('name', v_item.attachment->>'name', 'owner_type', v_item.owner_type)
  );
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trash_attachment(text, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_trashed_attachment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_attachment(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_trashed_attachment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_crm_trash_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_action text;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    v_action := TG_TABLE_NAME || '_trashed';
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    v_action := TG_TABLE_NAME || '_restored';
  ELSIF TG_OP = 'DELETE' THEN
    v_action := TG_TABLE_NAME || '_deleted_permanently';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_name := COALESCE(
    to_jsonb(OLD)->>'name',
    to_jsonb(NEW)->>'name',
    to_jsonb(OLD)->>'title',
    to_jsonb(NEW)->>'title'
  );
  INSERT INTO public.activity_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    COALESCE(OLD.user_id, NEW.user_id),
    v_action,
    CASE WHEN TG_TABLE_NAME = 'leads' THEN 'lead' ELSE 'task' END,
    COALESCE(OLD.id, NEW.id),
    jsonb_build_object('name', v_name)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_crm_trash_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_leads_trash_changes ON public.leads;
CREATE TRIGGER audit_leads_trash_changes
AFTER UPDATE OF deleted_at OR DELETE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.audit_crm_trash_changes();

DROP TRIGGER IF EXISTS audit_tasks_trash_changes ON public.task_cards;
CREATE TRIGGER audit_tasks_trash_changes
AFTER UPDATE OF deleted_at OR DELETE ON public.task_cards
FOR EACH ROW EXECUTE FUNCTION public.audit_crm_trash_changes();

INSERT INTO public.user_settings (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
