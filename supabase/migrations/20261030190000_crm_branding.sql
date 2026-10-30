-- Public identity only. Business records remain protected by their existing RLS.
CREATE TABLE public.crm_branding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL DEFAULT 'CRM'
    CHECK (char_length(name) BETWEEN 1 AND 12 AND name = btrim(name) AND name !~ '[[:cntrl:]]'),
  logo text CHECK (logo IS NULL OR length(logo) <= 1500000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY branding_owner_select ON public.crm_branding
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
-- Direct writes are not granted: the validated RPC is the only write entry point.
REVOKE ALL ON public.crm_branding FROM anon, authenticated;

CREATE FUNCTION public.get_crm_branding()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('name', name, 'logo', logo, 'revision', updated_at::text)
       FROM public.crm_branding WHERE singleton),
    jsonb_build_object('name', 'CRM', 'logo', NULL, 'revision', 'default')
  );
$$;

CREATE FUNCTION public.can_manage_crm_branding()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.crm_branding WHERE singleton AND owner_id <> auth.uid()
  );
$$;

CREATE FUNCTION public.save_crm_branding(p_name text, p_logo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text := btrim(p_name);
  v_png bytea;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF v_name IS NULL OR char_length(v_name) NOT BETWEEN 1 AND 12 OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Name must contain 1 to 12 characters without control characters' USING ERRCODE = '22023';
  END IF;
  IF p_logo IS NOT NULL THEN
    IF length(p_logo) > 1500000 OR p_logo !~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$' THEN
      RAISE EXCEPTION 'Invalid PNG logo' USING ERRCODE = '22023';
    END IF;
    v_png := decode(substr(p_logo, 23), 'base64');
    IF octet_length(v_png) < 33
      OR encode(substring(v_png FROM 1 FOR 8), 'hex') <> '89504e470d0a1a0a'
      OR encode(substring(v_png FROM 13 FOR 4), 'hex') <> '49484452'
      OR encode(substring(v_png FROM 17 FOR 8), 'hex') <> '0000020000000200' THEN
      RAISE EXCEPTION 'Logo must be a 512 by 512 PNG' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.crm_branding(singleton, owner_id, name, logo)
  VALUES (true, v_user, v_name, p_logo)
  ON CONFLICT (singleton) DO UPDATE SET name = excluded.name, logo = excluded.logo, updated_at = now()
    WHERE public.crm_branding.owner_id = v_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Only the identity owner can change branding' USING ERRCODE = '42501'; END IF;
  RETURN public.get_crm_branding();
END;
$$;

REVOKE ALL ON FUNCTION public.get_crm_branding() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_crm_branding() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_crm_branding(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_branding() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_crm_branding() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_crm_branding(text, text) TO authenticated;
