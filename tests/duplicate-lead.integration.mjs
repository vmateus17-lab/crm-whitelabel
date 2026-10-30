import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
// Install PGlite separately and point PGLITE_MODULE_PATH at its dist/index.js.
const modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath)
  throw new Error(
    "Defina PGLITE_MODULE_PATH com o caminho de dist/index.js do PGlite instalado separadamente.",
  );
const { PGlite } = await import(modulePath);

const db = new PGlite();
const repo = new URL("../", import.meta.url);
await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
CREATE TABLE public.leads (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null,
 company text, contact text, whatsapp text, estimated_value numeric, notes text,
 services text[] not null default '{}', source text, stage text not null default 'novo',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 attachments jsonb not null default '[]', contacted_at timestamptz, proposal_sent_at timestamptz,
 negotiation_at timestamptz, closed_at timestamptz, last_contact_at timestamptz,
 loss_reason text, loss_reason_details text, follow_up_at timestamptz, follow_up_has_time boolean not null default false,
 reminder_offsets_minutes integer[] not null default '{}', converted_client_id uuid, deleted_at timestamptz
);
CREATE TABLE public.lead_labels (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null, color text
);
CREATE TABLE public.lead_label_assignments (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
 label_id uuid not null references public.lead_labels(id) on delete cascade, created_at timestamptz default now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads, public.lead_labels, public.lead_label_assignments TO authenticated;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_label_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_owner ON public.leads FOR ALL TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY label_owner ON public.lead_labels FOR ALL TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE POLICY assignment_owner ON public.lead_label_assignments FOR ALL TO authenticated USING (
 EXISTS (SELECT 1 FROM public.leads l JOIN public.lead_labels label ON label.id=label_id WHERE l.id=lead_id AND l.user_id=auth.uid() AND label.user_id=auth.uid())
) WITH CHECK (
 EXISTS (SELECT 1 FROM public.leads l JOIN public.lead_labels label ON label.id=label_id WHERE l.id=lead_id AND l.user_id=auth.uid() AND label.user_id=auth.uid())
);
INSERT INTO public.leads (
 id,user_id,name,company,contact,whatsapp,estimated_value,notes,services,source,stage,created_at,
 attachments,contacted_at,proposal_sent_at,negotiation_at,closed_at,last_contact_at,loss_reason,loss_reason_details,
 follow_up_at,follow_up_has_time,reminder_offsets_minutes,converted_client_id
) VALUES (
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Lead perdido','Empresa','email@teste.com','11999999999',1200,
 'Observação','{Tráfego Pago}','Indicação','perdido','2026-01-01',
 '[{"name":"Anexo","path":"x"}]','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-04','Preço','Caro',
 '2026-01-07',true,'{60,0}','40000000-0000-4000-8000-000000000001'
);
INSERT INTO public.leads (id,user_id,name,stage) VALUES ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Outro usuário','novo');
INSERT INTO public.leads (id,user_id,name,deleted_at) VALUES ('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Lixeira',now());
INSERT INTO public.lead_labels(id,user_id,name,color) VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','VIP','blue');
INSERT INTO public.lead_label_assignments(lead_id,label_id) VALUES ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
`);
await db.exec(
  await readFile(new URL("supabase/migrations/20260930130000_duplicate_lead.sql", repo), "utf8"),
);
await db.exec(
  "SET ROLE authenticated; SET request.jwt.claim.sub='20000000-0000-4000-8000-000000000001';",
);
const original = (
  await db.query("SELECT * FROM public.leads WHERE id='10000000-0000-4000-8000-000000000001'")
).rows[0];
const before = Date.now();
const id = (
  await db.query("SELECT public.duplicate_lead('10000000-0000-4000-8000-000000000001') AS id")
).rows[0].id;
const copy = (await db.query("SELECT * FROM public.leads WHERE id=$1", [id])).rows[0];
assert.notEqual(copy.id, original.id);
assert.equal(copy.stage, "novo");
assert.ok(new Date(copy.created_at).getTime() >= before - 1000);
for (const field of [
  "name",
  "company",
  "contact",
  "whatsapp",
  "estimated_value",
  "notes",
  "services",
  "source",
  "user_id",
])
  assert.deepEqual(copy[field], original[field], field);
for (const field of [
  "contacted_at",
  "proposal_sent_at",
  "negotiation_at",
  "closed_at",
  "last_contact_at",
  "loss_reason",
  "loss_reason_details",
  "follow_up_at",
  "converted_client_id",
  "deleted_at",
])
  assert.equal(copy[field], null, field);
assert.deepEqual(copy.attachments, []);
assert.deepEqual(copy.reminder_offsets_minutes, []);
assert.equal(copy.follow_up_has_time, false);
assert.equal(
  (await db.query("SELECT label_id FROM public.lead_label_assignments WHERE lead_id=$1", [id]))
    .rows[0].label_id,
  "30000000-0000-4000-8000-000000000001",
);
assert.deepEqual(
  (await db.query("SELECT * FROM public.leads WHERE id='10000000-0000-4000-8000-000000000001'"))
    .rows[0],
  original,
);
console.log(
  "PASS duplication: new identity/date/stage, registration+labels copied, source untouched, history/references reset",
);
await assert.rejects(
  db.query("SELECT public.duplicate_lead('10000000-0000-4000-8000-000000000002')"),
  /Lead não encontrado/,
);
await assert.rejects(
  db.query("SELECT public.duplicate_lead('10000000-0000-4000-8000-000000000003')"),
  /Lead não encontrado/,
);
await db.exec("SET request.jwt.claim.sub='';");
await assert.rejects(
  db.query("SELECT public.duplicate_lead('10000000-0000-4000-8000-000000000001')"),
  /Autenticação necessária/,
);
await db.exec("RESET ROLE; SET ROLE anon;");
await assert.rejects(
  db.query("SELECT public.duplicate_lead('10000000-0000-4000-8000-000000000001')"),
  /permission denied/,
);
console.log("PASS authorization: other tenant, deleted lead, missing auth and anon denied");
await db.exec(`
RESET ROLE;
CREATE FUNCTION public.fail_copy_labels() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated label failure'; END; $$;
CREATE TRIGGER fail_copy BEFORE INSERT ON public.lead_label_assignments FOR EACH ROW EXECUTE FUNCTION public.fail_copy_labels();
SET ROLE authenticated;
SET request.jwt.claim.sub='20000000-0000-4000-8000-000000000001';
`);
const count = (await db.query("SELECT count(*) AS total FROM public.leads")).rows[0].total;
await assert.rejects(
  db.query("SELECT public.duplicate_lead('10000000-0000-4000-8000-000000000001')"),
  /Simulated label failure/,
);
assert.equal((await db.query("SELECT count(*) AS total FROM public.leads")).rows[0].total, count);
console.log("PASS atomic rollback: label failure does not leave a partial lead");
await db.close();
