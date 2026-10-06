# Facturas

Gestor privado de facturación creado con Next.js.

## Funciones incluidas

- Acceso protegido por contraseña validada en servidor.
- Cookie de sesión HTTP-only.
- Datos fiscales del emisor.
- Agenda de clientes.
- Series y numeración automática.
- Fecha de emisión, operación y vencimiento.
- Múltiples conceptos por factura.
- Actividad distinta por línea.
- IVA distinto por línea.
- Retención/IRPF distinto por línea.
- Desglose de impuestos por porcentaje.
- Estados: borrador, emitida, cobrada y anulada.
- Forma de pago, IBAN y notas.
- Vista preparada para imprimir o guardar como PDF.
- Duplicado y edición de facturas.

## Ejecutar en local

1. Instala Node.js 20 o superior.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env.local`.
4. Cambia:
   - `APP_PASSWORD`: contraseña de acceso.
   - `COOKIE_SECRET`: cadena aleatoria larga (mínimo recomendado: 32 caracteres).
5. Ejecuta `npm run dev`.
6. Abre `http://localhost:3000`.

## Despliegue

Puede desplegarse en Vercel u otro servidor compatible con Next.js. Configura allí las variables `APP_PASSWORD` y `COOKIE_SECRET`; no subas el archivo `.env.local` al repositorio.

## Persistencia actual

En esta primera versión, clientes, configuración e invoices se guardan en `localStorage` del navegador. Esto permite usar la app sin configurar una base de datos, pero **no sirve como copia de seguridad ni para sincronizar varios dispositivos**.

La siguiente mejora recomendada es una base de datos (por ejemplo PostgreSQL/Supabase) con copias de seguridad, manteniendo el acceso protegido en servidor.

## Nota fiscal

La aplicación calcula IVA y retenciones con los porcentajes introducidos por el usuario. No determina si una retención o tipo impositivo concreto corresponde legalmente a una operación.
