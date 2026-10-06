# Facturas

Gestor privado de facturación creado con Next.js.

## Funciones

- Acceso protegido por contraseña y sesión HTTP-only con expiración.
- Clientes, actividades, conceptos, facturas normales y mensuales/recapitulativas.
- IVA e IRPF distintos por línea.
- Estados Borrador, Emitida, Cobrada y Anulada.
- Numeración de facturas emitidas reservada en servidor.
- Datos fiscales congelados dentro de cada factura emitida.
- Observaciones internas, PDF mediante impresión y copias JSON.
- Panel de trimestrales y gastos.
- Sincronización Mac/iPhone con Supabase, copia local y snapshots de historial.
- Resolución de conflictos por `updatedAt`, tombstones de borrado y revisión atómica del estado.

## Seguridad de datos

La fuente remota de producción es Supabase. El navegador conserva una copia local como respaldo operativo.

La sincronización usa:

1. rutas privadas de Next.js protegidas por sesión;
2. firma ECDSA servidor-servidor hacia una Edge Function;
3. compare-and-swap mediante `app_state.revision`;
4. snapshot previo en `app_state_history`;
5. tombstones para que un dispositivo antiguo no resucite registros eliminados.

Los Preview deployments de Vercel **no tienen acceso al Supabase de producción**.

## Desarrollo

1. Instala Node.js 22.
2. Ejecuta `npm install`.
3. Copia `.env.example` a `.env.local`.
4. Configura `APP_PASSWORD` y `COOKIE_SECRET`.
5. Para sincronización remota, despliega `supabase/functions/facturas-sync/index.ts`, aplica `supabase/schema.sql` y configura `SUPABASE_SYNC_URL` y `SYNC_SIGNING_PRIVATE_KEY` solo en el servidor.
6. Ejecuta `npm run test:stability`.
7. Ejecuta `npm run dev`.

## Flujo de despliegue

- Los cambios se desarrollan en rama y se validan en Preview.
- Preview no escribe en la base real.
- GitHub Actions ejecuta los checks de estabilidad y `next build`.
- Solo el commit final se integra en `main`, generando un único deployment de producción.

## Nota fiscal

La aplicación es una herramienta de control. Los cálculos dependen de los datos introducidos y no sustituyen la autoliquidación ni el criterio de la AEAT/asesoría.
