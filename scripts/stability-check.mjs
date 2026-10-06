import { readFileSync } from "node:fs";

function file(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const app = file("components/InvoiceApp.tsx");
const fiscal = file("components/FiscalPanel.tsx");
const edge = file("supabase/functions/facturas-sync/index.ts");

assert(app.includes('status: draft.status') || app.includes('...draft,'), "Guardar factura debe respetar el estado seleccionado.");
assert(!app.includes('draft.status === "Borrador" ? "Emitida"'), "Un borrador nunca debe convertirse automáticamente en emitida.");
assert(app.includes('invoiceCountsAsIssued(invoice)'), "Facturado debe distinguir facturas emitidas/cobradas de borradores.");
assert(app.includes('deletedInvoiceIds'), "Los borrados de facturas deben conservar tombstones.");
assert(app.includes('issuerSnapshot') && app.includes('clientSnapshot'), "Las facturas emitidas deben congelar datos fiscales.");
assert(!app.includes('new Date().toISOString().slice(0, 10)'), "Las fechas de interfaz deben usar fecha local, no UTC.");
assert(fiscal.includes('invoiceTaxDate(invoice)'), "El trimestre fiscal debe usar fecha de operación/periodo.");
assert(fiscal.includes('invoiceCountsAsIssued(invoice)'), "Los borradores no deben entrar en trimestrales.");
assert(edge.includes('revision=eq.'), "La sincronización debe usar compare-and-swap por revisión.");
assert(edge.includes('BACKUP_FAILED'), "Una escritura debe abortar si no se puede crear snapshot previo.");
assert(edge.includes('DUPLICATE_INVOICE_NUMBER'), "El servidor debe bloquear números de factura duplicados.");
assert(edge.includes('recurringExpenses'), "La sincronización fiscal debe conservar los gastos recurrentes.");
assert(fiscal.includes('recurringExpenseId'), "Los gastos recurrentes deben materializarse sin duplicados.");

console.log("Stability checks OK");
