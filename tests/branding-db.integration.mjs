import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("installation identity: persistence, anonymous read, owner isolation and server validation", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const owner = "10000000-0000-4000-8000-000000000001";
  const other = "10000000-0000-4000-8000-000000000002";
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
  `);
  await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [owner, other]);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261030190000_crm_branding.sql", import.meta.url),
      "utf8",
    ),
  );
  const call = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const asUser = async (id) => {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("SET ROLE authenticated");
  };
  await db.exec("SET ROLE anon");
  assert.deepEqual((await call("SELECT public.get_crm_branding() AS value")).value, {
    name: "CRM",
    logo: null,
    revision: "default",
  });
  await assert.rejects(
    call("SELECT public.save_crm_branding('Intruso',NULL)"),
    /permission denied/,
  );
  await assert.rejects(call("SELECT * FROM public.crm_branding"), /permission denied/);
  await db.exec("RESET ROLE");
  await asUser(owner);
  assert.equal((await call("SELECT public.can_manage_crm_branding() AS value")).value, true);
  const logo = `data:image/png;base64,${(await readFile(new URL("../public/icons/default.png", import.meta.url))).toString("base64")}`;
  const saved = (
    await call("SELECT public.save_crm_branding($1,$2) AS value", ["Minha Marca", logo])
  ).value;
  assert.equal(saved.name, "Minha Marca");
  assert.equal(saved.logo, logo);
  assert.ok(saved.revision);
  for (const name of ["", " ", "1234567890123", "a\nb"])
    await assert.rejects(call("SELECT public.save_crm_branding($1,NULL)", [name]));
  for (const image of [
    "https://outside.invalid/logo.png",
    "data:image/svg+xml,<svg/>",
    "data:image/png;base64,iVBORw0KGgo=",
    `data:image/png;base64,${"A".repeat(1500001)}`,
  ])
    await assert.rejects(call("SELECT public.save_crm_branding('Valid',$1)", [image]));
  const wrongSize = Buffer.from(logo.split(",")[1], "base64");
  wrongSize.writeUInt32BE(256, 20);
  await assert.rejects(
    call("SELECT public.save_crm_branding('Valid',$1)", [
      `data:image/png;base64,${wrongSize.toString("base64")}`,
    ]),
    /512 by 512/,
  );
  await asUser(other);
  assert.equal((await call("SELECT public.can_manage_crm_branding() AS value")).value, false);
  await assert.rejects(
    call("SELECT public.save_crm_branding('Outra Marca',NULL)"),
    /Only the identity owner/,
  );
  await assert.rejects(call("UPDATE public.crm_branding SET name='Intruso'"), /permission denied/);
  await db.exec("RESET ROLE; SET ROLE anon");
  const publicResult = (await call("SELECT public.get_crm_branding() AS value")).value;
  assert.deepEqual(Object.keys(publicResult).sort(), ["logo", "name", "revision"]);
  assert.equal(publicResult.name, "Minha Marca");
  assert.equal(publicResult.logo, logo);
  await db.exec("RESET ROLE");
  await asUser(owner);
  await call("SELECT public.save_crm_branding('123456789012',NULL)");
  assert.equal((await call("SELECT public.get_crm_branding() AS value")).value.logo, null);
  await call("SELECT public.save_crm_branding($1,NULL)", ["😀".repeat(12)]);
  assert.equal(
    (await call("SELECT public.get_crm_branding() AS value")).value.name,
    "😀".repeat(12),
  );
});
