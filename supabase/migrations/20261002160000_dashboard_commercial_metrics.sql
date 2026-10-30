-- Monthly commercial goals and configurable pipeline probabilities.
-- Additive: does not rewrite clients, payments, leads or existing historical events.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS public.commercial_targets (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  target_amount NUMERIC(12,2) NOT NULL CHECK (target_amount > 0 AND target_amount <= 9999999999.99),
  PRIMARY KEY (user_id, month)
);

CREATE TABLE IF NOT EXISTS public.commercial_stage_probabilities (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL CHECK (char_length(stage_key) BETWEEN 1 AND 80 AND stage_key NOT IN ('ganho', 'perdido')),
  probability NUMERIC(5,2) NOT NULL CHECK (probability >= 0 AND probability <= 100),
  PRIMARY KEY (user_id, stage_key)
);

ALTER TABLE public.commercial_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_stage_probabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_targets, public.commercial_stage_probabilities FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.commercial_targets, public.commercial_stage_probabilities TO authenticated;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['commercial_targets', 'commercial_stage_probabilities'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = target_table AND policyname = 'owner_select') THEN
      EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()))', target_table);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = target_table AND policyname = 'owner_insert') THEN
      EXECUTE format('CREATE POLICY owner_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()))', target_table);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = target_table AND policyname = 'owner_update') THEN
      EXECUTE format('CREATE POLICY owner_update ON public.%I FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()))', target_table);
    END IF;
  END LOOP;
END;
$$;

-- Existing events remain NULL: their original sale value cannot be reconstructed reliably.
ALTER TABLE public.lead_stage_history ADD COLUMN IF NOT EXISTS estimated_value_snapshot NUMERIC(12,2);

CREATE OR REPLACE FUNCTION public.capture_lead_stage_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  SELECT COALESCE(lead.estimated_value, 0)
  INTO NEW.estimated_value_snapshot
  FROM public.leads lead
  WHERE lead.id = NEW.lead_id AND lead.user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_capture_lead_stage_value'
      AND tgrelid = 'public.lead_stage_history'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_capture_lead_stage_value
    BEFORE INSERT ON public.lead_stage_history
    FOR EACH ROW EXECUTE FUNCTION public.capture_lead_stage_value();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_lead_stage_value() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
