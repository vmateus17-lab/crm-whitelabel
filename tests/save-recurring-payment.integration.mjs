// Requires an isolated PGlite install; no live Supabase connection is used.
// PGLITE_MODULE_PATH=/absolute/path/to/pglite/dist/index.js node --test tests/save-recurring-payment.integration.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath) {
  throw new Error(
    "Defina PGLITE_MODULE_PATH apontando para dist/index.js do PGlite instalado separadamente.",
  );
}
const { PGlite } = await import(modulePath);
const migrations = new URL("../supabase/migrations/", import.meta.url);
const userA = "10000000-0000-4000-8000-000000000001";
const userB = "10000000-0000-4000-8000-000000000002";
const clientA = "20000000-0000-4000-8000-000000000001";
const clientB = "20000000-0000-4000-8000-000000000002";
const clientLimit = "20000000-0000-4000-8000-000000000003";
const foreignService = "30000000-0000-4000-8000-000000000001";
const isoDate = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value);

test("recurring payment RPC in an isolated PostgreSQL database", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id UUID PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
    $$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
  `);
  await db.exec(
    await readFile(
      new URL("20260428150718_cf8f496c-05dc-4da1-a6a0-a41117c0a818.sql", migrations),
      "utf8",
    ),
  );

  // Columns from later migrations needed by the recurrence migration.
  await db.exec(`
    ALTER TABLE public.clients ADD COLUMN source TEXT;
    ALTER TABLE public.payments
      ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'other',
      ADD COLUMN reference_month DATE;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients, public.payments
      TO authenticated;
  `);
  await db.exec(
    await readFile(new URL("20260901120000_client_recurring_services.sql", migrations), "utf8"),
  );
  const migration = await readFile(
    new URL("20260930120000_save_recurring_payment.sql", migrations),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration); // Reapplication must remain safe.
  await db.query("INSERT INTO auth.users(id) VALUES ($1), ($2)", [userA, userB]);
  await db.query(
    `
    INSERT INTO public.clients(id, user_id, name)
    VALUES ($1, $4, 'Alice client'), ($2, $5, 'Bob client'), ($3, $4, 'Limit client')
  `,
    [clientA, clientB, clientLimit, userA, userB],
  );
  await db.query(
    `
    INSERT INTO public.client_recurring_services(
      id, user_id, client_id, service_name, amount, due_day, position
    ) VALUES ($1, $2, $3, 'Website', 20, 10, 0)
  `,
    [foreignService, userB, clientB],
  );
  await db.query(
    `
    INSERT INTO public.client_recurring_services(
      user_id, client_id, service_name, amount, due_day, position
    )
    SELECT $1::UUID, $2::UUID, 'Service ' || n, 1, 10, n - 1
    FROM generate_series(1, 50) n
  `,
    [userA, clientLimit],
  );

  const login = async (uid = userA) => {
    await db.exec("SET ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
  };
  const row = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const basePayment = {
    client_id: clientA,
    description: "Website monthly invoice",
    amount: 125.5,
    due_date: "2026-09-10",
    status: "pendente",
    paid_at: null,
    contract_url: "https://example.com/contract",
  };
  const save = async (changes = {}, name = "Website", serviceId = null) =>
    row("SELECT public.save_recurring_payment($1::JSONB, $2::TEXT, $3::UUID) AS id", [
      JSON.stringify({ ...basePayment, ...changes }),
      name,
      serviceId,
    ]);
  const expectError = async (operation, code, message) => {
    await assert.rejects(
      operation,
      (error) => error.code === code && (!message || error.message.includes(message)),
    );
  };
  await login();
  let serviceId;

  await t.test("creates one recurrence, its invoice, and the client's monthly total", async () => {
    const { id } = await save();
    assert.match(id, /^[0-9a-f-]{36}$/);
    const recurring = await row(
      "SELECT * FROM public.client_recurring_services WHERE client_id=$1",
      [clientA],
    );
    serviceId = recurring.id;
    assert.equal(Number(recurring.amount), 125.5);
    assert.equal(recurring.due_day, 10);
    assert.equal(recurring.active, true);
    assert.equal(recurring.position, 0);
    const payment = await row("SELECT * FROM public.payments WHERE id=$1", [id]);
    assert.equal(payment.recurring_service_id, serviceId);
    assert.equal(payment.payment_type, "monthly");
    assert.equal(isoDate(payment.reference_month), "2026-09-01");
    assert.equal(payment.paid_at, null);
    assert.equal(
      Number(
        (await row("SELECT monthly_value FROM public.clients WHERE id=$1", [clientA]))
          .monthly_value,
      ),
      125.5,
    );
  });

  await t.test("same-month duplicate leaves the invoice and recurrence untouched", async () => {
    await expectError(
      () => save({ amount: 999, due_date: "2026-09-26" }, " website "),
      "23505",
      "competência",
    );
    const recurring = await row(
      "SELECT amount, due_day FROM public.client_recurring_services WHERE id=$1",
      [serviceId],
    );
    assert.equal(Number(recurring.amount), 125.5);
    assert.equal(recurring.due_day, 10);
    assert.equal(
      Number(
        (await row("SELECT count(*) FROM public.payments WHERE client_id=$1", [clientA])).count,
      ),
      1,
    );
  });

  await t.test("normalized name reuses the recurrence and updates future billing", async () => {
    await save({ amount: 180, due_date: "2026-10-22" }, " website ");
    assert.equal(
      Number(
        (
          await row("SELECT count(*) FROM public.client_recurring_services WHERE client_id=$1", [
            clientA,
          ])
        ).count,
      ),
      1,
    );
    const recurring = await row("SELECT * FROM public.client_recurring_services WHERE id=$1", [
      serviceId,
    ]);
    assert.equal(Number(recurring.amount), 180);
    assert.equal(recurring.due_day, 22);
    assert.equal(recurring.service_name, "Website");
    assert.equal(
      Number(
        (await row("SELECT monthly_value FROM public.clients WHERE id=$1", [clientA]))
          .monthly_value,
      ),
      180,
    );
  });

  await t.test(
    "existing invoice is skipped by Generate invoices, next month is generated",
    async () => {
      const items = [{ recurring_service_id: serviceId, amount: 180, due_date: "2026-10-22" }];
      const generated = await row(
        "SELECT public.generate_monthly_payments($1::JSONB, $2::DATE) AS count",
        [JSON.stringify(items), "2026-10-01"],
      );
      assert.equal(generated.count, 0);
      items[0].due_date = "2026-11-22";
      assert.equal(
        (
          await row("SELECT public.generate_monthly_payments($1::JSONB, $2::DATE) AS count", [
            JSON.stringify(items),
            "2026-11-01",
          ])
        ).count,
        1,
      );
    },
  );

  await t.test(
    "rejects another owner's client and recurrence, or a mismatched service",
    async () => {
      await expectError(() => save({ client_id: clientB, due_date: "2026-12-10" }), "42501");
      await expectError(() => save({ due_date: "2026-12-10" }, "Website", foreignService), "42501");
      await expectError(() => save({ due_date: "2026-12-10" }, "Other", serviceId), "22023");
      assert.equal(
        Number(
          (
            await row("SELECT count(*) FROM public.client_recurring_services WHERE client_id=$1", [
              clientA,
            ])
          ).count,
        ),
        1,
      );
    },
  );

  await t.test("selected inactive recurrence is reactivated without creating another", async () => {
    await db.query("UPDATE public.client_recurring_services SET active=false WHERE id=$1", [
      serviceId,
    ]);
    await save({ amount: 200, due_date: "2026-12-31" }, "Website", serviceId);
    const recurring = await row(
      "SELECT amount, due_day, active FROM public.client_recurring_services WHERE id=$1",
      [serviceId],
    );
    assert.equal(Number(recurring.amount), 200);
    assert.equal(recurring.due_day, 31);
    assert.equal(recurring.active, true);
  });

  await t.test("a paid invoice retains its payment date and pending ignores paid_at", async () => {
    const { id } = await save(
      { due_date: "2027-01-15", status: "pago", paid_at: "2027-01-13" },
      "Website",
      serviceId,
    );
    assert.equal(
      isoDate((await row("SELECT paid_at FROM public.payments WHERE id=$1", [id])).paid_at),
      "2027-01-13",
    );
    const pending = await save(
      { due_date: "2027-02-15", paid_at: "2027-02-10" },
      "Website",
      serviceId,
    );
    assert.equal(
      (await row("SELECT paid_at FROM public.payments WHERE id=$1", [pending.id])).paid_at,
      null,
    );
    const paid = await save({ due_date: "2027-03-15", status: "pago" }, "Website", serviceId);
    const expected = await row("SELECT CURRENT_DATE::TEXT AS day");
    assert.equal(
      isoDate((await row("SELECT paid_at FROM public.payments WHERE id=$1", [paid.id])).paid_at),
      expected.day,
    );
  });

  await t.test(
    "a day-31 recurrence keeps its monthly day when an invoice falls on April 30",
    async () => {
      const first = await save(
        { amount: 50, due_date: "2027-03-31", recurring_due_day: 31 },
        "End of month",
      );
      const endOfMonth = await row("SELECT recurring_service_id FROM public.payments WHERE id=$1", [
        first.id,
      ]);
      const id = endOfMonth.recurring_service_id;
      const april = await save(
        { amount: 55, due_date: "2027-04-30", recurring_due_day: 31 },
        "End of month",
        id,
      );
      assert.equal(
        (await row("SELECT due_day FROM public.client_recurring_services WHERE id=$1", [id]))
          .due_day,
        31,
      );
      assert.equal(
        isoDate(
          (await row("SELECT due_date FROM public.payments WHERE id=$1", [april.id])).due_date,
        ),
        "2027-04-30",
      );
      const generated = await row(
        "SELECT public.generate_monthly_payments($1::JSONB,$2::DATE) AS count",
        [
          JSON.stringify([{ recurring_service_id: id, amount: 55, due_date: "2027-05-31" }]),
          "2027-05-01",
        ],
      );
      assert.equal(generated.count, 1);
      assert.equal(
        isoDate(
          (
            await row(
              "SELECT due_date FROM public.payments WHERE recurring_service_id=$1 AND reference_month='2027-05-01'",
              [id],
            )
          ).due_date,
        ),
        "2027-05-31",
      );
    },
  );

  await t.test("invalid values and required fields are rejected before writes", async () => {
    const invalid = [
      { amount: 0 },
      { amount: -1 },
      { amount: "NaN" },
      { amount: "Infinity" },
      { amount: 10000000000 },
      { amount: 1.001 },
      { amount: null },
      { client_id: null },
      { client_id: "wrong" },
      { due_date: "2026-02-30" },
      { due_date: "10/09/2026" },
      { due_date: null },
      { paid_at: "2026-02-30" },
      { recurring_due_day: 0 },
      { recurring_due_day: 32 },
      { recurring_due_day: 1.5 },
      { recurring_due_day: "wrong" },
      { status: "invalid" },
      { description: "" },
      { description: "x".repeat(501) },
      { contract_url: "http://example.com" },
      { contract_url: "javascript:alert(1)" },
      { contract_url: "https://example.com/a b" },
    ];
    for (const changes of invalid) await expectError(() => save(changes), "22023");
    await expectError(() => save({}, ""), "22023");
    await expectError(() => save({}, "x".repeat(121)), "22023");
    await expectError(
      () => row("SELECT public.save_recurring_payment('[]'::JSONB,'Website')"),
      "22023",
    );
  });

  await t.test("duplicate service names require an explicit recurrence ID", async () => {
    await db.query(
      `
      INSERT INTO public.client_recurring_services(user_id,client_id,service_name,amount,position)
      VALUES ($1,$2,' WEBSITE ',50,4)
    `,
      [userA, clientA],
    );
    await expectError(() => save({ due_date: "2027-04-10" }), "22023", "mais de uma");
    await save({ due_date: "2027-04-10" }, "Website", serviceId);
  });

  await t.test("new recurrence uses the next position and a client cannot exceed 50", async () => {
    await save({ due_date: "2027-05-10", amount: 30 }, "Design");
    const design = await row(
      "SELECT position FROM public.client_recurring_services WHERE client_id=$1 AND service_name='Design'",
      [clientA],
    );
    assert.equal(design.position, 5);
    await expectError(() => save({ client_id: clientLimit }, "One more"), "22023", "50");
    assert.equal(
      Number(
        (
          await row("SELECT count(*) FROM public.client_recurring_services WHERE client_id=$1", [
            clientLimit,
          ])
        ).count,
      ),
      50,
    );
  });

  await t.test(
    "a failure inserting the invoice rolls back recurrence updates and creations",
    async () => {
      const before = await row(
        "SELECT amount,due_day FROM public.client_recurring_services WHERE id=$1",
        [serviceId],
      );
      await db.exec(`
      RESET ROLE;
      CREATE FUNCTION public.test_invoice_collision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test collision' USING ERRCODE='23505'; END;
      $$;
      CREATE TRIGGER test_invoice_collision BEFORE INSERT ON public.payments
      FOR EACH ROW EXECUTE FUNCTION public.test_invoice_collision();
    `);
      await login();
      await expectError(
        () => save({ amount: 777, due_date: "2027-06-07" }, "Website", serviceId),
        "23505",
        "competência",
      );
      assert.deepEqual(
        await row("SELECT amount,due_day FROM public.client_recurring_services WHERE id=$1", [
          serviceId,
        ]),
        before,
      );
      const totalBefore = await row("SELECT monthly_value FROM public.clients WHERE id=$1", [
        clientA,
      ]);
      await expectError(
        () => save({ amount: 777, due_date: "2027-06-07" }, "Rolled back service"),
        "23505",
      );
      assert.equal(
        Number(
          (
            await row(
              "SELECT count(*) FROM public.client_recurring_services WHERE client_id=$1 AND service_name='Rolled back service'",
              [clientA],
            )
          ).count,
        ),
        0,
      );
      assert.deepEqual(
        await row("SELECT monthly_value FROM public.clients WHERE id=$1", [clientA]),
        totalBefore,
      );
      await db.exec(
        "RESET ROLE; DROP TRIGGER test_invoice_collision ON public.payments; DROP FUNCTION public.test_invoice_collision();",
      );
      await login();
    },
  );

  await t.test("authentication is mandatory and anonymous callers cannot execute", async () => {
    await login("");
    await expectError(() => save({ due_date: "2027-07-10" }), "28000");
    await db.exec("RESET ROLE");
    const grants = await row(`
      SELECT
        has_function_privilege('anon','public.save_recurring_payment(JSONB,TEXT,UUID)','EXECUTE') AS anon,
        has_function_privilege('authenticated','public.save_recurring_payment(JSONB,TEXT,UUID)','EXECUTE') AS authenticated
    `);
    assert.equal(grants.anon, false);
    assert.equal(grants.authenticated, true);
    await db.exec("SET ROLE anon");
    await expectError(() => save({ due_date: "2027-07-10" }), "42501");
  });
});
