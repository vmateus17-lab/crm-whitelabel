import assert from "node:assert/strict";
import test from "node:test";
import { buildLeadUpdate, type Lead } from "../src/lib/leads.ts";
import { toSaoPauloInputParts } from "../src/lib/reminders.ts";

test("edição de lead preserva identidade, histórico de etapas e vínculo financeiro", () => {
  const form = {
    id: "original",
    user_id: "outro-usuario",
    name: "  Lead atualizado  ",
    company: " Empresa ",
    contact: " cliente@example.com ",
    whatsapp: "11999999999",
    estimated_value: 1200,
    stage: "perdido",
    created_at: "2026-01-01T00:00:00Z",
    contacted_at: "2026-01-03T00:00:00Z",
    closed_at: "2026-01-10T00:00:00Z",
    converted_client_id: "cliente-original",
    loss_reason: "Preço",
    deleted_at: "2026-09-01T00:00:00Z",
    notes: "Observação",
    services: ["Tráfego Pago"],
    source: "Indicação",
    follow_up_at: "2026-09-30T15:00:00Z",
    follow_up_has_time: true,
    reminder_offsets_minutes: [60, 60, 0, 999],
    attachments: [{ name: "Documento", path: "usuario/leads/documento.pdf" }],
  } as unknown as Lead;
  const update = buildLeadUpdate(form);
  assert.equal(update.name, "Lead atualizado");
  assert.equal(update.company, "Empresa");
  assert.equal(update.contact, "cliente@example.com");
  assert.equal(update.estimated_value, 1200);
  assert.deepEqual(update.services, ["Tráfego Pago"]);
  assert.deepEqual(update.reminder_offsets_minutes, [60, 0]);
  assert.deepEqual(update.attachments, form.attachments);
  assert.equal(update.follow_up_at, form.follow_up_at);
  for (const field of [
    "id",
    "user_id",
    "stage",
    "created_at",
    "contacted_at",
    "closed_at",
    "converted_client_id",
    "loss_reason",
    "deleted_at",
  ]) {
    assert.equal(Object.hasOwn(update, field), false, field + " deve permanecer inalterado");
  }
  assert.notEqual(update.services, form.services);
});

test("edição limita textos e converte campos opcionais vazios para null", () => {
  const update = buildLeadUpdate({
    name: "a".repeat(250),
    company: " ",
    contact: "",
    notes: "a".repeat(11000),
  });
  assert.equal(update.name.length, 200);
  assert.equal(update.notes?.length, 10000);
  assert.equal(update.company, null);
  assert.equal(update.contact, null);
  assert.equal(update.follow_up_at, null);
  assert.equal(update.follow_up_has_time, false);
  assert.deepEqual(update.services, []);
  assert.deepEqual(update.attachments, []);
});

test("mês do Pipeline usa data de São Paulo, inclusive na virada UTC", () => {
  assert.equal(toSaoPauloInputParts("2026-10-01T02:59:00Z").date.slice(0, 7), "2026-09");
  assert.equal(toSaoPauloInputParts("2026-10-01T03:00:00Z").date.slice(0, 7), "2026-10");
});
