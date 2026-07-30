# Esquemas de reparto: configuración de liquidación por edificio

**Fecha:** 2026-07-29 · **Contexto:** diseño previo a S3-09, después del research
`ordinarias-extraordinarias-y-categorias.md`
**Propuesta original (usuario):** que cada edificio tenga un setup de su lógica de liquidación y
que cada gasto pueda adoptarla o personalizarla.

## Veredicto

**Sí, y con un cambio que la hace más simple de lo planteado.** El "setup por edificio" no debería
ser *lógica* configurable (condiciones, fórmulas, un mini-DSL): eso rompe el requisito de motor
determinístico y auditable, y es imposible de testear exhaustivamente. Lo que el dominio necesita
es **una primitiva única y cerrada: pesos por unidad funcional.**

```
Hoy:    categoría A/B/C  →  ¿alcanzada? sí/no  →  coeficiente renormalizado
Diseño: esquema de reparto  →  peso por UF (Decimal)  →  monto_i = monto × peso_i / Σpesos
```

Con esa sola primitiva:

| Escenario real | Se expresa como |
|---|---|
| Gasto general | peso = coeficiente de cada UF |
| Servicio que no llega a todas (ascensor, PB exenta) | peso = coeficiente, 0 en las exentas |
| **Exención parcial** ("PB abona el 50% del ascensor") | peso = coeficiente × 0,5 en PB |
| **Sector con su propia tabla de coeficientes** ("coeficiente Torre A" del reglamento) | peso = el coeficiente propio del sector, no el general renormalizado |
| **Reparto por partes iguales** (por UF, no por coeficiente) | peso = 1 en las alcanzadas |
| **Cargo particular a una sola UF** (rotura, gasto individual) | peso = 1 en esa UF, 0 en el resto |
| Cocheras/bauleras que tributan distinto | peso propio por tipo de UF |
| Bonificación a una UF (encargado que vive en el edificio) | peso = 0 en esa UF |

Ocho escenarios reales, una sola primitiva y un solo camino de código. **Cuatro de esos ocho hoy
no se pueden expresar.**

## El punto conceptual que ordena todo

Hoy la categoría A/B/C hace **dos trabajos a la vez** y por eso el modelo se queda corto:

1. **Clasificar** el gasto (para el recibo, el dashboard y la Ley 941). Esto se queda.
2. **Calcular** el reparto. Esto pasa al esquema.

Separarlos es lo que abre la escalabilidad: la clasificación es un enum chico y estable (lo pide
la ley), y el cálculo es una tabla de pesos que cada edificio configura según **su reglamento de
copropiedad** — que es, textualmente, la fuente de autoridad (CCyC art. 2049: la exención sale del
reglamento, no del criterio del administrador).

### Un hallazgo de corrección, no solo de expresividad

El motor actual, para un gasto B o C, **renormaliza el coeficiente general** entre las UF
alcanzadas. Eso es *una* interpretación posible del reglamento, y no siempre la correcta: muchos
reglamentos fijan una **segunda tabla de coeficientes** para el servicio o el sector (el
"coeficiente de ascensor", el "coeficiente de Torre A"), que **no** es proporcional al coeficiente
general. Cuando difieren, hoy emitimos importes distintos de los que manda el reglamento — sin
ninguna señal. El esquema de reparto lo resuelve y, mientras no exista, la preview de S3-09
debería **mostrar el peso aplicado por UF** para que el administrador lo vea antes de aprobar.

## Modelo propuesto

```prisma
model EsquemaReparto {
  id              String
  organizacionId  String
  edificioId      String        // el reglamento es de un edificio
  gastoId         String?       // si está seteado, es un esquema ad-hoc de ESE gasto
  nombre          String        // "Ascensor (PB al 50%)", "Torre A", "Partes iguales"
  base            BaseReparto   // COEFICIENTE | PARTES_IGUALES | PESOS_PROPIOS
  alcance         AlcanceReparto// TODAS | SERVICIO | SECTOR | SELECCION
  alcanceValor    String?       // "ascensor" | "torre_a" | null
  // Trazabilidad legal (brecha 3 del research):
  clausulaReglamento String?    // "art. 12 del reglamento de copropiedad"
  documentoUrl    String?
  activo          Boolean
  pesos           EsquemaRepartoUnidad[]
}

model EsquemaRepartoUnidad {   // solo cuando hacen falta pesos explícitos
  esquemaId   String
  unidadId    String
  peso        Decimal @db.Decimal(12, 6)  // 0 = exenta · 0.5 = mitad · o el coeficiente propio
  @@id([esquemaId, unidadId])
}

model ConfiguracionLiquidacion {  // el "setup" del edificio
  edificioId              String  @unique
  esquemaGeneralId        String? // default para categoría A
  fondoReservaPorcentaje  Decimal?
  // …lo que S5 agregue (día de vencimiento, interés por mora)
}

// Gasto:
  esquemaRepartoId String?  // null = se resuelve del edificio por categoría/servicio/sector
```

**Resolución (una sola función, determinística):**

