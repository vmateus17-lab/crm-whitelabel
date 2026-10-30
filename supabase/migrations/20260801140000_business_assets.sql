-- Private branding assets used in generated quote PDFs.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-assets',
  'business-assets',
  false,
  2097152,
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY business_assets_owner_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'business-assets'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY business_assets_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-assets'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY business_assets_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'business-assets'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  )
  WITH CHECK (
    bucket_id = 'business-assets'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
CREATE POLICY business_assets_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'business-assets'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
