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
- Persistencia remota opcional con Supabase y copia local de respaldo.

## Ejecutar en local

1. Instala Node.js 20 o superior.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env.local`.
4. Configura:
   - `APP_PASSWORD`: contraseña de acceso.
   - `COOKIE_SECRET`: cadena aleatoria larga (mínimo recomendado: 32 caracteres).
   - `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` si quieres persistencia remota.
5. Si usas Supabase, ejecuta el SQL de `supabase/schema.sql` en el proyecto.
6. Ejecuta `npm run dev`.
7. Abre `http://localhost:3000`.

## Despliegue recomendado

El proyecto está preparado para Vercel. Vincula el repositorio `brujoan/facturas` y configura las variables de entorno anteriores.

La `SUPABASE_SERVICE_ROLE_KEY` solo se utiliza en rutas del servidor y nunca debe exponerse con un prefijo `NEXT_PUBLIC_`.

## Persistencia

- Sin Supabase: la aplicación funciona con `localStorage` en el navegador.
- Con Supabase: facturas, clientes, actividades y configuración se guardan en PostgreSQL y se sincronizan entre dispositivos. El navegador conserva una copia local como respaldo operativo.
- La tabla necesaria está definida en `supabase/schema.sql`.
- La tabla tiene RLS activado y no expone políticas públicas; la escritura/lectura se realiza exclusivamente desde el servidor de Next.js.

## Nota fiscal

La aplicación calcula IVA y retenciones con los porcentajes introducidos por el usuario. No determina si una retención o tipo impositivo concreto corresponde legalmente a una operación.
