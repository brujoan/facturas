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
const styles = file("app/globals.css");

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
assert(app.includes('buildInvoicePdf'), "La factura debe generarse como PDF real, no depender de window.print.");
assert(invoicePdf.includes('"FACTURA A"'), "El PDF aprobado debe mostrar FACTURA A.");
assert(!invoicePdf.includes("dueDate"), "El PDF de cliente no debe incluir vencimiento.");
assert(!invoicePdf.includes("operationDate"), "El PDF de cliente no debe incluir fecha de operación.");
assert(invoicePdf.includes("issueDate.split(\"-\").join(\"_\")"), "El nombre del PDF debe comenzar por la fecha de emisión.");
assert(!invoicePdf.includes('field === "withholding" && rate === 0'), "El PDF debe mostrar también la línea de IRPF cuando el tipo sea 0%.");
assert(app.includes("billingCalendarOpen"), "Facturado debe abrir el calendario visual mensual.");
assert(app.includes("billingCalendarMonths") && app.includes("byDay"), "El calendario debe agrupar la facturación por día.");
assert(app.includes("Acumulado mensual"), "La vista de Facturado debe mostrar acumulado mensual.");
assert(app.includes("invoiceCalendarDate"), "El calendario debe usar una fecha de referencia específica por tipo de factura.");
assert(app.includes('invoice.invoiceMode || "normal") === "monthly"'), "Las facturas mensuales deben identificarse para usar fecha de emisión.");
assert(app.includes("line.serviceDate?.startsWith"), "Los conceptos mensuales con fecha de operación deben aparecer en el calendario.");
assert(app.includes("operationTotal"), "Las operaciones mensuales deben mostrarse sin duplicar el total facturado.");
assert(app.includes("invoiceCountsForBilling"), "Facturado debe usar un criterio propio que incluya borradores.");
assert(app.includes('invoice.status === "Borrador"'), "Facturado debe incluir facturas en borrador.");
assert(app.includes("billingBreakdown.drafts"), "El resumen de Facturado debe separar el importe de borradores.");
assert(fiscal.includes('invoiceCountsAsIssued(invoice)'), "Los borradores deben seguir excluidos de trimestrales.");
assert(app.includes("detail?: string"), "Las líneas de factura deben admitir una descripción detallada.");
assert(app.includes("concept-detail-input"), "El editor debe mostrar el campo de descripción del concepto.");
assert(app.includes("detail: line.detail ||"), "La descripción detallada debe enviarse al PDF.");
assert(invoicePdf.includes("detail?: string"), "El generador PDF debe aceptar la descripción detallada.");
assert(invoicePdf.includes("const COMPACT"), "El PDF debe disponer de una maquetación compacta para priorizar una sola página.");
assert(invoicePdf.includes("fitsSinglePage"), "El PDF debe intentar encajar el contenido en una sola página antes de paginar.");
assert(app.includes("pdfPreview"), "La app debe tener estado para previsualizar el PDF.");
assert(app.includes("buildInvoicePdf"), "La previsualización debe reutilizar el generador PDF real.");
assert(app.includes("pdf-preview-frame"), "La previsualización debe mostrar el PDF dentro de la app.");
assert(app.includes("Descargar PDF"), "La previsualización debe permitir descargar el PDF tras revisarlo.");
assert(invoicePdf.includes('replace(/\\r\\n?/g, "\\n").split("\\n")'), "El PDF debe respetar saltos de línea explícitos en observaciones y textos multilínea.");
assert(!app.includes("onClick={() => printInvoice(invoice)}"), "El botón PDF no debe descargar directamente sin previsualización.");
assert(app.includes("collectionDate?: string"), "Las facturas deben admitir fecha de cobro.");
assert(app.includes("Fecha de cobro"), "El editor debe mostrar la fecha de cobro.");
assert(app.includes("collectionDateFrom") && app.includes("collectionDateTo"), "La lista debe permitir filtrar por fecha de cobro.");
assert(app.includes('toggleInvoiceSort("collectionDate")'), "La columna de cobro debe poder ordenarse.");
assert(app.includes('billingVisible ? currency(t.base + t.vat - t.withholding) : "•••• €"'), "Los importes individuales deben respetar el modo oculto de Facturado.");
assert(!app.includes("<label>Vencimiento"), "La interfaz ya no debe mostrar fecha de vencimiento.");
assert(app.includes('type BillingCalendarView = "month" | "three" | "year"'), "Facturado debe ofrecer vistas de 1 mes, 3 meses y año natural.");
assert(app.includes('billingCalendarView === "three"'), "La vista de 3 meses debe estar implementada.");
assert(app.includes('billingCalendarView === "year"'), "La vista de año natural debe estar implementada.");
assert(app.includes("billingCalendarMonths"), "El calendario multivista debe calcular datos por mes.");
assert(styles.includes(".invoice-list-table") && styles.includes("table-layout: fixed"), "La lista de facturas debe ajustarse al ancho sin scroll horizontal.");
assert(styles.includes(".billing-calendar-collection.year"), "El calendario anual debe tener una cuadrícula compacta.");
assert(styles.includes("overflow: hidden") && styles.includes(".billing-modal"), "El modal de Facturado debe evitar desplazamiento interno innecesario.");

assert(app.includes('type BillingCompareMode = "month" | "year" | "range"'), "El calendario debe permitir comparar meses, años y franjas de fecha.");
assert(app.includes("Comparar periodos"), "El calendario debe incluir el panel comparador.");
assert(app.includes("billingCompareRangeA") && app.includes("billingCompareRangeB"), "El comparador debe admitir dos franjas de fechas.");
assert(app.includes("Cambio B vs A"), "El comparador debe mostrar la diferencia entre periodos.");
assert(styles.includes(".billing-compare-panel"), "El comparador debe tener estilos propios y responsive.");

console.log("Stability checks OK");
