// Isolated PostgreSQL integration. Never connects to production.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath)
  throw new Error("Defina PGLITE_MODULE_PATH para o PGlite instalado separadamente.");
const { PGlite } = await import(modulePath);
const migrations = new URL("../supabase/migrations/", import.meta.url);
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const legacy = "20000000-0000-4000-8000-000000000001";
const iso = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value);

test("annual recurring billing: invoices, MRR, compatibility and isolation", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id UUID PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::UUID;
    $$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;
  `);
  const apply = async (name) => db.exec(await readFile(new URL(name, migrations), "utf8"));
  await apply("20260428150718_cf8f496c-05dc-4da1-a6a0-a41117c0a818.sql");
  await db.exec(`
    ALTER TABLE public.clients ADD COLUMN source TEXT;
    ALTER TABLE public.payments ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'other', ADD COLUMN reference_month DATE;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.clients,public.payments TO authenticated;
  `);
  await apply("20260901120000_client_recurring_services.sql");
  await apply("20260930120000_save_recurring_payment.sql");
  await db.query("INSERT INTO auth.users(id) VALUES ($1),($2)", [owner, other]);
  await db.query(
    "INSERT INTO public.clients(id,user_id,name,monthly_value) VALUES ($1,$2,'Legacy',240)",
    [legacy, owner],
  );
  const legacyRec = await row(
    "SELECT id FROM public.client_recurring_services WHERE client_id=$1",
    [legacy],
  );
  await db.query(
    `INSERT INTO public.payments(user_id,client_id,recurring_service_id,description,amount,due_date,payment_type,reference_month)
    VALUES ($1,$2,$3,'Legacy invoice',240,'2026-12-10','monthly','2026-12-01')`,
    [owner, legacy, legacyRec.id],
  );
  await apply("20261002120000_annual_recurring_billing.sql");
  await apply("20261002120000_annual_recurring_billing.sql");

  const login = async (uid) => {
    await db.exec("SET ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
  };
  const saveClient = async (id, items) =>
    row("SELECT public.save_client_with_billing_cycles($1::UUID,$2::JSONB,$3::JSONB) AS id", [
      id,
      JSON.stringify({ name: "Mixed client", status: "ativo", services: [], folder_links: [] }),
      JSON.stringify(items),
    ]);
  const savePayment = async (client, changes = {}, service = "Domain", serviceId = null) =>
    row("SELECT public.save_recurring_payment($1::JSONB,$2::TEXT,$3::UUID) AS id", [
      JSON.stringify({
        client_id: client,
        description: "Annual invoice",
        amount: 600,
        due_date: "2027-02-28",
        status: "pendente",
        recurring_cycle: "annual",
        recurring_due_month: 2,
        recurring_due_day: 29,
        ...changes,
      }),
      service,
      serviceId,
    ]);
  const generate = async (id, date, month, amount) =>
    row("SELECT public.generate_monthly_payments($1::JSONB,$2::DATE) AS count", [
      JSON.stringify([{ recurring_service_id: id, due_date: date, amount }]),
      month,
    ]);
  const error = async (operation, code) => assert.rejects(operation, (e) => e.code === code);
  await login(owner);
  let clientId, annualId, monthlyId;

  await t.test(
    "migration preserves legacy values and defaults every existing row to monthly",
    async () => {
      assert.equal(
        Number(
          (await row("SELECT monthly_value FROM public.clients WHERE id=$1", [legacy]))
            .monthly_value,
        ),
        240,
      );
      assert.equal(
        (
          await row("SELECT billing_cycle FROM public.client_recurring_services WHERE id=$1", [
            legacyRec.id,
          ])
        ).billing_cycle,
        "monthly",
      );
      assert.equal(
        (
          await row("SELECT recurring_billing_cycle FROM public.payments WHERE client_id=$1", [
            legacy,
          ])
        ).recurring_billing_cycle,
        "monthly",
      );
    },
  );
  await t.test("client editor saves mixed annual/monthly values and normalizes MRR", async () => {
    const saved = await saveClient(null, [
      { service_name: "Social", amount: 1000, due_day: 10, active: true, billing_cycle: "monthly" },
      {
        service_name: "Hosting",
        amount: 1200,
        due_day: 29,
        active: true,
        billing_cycle: "annual",
        due_month: 2,
      },
    ]);
    clientId = saved.id;
    const rows = (
      await db.query(
        "SELECT * FROM public.client_recurring_services WHERE client_id=$1 ORDER BY position",
        [clientId],
      )
    ).rows;
    monthlyId = rows[0].id;
    annualId = rows[1].id;
    assert.equal(rows[1].due_day, 29);
    assert.equal(rows[1].due_month, 2);
    assert.equal(Number(rows[1].amount), 1200);
    assert.equal(
      Number(
        (await row("SELECT monthly_value FROM public.clients WHERE id=$1", [clientId]))
          .monthly_value,
      ),
      1100,
    );
  });
  await t.test(
    "annual invoices only generate in the contracted month and keep the full annual value",
    async () => {
      assert.equal((await generate(annualId, "2027-01-29", "2027-01-01", 1200)).count, 0);
      assert.equal((await generate(annualId, "2027-02-28", "2027-02-01", 1200)).count, 1);
      const p = await row(
        "SELECT amount,due_date,recurring_billing_cycle,reference_month FROM public.payments WHERE recurring_service_id=$1",
        [annualId],
      );
      assert.equal(Number(p.amount), 1200);
      assert.equal(iso(p.due_date), "2027-02-28");
      assert.equal(p.recurring_billing_cycle, "annual");
      assert.equal(iso(p.reference_month), "2027-02-01");
      assert.equal((await generate(annualId, "2027-02-28", "2027-02-01", 1200)).count, 0);
      assert.equal((await generate(annualId, "2028-02-29", "2028-02-01", 1200)).count, 1);
    },
  );
  await t.test(
    "changing annual month does not create a second invoice in the same year",
    async () => {
      await db.query("UPDATE public.client_recurring_services SET due_month=3 WHERE id=$1", [
        annualId,
      ]);
      assert.equal((await generate(annualId, "2027-03-29", "2027-03-01", 1200)).count, 0);
      assert.equal(
        Number(
          (
            await row("SELECT count(*) FROM public.payments WHERE recurring_service_id=$1", [
              annualId,
            ])
          ).count,
        ),
        2,
      );
      assert.equal((await generate(monthlyId, "2027-02-10", "2027-02-01", 1000)).count, 1);
      assert.equal((await generate(monthlyId, "2027-03-10", "2027-03-01", 1000)).count, 1);
    },
  );
  await t.test(
    "financial initial annual invoice updates client recurrence and preserves February 29",
    async () => {
      const payment = await savePayment(clientId);
      const p = await row(
        "SELECT recurring_service_id,recurring_billing_cycle FROM public.payments WHERE id=$1",
        [payment.id],
      );
      assert.equal(p.recurring_billing_cycle, "annual");
      const r = await row(
        "SELECT amount,due_day,due_month,billing_cycle FROM public.client_recurring_services WHERE id=$1",
        [p.recurring_service_id],
      );
      assert.equal(r.due_day, 29);
      assert.equal(r.due_month, 2);
      assert.equal(r.billing_cycle, "annual");
      assert.equal(
        Number(
          (await row("SELECT monthly_value FROM public.clients WHERE id=$1", [clientId]))
            .monthly_value,
        ),
        1150,
      );
      await error(
        () =>
          savePayment(
            clientId,
            { amount: 999, recurring_due_month: 4, due_date: "2027-04-30" },
            "Domain",
            p.recurring_service_id,
          ),
        "23505",
      );
      const after = await row(
        "SELECT amount,due_day,due_month FROM public.client_recurring_services WHERE id=$1",
        [p.recurring_service_id],
      );
      assert.equal(Number(after.amount), 600);
      assert.equal(after.due_month, 2);
      assert.equal(after.due_day, 29);
    },
  );
  await t.test(
    "monthly historical invoices do not block a later annual cycle in a different month",
    async () => {
      await savePayment(
        clientId,
        { amount: 1200, recurring_due_month: 4, recurring_due_day: 30, due_date: "2027-04-30" },
        "Social",
        monthlyId,
      );
      await savePayment(
        clientId,
        {
          amount: 100,
          recurring_cycle: "monthly",
          recurring_due_month: null,
          due_date: "2027-05-30",
        },
        "Social",
        monthlyId,
      );
      assert.equal(
        (
          await row("SELECT billing_cycle FROM public.client_recurring_services WHERE id=$1", [
            monthlyId,
          ])
        ).billing_cycle,
        "monthly",
      );
      await error(
        () =>
          savePayment(
            clientId,
            { recurring_due_month: 10, due_date: "2027-10-30" },
            "Social",
            monthlyId,
          ),
        "23505",
      );
    },
  );
  await t.test(
    "annual settings are validated before any partial client or invoice write",
    async () => {
      for (const month of [null, 0, 13, 1.5, "wrong"])
        await error(() => savePayment(clientId, { recurring_due_month: month }), "22023");
      await error(() => savePayment(clientId, { recurring_cycle: "weekly" }), "22023");
      for (const amount of ["NaN", "Infinity", -1, 1.001, 10000000000]) {
        await error(
          () =>
            saveClient(null, [
              {
                service_name: "Invalid",
                amount,
                due_day: 10,
                active: true,
                billing_cycle: "annual",
                due_month: 2,
              },
            ]),
          "22023",
        );
      }
      await error(
        () =>
          saveClient(null, [
            {
              service_name: "Wrong",
              amount: 1200,
              due_day: 10,
              active: true,
              billing_cycle: "annual",
              due_month: 0,
            },
          ]),
        "22023",
      );
      assert.equal(
        Number((await row("SELECT count(*) FROM public.clients WHERE user_id=$1", [owner])).count),
        2,
      );
    },
  );
  await t.test(
    "client edits monthly to annual and back without changing historical invoice snapshots",
    async () => {
      await saveClient(legacy, [
        {
          id: legacyRec.id,
          service_name: "Outro",
          amount: 1200,
          due_day: 31,
          active: true,
          billing_cycle: "annual",
          due_month: 3,
        },
      ]);
      assert.equal(
        Number(
          (await row("SELECT monthly_value FROM public.clients WHERE id=$1", [legacy]))
            .monthly_value,
        ),
        100,
      );
      await saveClient(legacy, [
        {
          id: legacyRec.id,
          service_name: "Outro",
          amount: 240,
          due_day: 10,
          active: true,
          billing_cycle: "monthly",
          due_month: null,
        },
      ]);
      assert.equal(
        Number(
          (await row("SELECT monthly_value FROM public.clients WHERE id=$1", [legacy]))
            .monthly_value,
        ),
        240,
      );
      assert.equal(
        (
          await row("SELECT billing_cycle FROM public.client_recurring_services WHERE id=$1", [
            legacyRec.id,
          ])
        ).billing_cycle,
        "monthly",
      );
      assert.equal(
        (
          await row("SELECT recurring_billing_cycle FROM public.payments WHERE client_id=$1", [
            legacy,
          ])
        ).recurring_billing_cycle,
        "monthly",
      );
    },
  );
  await t.test(
    "direct billing-cycle changes synchronize MRR while annual inactive values are excluded",
    async () => {
      await db.query("UPDATE public.client_recurring_services SET active=false WHERE id=$1", [
        annualId,
      ]);
      assert.equal(
        Number(
          (await row("SELECT monthly_value FROM public.clients WHERE id=$1", [clientId]))
            .monthly_value,
        ),
        150,
      );
      await db.query(
        "UPDATE public.client_recurring_services SET billing_cycle='annual',due_month=6 WHERE id=$1",
        [monthlyId],
      );
      assert.equal(
        Number(
          (await row("SELECT monthly_value FROM public.clients WHERE id=$1", [clientId]))
            .monthly_value,
        ),
        58.33,
      );
    },
  );
  await t.test("tenant ownership and anonymous function privileges remain restricted", async () => {
    await login(other);
    await error(() => savePayment(clientId), "42501");
    await error(() => saveClient(clientId, []), "42501");
    assert.equal((await generate(annualId, "2029-03-29", "2029-03-01", 1200)).count, 0);
    await login("");
    await error(() => savePayment(clientId), "28000");
    await db.exec("RESET ROLE");
    const grants = await row(
      "SELECT has_function_privilege('anon','public.save_client_with_billing_cycles(UUID,JSONB,JSONB)','EXECUTE') AS anon",
    );
    assert.equal(grants.anon, false);
    await login(owner);
  });
  await t.test("invoice failure rolls back new annual recurrence and client MRR", async () => {
    await login(owner);
    const before = await row("SELECT monthly_value FROM public.clients WHERE id=$1", [clientId]);
    await db.exec(`
      RESET ROLE;
      CREATE FUNCTION public.test_annual_failure() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated' USING ERRCODE='23505'; END; $$;
      CREATE TRIGGER test_annual_failure BEFORE INSERT ON public.payments
      FOR EACH ROW EXECUTE FUNCTION public.test_annual_failure();
    `);
    await login(owner);
    await error(() => savePayment(clientId, {}, "Rollback annual"), "23505");
    assert.equal(
      Number(
        (
          await row(
            "SELECT count(*) FROM public.client_recurring_services WHERE client_id=$1 AND service_name='Rollback annual'",
            [clientId],
          )
        ).count,
      ),
      0,
    );
    assert.deepEqual(
      await row("SELECT monthly_value FROM public.clients WHERE id=$1", [clientId]),
      before,
    );
  });
});
