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
const invoicePdf = file("lib/invoicePdf.ts");

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
assert(app.includes('downloadInvoicePdf'), "La factura debe descargarse como PDF generado, no depender de window.print.");
assert(invoicePdf.includes('"FACTURA A"'), "El PDF aprobado debe mostrar FACTURA A.");
assert(!invoicePdf.includes("dueDate"), "El PDF de cliente no debe incluir vencimiento.");
assert(!invoicePdf.includes("operationDate"), "El PDF de cliente no debe incluir fecha de operación.");
assert(invoicePdf.includes("issueDate.split(\"-\").join(\"_\")"), "El nombre del PDF debe comenzar por la fecha de emisión.");
assert(app.includes("billingCalendarOpen"), "Facturado debe abrir el calendario visual mensual.");
assert(app.includes("billingCalendarData"), "El calendario debe agrupar la facturación por día.");
assert(app.includes("Acumulado mensual"), "La vista de Facturado debe mostrar acumulado mensual.");

console.log("Stability checks OK");
