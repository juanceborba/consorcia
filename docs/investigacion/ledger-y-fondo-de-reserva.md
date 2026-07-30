# Fondo de reserva y ledger del edificio — análisis de alcance

> **Estado:** análisis previo a implementar (2026-07-30). Disparado por S3-21 ("Fondo de reserva en
> la liquidación", brecha 4 del research de ordinarias/extraordinarias), que al discutirse creció:
> las reglas del fondo tienen que ser **configurables por edificio y con vigencia temporal**, el
> fondo es **acumulativo** más allá de la regla, y el saldo debería vivir en un **ledger** del
> edificio que después sirva también para **pagar a proveedores** (con su propio ledger).
>
> Este documento decide **qué entra ahora y qué no**, y con qué tecnología.

---

## 1. Las dos capas, y por qué conviene separarlas

| | Capa A — Comportamiento del fondo | Capa B — Ledger del edificio |
|---|---|---|
| Pregunta que responde | ¿Cuánto aporta cada UF este mes al fondo? | ¿Cuánta plata hay, de quién es y a quién se le debe? |
| Alcance | Un edificio, un período, una regla vigente | Todo el dinero del edificio: cobranzas, fondo, pagos a proveedores |
| Depende de | El motor de liquidación (S3-04) | Nada de lo que existe hoy |
| Si se hace sola | Cierra la brecha 4: el fondo aparece en la expensa y en el recibo | No sirve de nada sin movimientos que registrar |

**Son separables y el orden natural es A → B.** La capa A produce un número por período (el aporte
al fondo) que la capa B, cuando exista, va a registrar como un asiento más. Al revés no: un ledger
sin reglas de fondo no tiene qué asentar, y las cobranzas (S4 del roadmap) todavía no existen.

Lo que **no** es separable es el "uso del fondo para financiar una extraordinaria": eso es
inherentemente saldo, y sin ledger no se puede afirmar que el fondo alcanzaba.

---

## 2. Capa A — Fondo de reserva con reglas temporales

### 2.1 Modelo

```
ReglaFondoReserva
  id, organizacionId, edificioId
  vigenciaDesde     String   // "2026-08" — el período DESDE el que rige
  base              enum { ORDINARIAS | TOTAL | MONTO_FIJO }
  porcentaje        Decimal? // 5.00 = 5%   (base ORDINARIAS | TOTAL)
  montoFijo         Decimal? // (base MONTO_FIJO)
  esquemaRepartoId  String?  // null = el esquema general del edificio; si no hay, coeficiente
  motivo            String?  // "Asamblea del 12/07/2026" — respaldo (brecha 3 del research)
  createdBy, createdAt
  @@unique([edificioId, vigenciaDesde])
```

**Por qué versionado por período y no un campo en `ConfiguracionLiquidacion`:** una liquidación
emitida no puede cambiar de importe porque hoy alguien tocó un porcentaje. La regla se resuelve
como "la de mayor `vigenciaDesde` menor o igual al período liquidado", y la liquidación guarda el
**snapshot** de lo aplicado — el mismo criterio que ya usan el esquema de reparto y el rótulo de
cuotas en `LiquidacionDetalle` (S3-19/S3-20). Cambiar la regla a futuro no reescribe el pasado; es
además lo que pide la práctica: el porcentaje lo fija una asamblea con fecha.

### 2.2 Cómo entra en la liquidación

- `Liquidacion.totalFondoReserva` (Decimal, default 0) + `totalGeneral = ordinarias + extraordinarias + fondo`.
- `LiquidacionDetalle.tipo` (enum `GASTO | FONDO_RESERVA`) y `gastoId` pasa a nullable: el aporte
  es un ítem por UF sin gasto detrás. **Alternativa descartada:** una tabla aparte de detalles del
  fondo — duplicaría el reparto, la fila del recibo y los tests de reconciliación.
- **Reparto: por el esquema general del edificio** (decisión del 2026-07-30), con fallback al
  reparto por coeficiente. Reusa `resolverEsquema` de S3-20 sin motor nuevo.
  - ⚠️ **Consecuencia a asumir por escrito:** un esquema pensado para el ascensor (p. ej. "PB al
    50%") va a eximir parcialmente del fondo a esa UF. Contribuir al fondo es obligación de todo
    propietario (CCyC art. 2046 inc. d) y no admite exención por falta de acceso a un servicio,
    así que la regla puede apuntar a su **propio** esquema (`esquemaRepartoId`) cuando el general
    no corresponda. La UI de configuración tiene que decir cuál se está usando.
- La separación de Ley 941 se mantiene: el fondo es su **tercer** subtotal, no se mezcla con
  ordinarias ni extraordinarias, en la liquidación y en el recibo.

### 2.3 Invariante nueva (test de cero tolerancia)

`Σ montoAsignado de todos los detalles = totalOrdinarias + totalExtraordinarias + totalFondoReserva`
al centavo, con el ajuste de redondeo en la última UF alcanzada — igual que el resto del motor.

---

## 3. Capa B — El ledger

### 3.1 Qué tiene que garantizar

1. **Doble partida**: todo movimiento afecta dos cuentas y `Σ débitos = Σ créditos` por asiento.
2. **Append-only**: no se edita ni se borra; un error se corrige con un contra-asiento (Ley 941 §5
   pide estado patrimonial auditable).
3. **Idempotencia**: aprobar dos veces la misma liquidación no puede duplicar el aporte.
4. **Saldo a una fecha**, no solo el actual.
5. **Aislamiento por organización** (RLS, como el resto del schema).

Plan de cuentas mínimo, por edificio:

```
CAJA / BANCO (activo)            ← lo que hay
FONDO_RESERVA (pasivo/reserva)   ← acumulado, afectado a su destino
CxC UNIDAD <id> (activo)         ← lo que debe cada UF          (hoy: Cobro)
CxP PROVEEDOR <id> (pasivo)      ← lo que se le debe a cada uno  (hoy: no existe)
INGRESOS / EGRESOS por rubro     ← resultado
```

Con eso, los hechos del dominio son asientos: emitir la liquidación (CxC ↔ ingresos + fondo),
cobrar una expensa (caja ↔ CxC), registrar la factura de un proveedor (egreso ↔ CxP), pagarle
(CxP ↔ caja) y usar el fondo (fondo ↔ caja o ↔ egreso de la obra).

### 3.2 ¿Servicio open source o tabla propia?

| Opción | Licencia | Stack que suma | Veredicto |
|---|---|---|---|
| **Ledger propio en Postgres** | — | Ninguno | ✅ **Recomendado para el MVP** |
| [TigerBeetle](https://github.com/tigerbeetle/tigerbeetle) | Apache-2.0 | Otra DB (no SQL), su propio backup/operación | Overkill: está hecho para millones de transferencias por segundo. Montos como enteros de precisión fija, esquema rígido de `accounts`/`transfers`, sin multi-tenancy ni consultas ad-hoc → los reportes de Ley 941 los seguimos armando nosotros |
| [Formance Ledger](https://github.com/formancehq/ledger) | MIT | Servicio Go + su Postgres | Muy capaz (Numscript, multi-posting atómico), pero **producción solo soportada vía operador de Kubernetes** — el stack es docker-compose |
| [Blnk](https://github.com/blnkfinance/blnk) | Apache-2.0 | Servicio Go + Postgres + Redis | El más cercano en forma (self-host con compose, balances, inflight, conciliación). Proyecto joven (~485 ★) y de todos modos hay que mapear organización/edificio/UF a su modelo |
| [Midaz](https://github.com/LerianStudio/midaz) | Elastic License 2.0 | Servicio Go | **Descartado por licencia**: source-available, no libre |

**Por qué la tabla propia gana hoy:** la garantía que buscamos —que la plata cuadre— no la da el
servicio externo, la dan la doble partida, las invariantes testeadas y una transacción ACID. Todo
eso ya lo tenemos: Postgres, `decimal.js` en el borde y tests de cero tolerancia (el motor de
liquidación ya reconcilia al centavo).

**El riesgo que agrega un ledger externo, dicho explícito:** dos almacenes sin transacción común.
Una liquidación aprobada en Postgres cuyo asiento se perdió en el ledger externo deja plata sin
registrar, y no hay `BEGIN` que abarque los dos. Resolverlo bien pide outbox + reconciliación —
más máquina que el problema que estamos resolviendo, para el volumen de un consorcio (decenas de
movimientos por edificio y mes).

**El seam:** todo el dominio habla con `services/ledger.js` (`asentar(asiento)`, `saldo(cuenta, corte)`),
nunca con las tablas. Si el volumen o una exigencia regulatoria lo justifican, se cambia la
implementación sin tocar liquidaciones, cobranzas ni pagos. Es la misma forma que `almacenamiento.js`.

### 3.3 Uso del fondo: la mecánica de aprobación

Un uso del fondo NO es un asiento que emite el sistema solo: es una decisión del consorcio.

```
SolicitudUsoFondo:  PROPUESTA → APROBADA → APLICADA
                                   ↘ RECHAZADA
```

- La **propone** el org_admin, indicando gasto extraordinario destino, monto y respaldo (acta).
- La **aprueba** quien corresponde: CCyC art. 2051/2058 pone la autorización del fondo en el
  **consejo de propietarios** (PRD-06-04 §7.1 c). El rol `consejo` existe en el set de roles pero
  todavía no tiene modelo → hasta que exista, aprueba el org_admin y queda registrado quién.
- Al **aplicarse** genera el asiento (FONDO_RESERVA ↔ egreso/caja) y el gasto financiado deja de
  repartirse entre las UFs en la liquidación del período: esa es la parte que toca el motor.
- **Validación dura:** no se puede aprobar un uso mayor al saldo del fondo a esa fecha.

---

## 4. Alcance propuesto

| Tarea | Qué incluye | Depende de | Tamaño |
|---|---|---|---|
| **S3-21 (recortada)** — Fondo de reserva en la liquidación | Capa A completa: `ReglaFondoReserva` con vigencia, resolución de la regla del período, ítem por UF en liquidación y recibo, snapshot, UI de configuración del edificio, E2E y la invariante de reconciliación | S3-04 (hecho) | ~1 slice de sprint |
| **S5-nn** — Ledger de doble partida del edificio | Capa B: plan de cuentas, asientos, `services/ledger.js`, saldo a fecha, RLS, y el asiento de la liquidación aprobada | S3-21 | Grande |
| **S5-nn+1** — Uso del fondo con aprobación | `SolicitudUsoFondo`, workflow, validación contra saldo, efecto en el motor | Ledger | Medio |
| **S6-nn** — Cuenta corriente de proveedores y pagos | CxP por proveedor, registro de factura, pago, extracto | Ledger | Grande |

**Lo que se decide al recortar S3-21:** el fondo se **acumula** desde el día uno (cada liquidación
aprobada aporta), pero hasta que exista el ledger el saldo es una **suma de aportes** y no una
cuenta con débitos. No se puede usar el fondo todavía, y la UI debe decirlo así en vez de mostrar
un saldo que promete una operación inexistente.

---

## 5. Fuentes

- [Formance Ledger (MIT, Postgres, k8s operator para producción)](https://github.com/formancehq/ledger)
- [Blnk (Apache-2.0, Postgres + Redis, self-host con compose)](https://github.com/blnkfinance/blnk)
- [TigerBeetle (Apache-2.0, base de datos financiera dedicada)](https://github.com/tigerbeetle/tigerbeetle)
- [Midaz (Elastic License 2.0 — source-available)](https://github.com/LerianStudio/midaz)
- CCyC arts. 2046 inc. d (contribuir al fondo), 2051/2058 y PRD-06-04 §4.1 / §7.1
- `docs/investigacion/ordinarias-extraordinarias-y-categorias.md` — brecha 4, que este documento cierra