```
pesosDe(gasto, unidades) →
  1. si gasto.esquemaRepartoId → ese esquema (adopta o personaliza: es la variante del usuario)
  2. si no → el esquema del edificio que matchea (categoría → servicio/sector → general)
  3. si no hay ninguno → comportamiento actual (coeficiente, renormalizado en B/C)
→ Map<unidadId, Decimal>   →   distribuir(monto, pesos)
```

El paso 3 es lo que hace el cambio **retrocompatible**: sin ningún esquema configurado, el sistema
calcula exactamente lo que calcula hoy, y los tests de S3-03 siguen pasando sin tocarse.

**Inmutabilidad (no negociable):** el `LiquidacionDetalle` ya guarda `coeficienteAplicado`. Ahí
queda el **peso normalizado efectivamente usado**, más el nombre del esquema. Cambiar un esquema o
vender una UF **no puede** alterar un recibo ya emitido; el snapshot es la única defensa.

## Lo que este diseño NO resuelve (y necesita su propia pieza)

| Escenario | Por qué no entra en los pesos |
|---|---|
| **Extraordinaria en N cuotas** | Es un eje temporal, no de reparto: define en qué períodos se imputa y cuánto. Modelo aparte (`PlanCuotas` + imputación por período). **Es la brecha bloqueante de S3-09** |
| **Fondo de reserva** | Es un ítem que se **agrega** a la expensa (% de la ordinaria) y una **fuente de fondos** para extraordinarias. Toca el total, no el reparto |
| **Reparto por consumo/medidor** (agua, gas individual) | Necesita un dato de entrada por UF **por período**, que hoy no se carga en ningún lado |
| **Subconsorcios** (el schema ya tiene el tipo) | Reparto en dos niveles: primero entre subconsorcios, después dentro de cada uno |

## Impacto en scope

| Fase | Qué incluye | Tamaño | ¿Bloquea S3-09? |
|---|---|---|---|
| **0 — El seam** | Refactor interno del motor a `distribuir(monto, pesos)`, derivando los pesos de A/B/C como hoy. **Cero cambio funcional.** + la preview muestra el peso/porcentaje aplicado por UF | 1 tarea chica (backend + tests) | No: lo habilita |
| **1 — Cuotas** | `PlanCuotas` + imputación por período + selección de gastos del motor + UI en el form de gasto | 1–2 tareas (schema + migración + motor + UI + tests) | **Sí, si queremos liquidar obras reales** |
| **2 — Esquemas de reparto** | Los 2 modelos + config del edificio + resolución + CRUD/endpoints + UI (tab de configuración del edificio y selector en el gasto) + seed + E2E | 3–4 tareas — es un lote propio | No, pero sin esto no se factura a un consorcio con coeficientes por sector |
| **3 — Fondo de reserva** | Ítem en la liquidación + uso para extraordinarias | 1–2 tareas | No |
| **4 — Consumo / subconsorcios** | Fuera de S3 | — | No |

**Efecto sobre el sprint:** S3 tiene hoy 17 tareas (10 done). Las fases 0 a 3 suman **6 a 9 tareas
nuevas**. Meterlas todas antes de S3-09 duplica lo que falta del sprint y corre el DoD
("cargar → liquidar → aprobar → PDF con QR") varias sesiones.

## Recomendación

**Fase 0 + Fase 1 ahora; Fase 2 como lote propio inmediatamente después de que la liquidación
camine end-to-end; Fase 3 decidida por escrito.**

Razones:

- **La fase 0 es barata y es la que protege el diseño.** Si S3-09 se escribe sobre
  `unidadAlcanzada()` en vez de sobre pesos, después hay que reescribir el motor **y** migrar
  liquidaciones ya emitidas. Hacerla ahora cuesta un refactor sin cambio de comportamiento.
- **La fase 1 (cuotas) es bloqueante de verdad**: define qué gastos toma el motor para un período.
  Es la única brecha que, si aparece después, obliga a rehacer la selección de gastos.
- **La fase 2 puede esperar** sin riesgo de rediseño, porque el paso 3 de la resolución deja el
  comportamiento actual como default y todo lo nuevo es aditivo. Lo que **no** puede esperar es la
  señal: la preview tiene que mostrar el peso aplicado por UF (va en la fase 0), o vamos a emitir
  importes silenciosamente distintos del reglamento en los edificios con coeficientes por sector.

## Riesgos de la propuesta si se hace mal

1. **Convertirlo en un motor de reglas configurable** (condiciones, fórmulas, scripting). Rompe la
   auditabilidad, es intesteable y ningún administrador lo va a usar. La primitiva tiene que ser
   una tabla de pesos y un enum de bases cerrado.
2. **No guardar el snapshot** de los pesos aplicados: un recibo emitido tiene que ser inmutable
   frente a cambios de reglamento o de titularidad.
3. **UI de configuración sin defaults**: si crear un edificio obliga a configurar esquemas antes de
   poder liquidar, el onboarding se muere. El default ("todas por coeficiente") tiene que salir
   solo, y los esquemas ser la excepción que se agrega cuando el reglamento lo pide.
