-- Additive safeguard for future transitions. Existing historical dates are not invented.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.ensure_lead_closure_date()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage IN ('ganho', 'perdido') THEN
      NEW.closed_at := COALESCE(NEW.closed_at, now());
    ELSE
      NEW.closed_at := NULL;
    END IF;
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF NEW.stage IN ('ganho', 'perdido') THEN
      NEW.closed_at := CASE
        WHEN NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN COALESCE(NEW.closed_at, now())
        ELSE now()
      END;
    ELSE
      NEW.closed_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_ensure_lead_closure_date'
      AND tgrelid = 'public.leads'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_ensure_lead_closure_date
    BEFORE INSERT OR UPDATE OF stage ON public.leads
    FOR EACH ROW EXECUTE FUNCTION public.ensure_lead_closure_date();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_lead_closure_date() FROM PUBLIC, anon;
NOTIFY pgrst, 'reload schema';
COMMIT;
