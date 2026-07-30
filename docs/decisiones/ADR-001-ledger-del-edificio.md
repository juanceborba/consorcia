# ADR-001 — Motor del ledger del edificio

- **Fecha:** 2026-07-30
- **Estado:** aceptada (para la capa B; la capa A ya se implementó sin ledger en S3-21)
- **Contexto previo:** `docs/investigacion/ledger-y-fondo-de-reserva.md`

---

## Contexto

El fondo de reserva (S3-21) acumula plata, y lo que sigue —usar el fondo para financiar una obra,
cobrar expensas, pagarle a un proveedor y mantener su cuenta corriente— es **movimiento de dinero
con saldo**. Eso pide un ledger de doble partida: cuentas, asientos balanceados, saldo a una fecha
y un registro que no se edita.

La pregunta de esta decisión: **¿lo construimos o adoptamos un proyecto open source?** Y si
adoptamos, ¿cuál?

Requisitos, en orden de peso:

1. **Atomicidad con el dominio.** Aprobar una liquidación y asentar sus movimientos tienen que ser
   una sola operación. Si se pueden desincronizar, existe el estado "cobré y no lo registré".
2. **Doble partida real** (Σ débitos = Σ créditos) e inmutabilidad (corrección por contra-asiento).
3. **Auditoría en SQL**: la Ley 941 §5 pide estado patrimonial, y los reportes salen de nuestras
   queries.
4. **Aislamiento por organización** (el resto del schema usa RLS).
5. **Costo operativo bajo**: el stack es docker-compose; cada servicio nuevo es backup, monitoreo,
   upgrade y un modo de falla más.
6. Volumen: decenas de movimientos por edificio y mes. **No es un problema de throughput.**

---

## Opciones evaluadas

| Opción | Licencia | Dónde corre | Atomicidad con el dominio | Veredicto |
|---|---|---|---|---|
| **pgledger** | MIT | **Dentro de nuestro Postgres** (tablas + funciones plpgsql) | ✅ misma transacción | ✅ **Elegida** |
| Tablas propias | — | Nuestro Postgres | ✅ misma transacción | Plan B: lo mismo, pero escribiendo (y depurando) nosotros la doble partida |
| [TigerBeetle](https://github.com/tigerbeetle/tigerbeetle) | Apache-2.0 | Servicio + DB propia | ❌ dos almacenes | Descartada |
| [Formance Ledger](https://github.com/formancehq/ledger) | MIT | Servicio Go + su Postgres | ❌ dos almacenes | Descartada |
| [Blnk](https://github.com/blnkfinance/blnk) | Apache-2.0 | Servicio Go + Postgres + Redis | ❌ dos almacenes | Descartada |
| [Midaz](https://github.com/LerianStudio/midaz) | Elastic 2.0 | Servicio Go | — | Descartada por licencia (source-available, no libre) |

### pgledger — pros y contras

**Pros**

- **Es SQL, no un servicio.** Se instala como un archivo más de migración: tablas, funciones
  (`pgledger_create_account`, `pgledger_create_transfer`) y vistas dentro de nuestra base. La
  llamada al ledger participa de **la misma transacción** que el `UPDATE` de la liquidación: o
  quedan las dos cosas o no queda ninguna. Este solo punto resuelve el riesgo que descartó a las
  otras tres opciones.
- **El modelo ya está resuelto y probado**: doble partida, saldos, concurrencia con el locking de
  Postgres, entradas inmutables e historial. Es la parte que uno cree trivial hasta que aparecen
  dos transferencias simultáneas sobre la misma cuenta.
- **Rendimiento de sobra**: ~10.600 transferencias/s con contención baja y ~7.500 con contención
  alta, en una notebook. Nuestro orden de magnitud es de decenas por edificio y mes.
- **MIT**, sin fricción legal.
- **Se puede leer entero.** Es un archivo SQL: auditable en una tarde, sin caja negra ni versión
  cloud con features distintas.

**Contras (y qué hacemos con cada uno)**

- **Sin multi-tenancy ni RLS propios.** El scoping por organización lo ponemos nosotros: prefijo en
  el nombre de la cuenta más una tabla de mapeo `(organizacionId, edificioId, tipo) → cuenta`, con
  RLS en *esa* tabla. Es la misma estrategia que ya usamos para los recursos híbridos.
- **Una moneda por cuenta.** Es lo correcto contablemente; los gastos en USD (que el schema admite)
  necesitarían cuentas propias. Hoy no hay caso real.
- **Proyecto joven** (~480 ★, 178 commits) y sin migraciones numeradas todavía. Mitigación: se
  vendorea el `.sql` dentro de `backend/prisma/migrations/`, así queda pineado a una versión que
  controlamos; actualizarlo es una migración nueva, deliberada.
- **Prisma no lo conoce.** Las llamadas van por `$queryRaw`/`$executeRaw` detrás de
  `services/ledger.js`. Preferible a modelar las tablas del ledger en el schema de Prisma y que
  `migrate diff` pelee con las funciones.

### Por qué no las de servicio

Las tres (TigerBeetle, Formance, Blnk) son buenas y ninguna resuelve el requisito 1: **no hay
`BEGIN` que abarque nuestro Postgres y su almacén**. Una liquidación aprobada cuyo asiento se
perdió deja plata sin registrar, y resolverlo bien pide outbox + reconciliación + alertas: más
máquina que el problema. Además: Formance solo soporta producción vía operador de Kubernetes (el
stack es docker-compose), TigerBeetle no habla SQL —los reportes de Ley 941 los armaríamos igual
nosotros— y Blnk suma un Redis propio.

Si algún día el volumen o una exigencia regulatoria lo justifican, el seam permite cambiar: todo el
dominio habla con `services/ledger.js`, nunca con las tablas.

---

## Decisión

**Adoptar pgledger, vendoreado como migración, detrás de `services/ledger.js`.**

Consecuencias:

1. El ledger vive en nuestra base y participa de nuestras transacciones.
2. El plan de cuentas del consorcio (CAJA, FONDO_RESERVA, CxC por UF, CxP por proveedor, ingresos y
   egresos) es **nuestro**: pgledger da el mecanismo, no el modelo contable del dominio.
3. `services/ledger.js` es la única puerta: `asentar(asiento)`, `saldo(cuenta, corte)`,
   `extracto(cuenta, desde, hasta)`. Ningún módulo consulta las tablas del ledger directo.
4. La correctitud se defiende con tests de invariantes (Σ débitos = Σ créditos, saldo = suma de
   movimientos, idempotencia por operación de dominio), igual que el motor de liquidación.
5. Se revisa esta decisión si aparece un requisito de multi-moneda real o si el volumen sube dos
   órdenes de magnitud.

## Qué NO decide este ADR

- El plan de cuentas definitivo y la mecánica de aprobación del uso del fondo: son de la tarea de
  la capa B (ver el documento de investigación).
- Si las cobranzas (`Cobro`) se migran a asientos o conviven un tiempo: se decide al implementarlas.

## Fuentes

- [pgledger — doble partida en PostgreSQL puro (MIT)](https://github.com/pgr0ss/pgledger)
- [Formance Ledger](https://github.com/formancehq/ledger) · [TigerBeetle](https://github.com/tigerbeetle/tigerbeetle) · [Blnk](https://github.com/blnkfinance/blnk) · [Midaz](https://github.com/LerianStudio/midaz)
