import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

if (!process.env.PGLITE_MODULE_PATH) throw new Error("Defina PGLITE_MODULE_PATH para executar em PostgreSQL isolado.");
const {PGlite}=await import(process.env.PGLITE_MODULE_PATH);
test("closure trigger dates only future stage transitions and preserves history",async()=>{
  const db=new PGlite();
  try {
    await db.exec("CREATE ROLE anon; CREATE TABLE leads(id integer primary key, stage text, closed_at timestamptz, name text);");
    const sql=await readFile(new URL("../supabase/migrations/20261001140000_lead_closure_dates.sql",import.meta.url),"utf8");
    await db.exec(sql);
    await db.exec(sql);
    await db.exec("INSERT INTO leads(id,stage) VALUES(1,'novo'); UPDATE leads SET stage='ganho' WHERE id=1;");
    let row=(await db.query("SELECT stage,closed_at FROM leads WHERE id=1")).rows[0];
    assert(row.closed_at);
    const first=String(row.closed_at);
    await db.exec("UPDATE leads SET name='Editado' WHERE id=1;");
    assert.equal(String((await db.query("SELECT closed_at FROM leads WHERE id=1")).rows[0].closed_at),first);
    await db.exec("UPDATE leads SET stage='novo' WHERE id=1;");
    assert.equal((await db.query("SELECT closed_at FROM leads WHERE id=1")).rows[0].closed_at,null);
    await db.exec("UPDATE leads SET stage='perdido',closed_at='2026-09-30 22:00:00-03' WHERE id=1;");
    row=(await db.query("SELECT closed_at FROM leads WHERE id=1")).rows[0];
    assert.equal(new Date(row.closed_at).toISOString(),"2026-10-01T01:00:00.000Z");
    await db.exec("INSERT INTO leads(id,stage) VALUES(2,'perdido');");
    assert((await db.query("SELECT closed_at FROM leads WHERE id=2")).rows[0].closed_at);
  } finally {await db.close();}
});
