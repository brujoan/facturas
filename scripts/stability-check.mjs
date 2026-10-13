import { readFileSync } from "node:fs";

function file(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const app = file("components/InvoiceApp.tsx");
const fiscal = file("components/FiscalPanel.tsx");
const finance = file("components/FinancePanel.tsx");
const personal = file("components/PersonalFinancePanel.tsx");
const database = file("lib/database.ts");
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

assert(app.includes("changeInvoiceStatus"), "La lista de facturas debe permitir cambiar el estado directamente.");
assert(app.includes("invoice-status-select"), "La lista debe mostrar un selector de estado por factura.");
assert(!app.includes("Una factura ya numerada no puede volver a Borrador"), "Una factura numerada debe poder volver a Borrador conservando su número.");
assert(app.includes("queda reservado"), "Al volver a Borrador debe indicarse que el número queda reservado.");
assert(edge.includes('if (!number) continue;') && !edge.includes('if (!number || status === "Borrador") continue;'), "Los números de borradores numerados deben seguir reservados en sincronización.");
assert(app.includes('tab === "finanzas"'), "La app debe incluir el apartado de ingresos y gastos.");
assert(finance.includes("Ingresos y gastos"), "El apartado financiero debe mostrar ingresos y gastos.");
assert(finance.includes("profit: money(incomeBase - expenseBase)"), "El beneficio debe calcularse como ingresos base menos gastos base.");
assert(finance.includes("fiscalProfit: money(incomeBase - deductibleExpenseBase)"), "La vista debe separar el rendimiento fiscal aproximado.");
assert(finance.includes('fetch("/api/fiscal"'), "La vista financiera debe reutilizar los gastos del control fiscal.");
assert(styles.includes(".finance-kpis") && styles.includes(".invoice-status-select"), "La nueva interfaz debe tener estilos responsive.");

assert(app.includes('tab === "cuentas"'), "La navegación debe incluir el apartado personal Cuentas.");
assert(app.includes("nav-group-toggle") && app.includes("Autónomo"), "Los apartados profesionales deben agruparse en el desplegable Autónomo.");
assert(personal.includes("Finanzas personales") && personal.includes("<h1>Cuentas</h1>"), "Cuentas debe tener una vista personal independiente.");
assert(personal.includes('invoice.status !== "Cobrada"'), "Autónomo debe calcularse automáticamente desde facturas cobradas.");
assert(personal.includes("Nómina") && personal.includes("Ingreso extra") && personal.includes("Mensualidades") && personal.includes("Seguros") && personal.includes("Deporte"), "La tabla anual debe conservar las columnas del control personal.");
assert(!personal.includes(">Motivo ing.<") && !personal.includes(">Motivo g.<"), "Ingreso extra y Gasto extra no deben ocupar columnas separadas de motivo.");
assert(personal.includes("Ingreso total") && personal.includes("Gasto total") && personal.includes("Ahorro"), "La tabla debe calcular totales y ahorro mensual.");
assert(personal.includes("TOTAL {year}") && personal.includes("monthNames.map"), "Cuentas debe mostrar doce meses y una fila total anual.");
assert(personal.includes('fetch("/api/personal"') && personal.includes("accountMonths"), "Cuentas debe sincronizar las filas mensuales con la API personal.");
assert(database.includes("accountMonths?: unknown[]"), "La sincronización debe tipar las filas mensuales personales.");
assert(edge.includes('scope === "personal"') && edge.includes("accountMonths: mergeByKey"), "Supabase debe fusionar las filas mensuales por id.");
assert(edge.includes('"default", "fiscal", "personal"'), "La Edge Function debe aceptar el ámbito personal.");
assert(styles.includes(".nav-group-toggle") && styles.includes(".accounts-table"), "El menú Autónomo y la tabla anual deben tener estilos responsive.");
assert(personal.includes("accounts-mobile-list") && personal.includes("accounts-mobile-month"), "Cuentas debe tener una vista móvil sin scroll horizontal.");
assert(styles.includes("/* v0.14.1 · Cuentas sin scroll horizontal */"), "Cuentas debe incluir el ajuste de ancho completo.");
assert(styles.includes(".accounts-table-scroll {\n  overflow-x: hidden;"), "La tabla de Cuentas no debe requerir desplazamiento horizontal en escritorio.");
assert(styles.includes("@media (max-width: 900px)") && styles.includes(".accounts-table-panel {\n    display: none;"), "En pantallas estrechas la tabla debe sustituirse por fichas legibles.");
assert(!personal.includes("invoiceFreelanceIncomeWithoutVat"), "Cuentas no debe calcular automáticamente el ingreso de Autónomo desde facturas.");
assert(personal.includes('"freelanceIncome"') && personal.includes('value="freelanceIncome"'), "El ingreso de Autónomo debe registrarse manualmente y estar disponible en el alta rápida.");
assert(personal.includes("freelanceExpense"), "Cuentas debe incluir Autónomo como categoría de gasto.");
assert(personal.includes("breakdowns?: Partial<Record<BreakdownField, BreakdownItem[]>>"), "Ingresos extra y gastos deben poder guardar un desglose por conceptos.");
assert(personal.includes("openBreakdown") && personal.includes("Guardar desglose"), "La tabla debe permitir abrir y guardar el detalle de cada gasto.");
assert(personal.includes('colSpan={8}>Gastos') && personal.includes('colSpan={4}>Ingresos'), "La tabla debe mantener los grupos compactos tras fusionar las columnas de motivo y añadir Coche.");
assert(styles.includes("/* v0.15.0 · Cuentas legibles y gastos desglosables */"), "Cuentas debe aplicar la tipografía ampliada y el modal de desglose.");
assert(styles.includes(".accounts-breakdown-modal") && styles.includes(".accounts-breakdown-button"), "El desglose de gastos debe tener interfaz propia.");
assert(personal.includes("accounts-quick-movement") && personal.includes("addQuickMovement"), "Cuentas debe permitir añadir movimientos rápidamente junto al selector de año.");
assert(personal.includes('value="expense"') && personal.includes('value="income"'), "El alta rápida debe permitir elegir entre gasto e ingreso.");
assert(personal.includes('value="monthlyPayments"') && personal.includes('value="freelanceExpense"') && personal.includes('value="freelanceIncome"') && personal.includes('value="extraIncome"'), "El alta rápida debe permitir elegir la sección correspondiente.");
assert(personal.includes("Falta fecha, importe o concepto"), "El alta rápida debe exigir fecha, importe y concepto.");
assert(personal.includes("Sin desglosar") && personal.includes("nextItems"), "Los gastos añadidos rápidamente deben integrarse en el desglose sin perder importes anteriores.");
assert(styles.includes("/* v0.15.1 · Alta rápida de movimientos */") && styles.includes(".accounts-quick-movement"), "El acceso rápido debe tener estilos compactos y responsive.");
assert(personal.includes('type="date"') && personal.includes("quickDate") && personal.includes("todayISO()"), "El alta rápida debe incluir fecha y usar hoy como valor inicial.");
assert(personal.includes("cycleMonthForDate(quickDate, months)") && personal.includes("setYear(targetYear)"), "La fecha del movimiento debe decidir el ciclo y año donde se guarda.");
assert(personal.includes('type BreakdownField = ExpenseField | "freelanceIncome" | "extraIncome"'), "Autónomo e Ingreso extra deben reutilizar el sistema de desglose.");
assert(personal.includes('breakdownCell(row.id, row.name, "extraIncome"') && personal.includes('breakdownCell(row.id, row.name, "extraExpense"'), "Ingreso extra y Gasto extra deben mostrar un único total con desglose.");
assert(personal.includes("date: quickDate") && personal.includes('className="accounts-breakdown-date"'), "Los movimientos desglosados añadidos rápidamente deben conservar y mostrar su fecha.");
assert(styles.includes("/* v0.16.0 · Fecha rápida, extras desglosados y tipografía mayor */"), "Cuentas debe aprovechar las columnas eliminadas para aumentar la tipografía.");
assert(personal.includes('"carExpense"') && personal.includes(">Coche<"), "Cuentas debe incluir una columna de gastos de coche.");
assert(personal.includes("salaryDate?: string") && personal.includes("cycleMonthForDate"), "Cuentas debe guardar la fecha de nómina y usarla para asignar ciclos.");
assert(personal.includes("rebalanceDatedBreakdowns") && personal.includes("salaryDate: quickDate"), "Registrar una nómina debe reajustar los movimientos fechados al ciclo correcto.");
assert(personal.includes("payCycleRanges") && personal.includes("dayBefore"), "La fila mensual debe mostrar el rango real del ciclo de cobro.");
assert(personal.includes("lastMovementDate") && personal.includes("Último:"), "Cuentas debe mostrar la fecha del último movimiento registrado.");
assert(personal.includes('breakdownCell(row.id, row.name, "freelanceIncome"'), "El ingreso de Autónomo debe ser editable y desglosable como movimiento manual.");
assert(styles.includes("/* v0.17.0 · Ciclos de nómina, coche y guía de celda */"), "Cuentas debe incluir estilos para ciclos y orientación visual.");
assert(styles.includes("tr:not(.accounts-year-total):hover") && styles.includes(":nth-child(14):hover"), "La tabla debe resaltar fila y columna al pasar por una casilla.");
assert(personal.includes("salaryDateEditor") && personal.includes("saveSalaryDate") && personal.includes("Cambiar fecha de nómina"), "La fecha de nómina debe poder corregirse después y recalcular los ciclos.");
assert(personal.includes("accounts-year-average") && personal.includes("averageMonthCount") && personal.includes("averages"), "Debajo de los totales debe mostrarse una media mensual.");
assert(personal.includes("rows.filter((row)") && personal.includes("row.totalExpense !== 0"), "La media debe calcularse solo con meses que tienen datos.");
assert(styles.includes("/* v0.18.0 · Autónomo manual, fecha de nómina editable y tabla pulida */"), "Cuentas debe aplicar el pulido visual de importes y columnas.");
assert(styles.includes("font-variant-numeric: tabular-nums") && styles.includes("text-overflow: clip"), "Los importes deben mantenerse alineados y contenidos dentro de su columna.");
assert(styles.includes(".accounts-salary-date-modal") && styles.includes(".accounts-year-average"), "La edición de nómina y la fila de media deben tener estilos propios.");





console.log("Stability checks OK");
