# Ordinarias / extraordinarias × categorías A/B/C: cómo se imputan y quién paga

**Fecha:** 2026-07-29 · **Contexto:** antes de implementar S3-09 (generar liquidación + preview)
**Pregunta:** ¿cómo se cruzan los dos ejes con los que ConsorcIA clasifica un gasto —
`esOrdinario` (ordinario/extraordinario) y `categoria` (A/B/C)—, cómo se imputan y quién
debería pagar cada combinación?

## Resumen ejecutivo

1. **Son dos ejes independientes, y está bien que lo sean.** La categoría A/B/C decide
   **quiénes** pagan el gasto; ordinaria/extraordinaria decide **en qué subtotal cae**, **quién
   lo absorbe** entre propietario e inquilino y **qué respaldo** necesita (asamblea). Una
   extraordinaria puede ser perfectamente de categoría C: "impermeabilizar la terraza de la
   torre A" la pagan solo las UF de esa torre, en cuotas, con acta de asamblea. La matriz 3×2
   es real y nuestro modelo la soporta.
2. **La implementación actual es correcta en lo que hace**, pero le faltan cuatro piezas para
   liquidar con certeza: **cuotas** de una extraordinaria, **exención parcial** (porcentaje) en
   lugar de binaria, **respaldo documental** (reglamento / acta de asamblea) y **fondo de
   reserva**.
3. **Hay un error conceptual en PRD-06-01** (§3.1): dice que la separación
   ordinarias/extraordinarias la resuelve el "motor contable A/B/C". No: A/B/C no separa
   ordinarias de extraordinarias — son ejes distintos. Corregido en la misma tarea.

## 1. El marco legal, eje por eje

### Eje 1 — Naturaleza del gasto: ordinaria vs extraordinaria

| Qué | Fundamento | Consecuencia para el producto |
|---|---|---|
| **Deben mostrarse "en forma separada y diferenciada"** en la liquidación | Ley 941 CABA, art. 10 (Modelo Único de Liquidación de Expensas, Disp. 856-DGDYPC/14 y 1492/2014) | Ya lo hacemos: `totalOrdinarias` / `totalExtraordinarias` por liquidación y por UF |
| **Ordinaria** = gasto corriente y previsible de conservación y funcionamiento (sueldos, limpieza, ascensor, luz común, arreglos menores). **Extraordinaria** = gasto no habitual, de fondo, que renueva o mejora (motor de ascensor, impermeabilización, fachada) | Criterio consolidado de la práctica; CCyC arts. 2046 inc. c y 2048 | El criterio es de **naturaleza del gasto**, no del monto. La clasificación la hace el administrador; la IA podrá sugerirla (Fase 2), nunca decidirla |
| Las **simples reparaciones de conservación** las decide el administrador; las **mejoras u obra nueva** necesitan **mayoría** de propietarios en asamblea, con informe técnico previo; si modifican la estructura de manera sustancial, **unanimidad** | CCyC arts. 2051 y 2052 | Una extraordinaria casi siempre tiene un **acta de asamblea** detrás. Hoy no la referenciamos desde el gasto |
| **Frente al consorcio, el deudor es siempre el propietario.** No puede liberarse por no usar el servicio, por renuncia, por abandono ni por enajenación | CCyC art. 2049, primer párrafo | El recibo es de la **UF** y su deudor es el propietario. Correcto como está |
| **Entre propietario e inquilino:** la práctica es ordinarias al inquilino, extraordinarias al propietario. La Ley 27.551 lo decía expresamente (art. 1209 CCyC reformado), **pero el DNU 70/2023 la derogó**: hoy rige libertad de pacto y lo que diga el contrato | Ley 27.551 (derogada) · DNU 70/2023 · CCyC art. 1209 | **Esta es la razón de fondo por la que la separación importa**, más allá del requisito formal: es lo que le permite al propietario trasladar solo las ordinarias. Impacta el portal del residente (S5): un inquilino no debería ver una extraordinaria como deuda propia |

### Eje 2 — Alcance del gasto: categorías A / B / C

| Qué | Fundamento | Consecuencia para el producto |
|---|---|---|
| Por regla general **todas las UF pagan según su coeficiente**, y nadie se exime por no usar un servicio | CCyC art. 2049, primer párrafo | Es nuestra categoría A |
| **Excepción:** "el reglamento de propiedad horizontal **puede eximir parcialmente** de las contribuciones por expensas a las unidades funcionales que **no tienen acceso a determinados servicios o sectores** del edificio que generan dichas erogaciones" | CCyC art. 2049, **último párrafo** | Es la base legal exacta de nuestras categorías **B** (servicio) y **C** (sector) |
| El reparto diferenciado **nace del reglamento de copropiedad**, no de la decisión del administrador. Los casos típicos: PB y locales sin ascensor, ascensores sectorizados por torre, cocheras que tributan distinto | CCyC art. 2049 · práctica de CABA | **Brecha:** hoy el administrador tilda B/C libremente, sin registro de la cláusula que lo habilita |
| La ley dice **"eximir parcialmente"**: el reglamento puede fijar un **porcentaje reducido** (p. ej. PB paga el 50% del ascensor), no solo exención total | CCyC art. 2049, último párrafo | **Brecha:** nuestro motor es binario — la UF está alcanzada o no lo está |

### El cruce de los dos ejes

No hay regla legal que ligue los ejes: **cualquiera de las 6 combinaciones es válida.**

| | Ordinaria | Extraordinaria |
|---|---|---|
| **A — general** | Sueldos, ABL, seguro, limpieza | Pintura de fachada, cambio de tanque |
| **B — servicio** | Abono mensual del ascensor (solo UF con acceso) | Cambio del motor del ascensor (solo esas UF) |
| **C — sector** | Mantenimiento de la pileta (solo UF del sector) | Reparación de la pileta (solo UF del sector) |

Lo que **sí** cambia con la combinación es el **respaldo** que se necesita: una extraordinaria B o
C es la más exigente de todas (acta de asamblea que aprueba la obra **más** cláusula del
reglamento que habilita el reparto restringido).

## 2. Qué hace ConsorcIA hoy

Leído del código, no de los PRDs:

- **`backend/src/core/liquidacion.engine.js`** — `calcularDistribucion(gasto, unidades)` usa
  **solo `categoria`** para decidir qué UF quedan alcanzadas (`unidadAlcanzada`), y renormaliza
  los coeficientes entre las alcanzadas en B y C. Si ninguna queda alcanzada, tira
  `DESBALANCE_LIQUIDACION` y **falla la liquidación entera** del período.
- **`esOrdinario` no participa del reparto**: solo decide a qué subtotal se suma
  (`totalOrdinarias` / `totalExtraordinarias`), tanto en la liquidación como por UF en el recibo
  (`backend/src/routes/liquidaciones.routes.js`).
- **No hay noción de propietario vs inquilino** en la liquidación: el `LiquidacionDetalle`
  apunta a la `Unidad`, no a una persona. Es lo correcto frente al consorcio (art. 2049).
- **No hay cuotas, ni fondo de reserva, ni respaldo documental** (acta, cláusula del reglamento).
- La UI ya refleja los dos ejes por separado: el tab de gastos muestra el total partido en
  ordinarios/extraordinarios **y** en A/B/C (S3-08b), sobre el mismo filtro, y los dos cortes
  reconcilian con el total.

**Conclusión:** el modelo de datos y el motor **no contradicen** la ley. Lo que falta es
expresividad, y falta justo en lo que S3-09 va a liquidar.

## 3. Brechas, por riesgo

| # | Brecha | Riesgo si liquidamos sin resolverla | Recomendación |
|---|---|---|---|
| 1 | ✅ **RESUELTA en S3-19** (issue #67). `GastoCuota` + `planDeCuotas` en el motor: el gasto sigue siendo la factura y las cuotas son las imputaciones por período. Contrato en PRD-04-02 §1.1.b. Era: *una extraordinaria no se puede dividir en cuotas — el gasto entra completo en un período, aunque el mockup de PRD-06-01 §3.2 dibuje "Pintura fachada (cuota 3/6)"* | Alto y frecuente: casi ninguna obra se cobra en un solo mes. Sin cuotas, el administrador va a cargar 6 gastos a mano con el mismo concepto, y el total anual del rubro va a quedar mal | Modelar el **plan de cuotas** (gasto padre + N imputaciones por período, o `cuotaActual/cuotaTotal` con monto imputado). **Decidir antes de S3-09**, porque cambia qué gastos toma el motor para un período |
| 2 | **La exención del art. 2049 es binaria, la ley la admite parcial** | Medio: un reglamento que diga "PB abona el 50% del ascensor" hoy no se puede representar. El workaround (cargar dos gastos) desvirtúa el importe del proveedor | Permitir un **porcentaje por UF o por grupo** en la categoría B/C. Se puede diferir a S4+ si el motor deja el seam (`coeficienteEfectivo` ya existe conceptualmente) |
| 3 | **Sin respaldo documental**: qué cláusula del reglamento habilita el reparto B/C, qué acta de asamblea aprobó la obra | Medio-legal: es lo primero que se discute cuando un propietario impugna. Además el QR de la Ley 941 tiene que llevar a la documentación del período | Campo opcional de **referencia** (cláusula / acta + link al PDF) en el gasto extraordinario y en el servicio/sector del edificio. Barato y evita un rediseño después |
| 4 | ✅ **RESUELTA en S3-21** (issue #69). `ReglaFondoReserva` versionada por período de vigencia + tercer subtotal en la liquidación y el recibo; el aporte se reparte como una categoría A (contribuir al fondo no admite exención, CCyC art. 2046 inc. d) o con el esquema que la regla indique. **Queda fuera el USO del fondo**: financiar una extraordinaria pide saldo, y eso es el ledger del edificio (`docs/decisiones/ADR-001-ledger-del-edificio.md`). Era: *fondo de reserva ausente, prometido en PRD-06-04 §4.1 y sin implementar en el motor* | Medio: es un ítem esperado de la expensa (5–10% de la ordinaria) y cambia el importe a cobrar | Definido por escrito y dentro de S3 |
| 5 | **Propietario vs inquilino sin modelar en la liquidación** | Bajo para el consorcio (el deudor es el propietario), alto para el **portal del residente** (S5): mostrarle a un inquilino una extraordinaria como deuda propia es un error de producto y una discusión legal | Dejar asentado que el recibo es de la UF y su deudor es el propietario, y que el portal del inquilino muestra **solo ordinarias** (o las extraordinarias claramente marcadas como "a cargo del propietario") |
| 6 | **Error conceptual en PRD-06-01 §3.1**: atribuye la separación ordinarias/extraordinarias al "motor contable A/B/C" | Bajo, pero es la clase de confusión que después se implementa | Corregido en esta tarea |

## 4. Recomendación para S3-09

Se puede construir el generador y la preview **ahora**, con dos condiciones:

1. ~~**Resolver la brecha 1 (cuotas) antes de escribir el motor de liquidación**~~ — **hecho en
   S3-19**, antes de S3-09: la selección de gastos del período ya es una selección de
   *imputaciones* (`imputacionDelPeriodo`), así que S3-09 se escribe sobre el modelo definitivo y
   no hay que rehacerla.
2. ~~**Decidir la brecha 4 (fondo de reserva)**~~ — **decidida y hecha en S3-21**: entró en S3 como
   capa A (regla versionada + tercer subtotal); el uso del fondo espera al ledger (ADR-001).

Las brechas 2, 3 y 5 son aditivas: no cambian lo que la liquidación de S3 calcula, y pueden
entrar como tareas nuevas sin rehacer nada.

## Fuentes

- [CCyC art. 2049 — Defensas / exención parcial por falta de acceso a servicios o sectores](https://ligadelconsorcista.org/legislacion/nuevo-codigo-civil-comercial-parte-pertinente)
- [CCyC Propiedad Horizontal (texto completo, SUTERH)](https://suterh.org.ar/ccc-propiedad-horizontal/)
- [CCyC art. 2051 — Mejora u obra nueva que requiere mayoría](https://www.conceptosjuridicos.com/ar/articulos/codigo-civil-y-comercial-articulo-2051/)
- [CCyC art. 2052 — Mejora u obra nueva que requiere unanimidad (comentado, Infojus)](https://universojus.com/ccc-comentado-infojus/interpretacion-art-2052)
- [Expensas y reparaciones: quién paga en el consorcio — Argentina 2026](https://www.muovi.com.ar/guias/expensas-y-reparaciones-quien-paga-consorcio)
- [Los inquilinos no deben pagar expensas extraordinarias (Los Andes, sobre el estado post-DNU)](https://www.losandes.com.ar/economia/ya-fue-la-ley-alquileres-los-inquilinos-no-deben-pagar-expensas-extraordinarias-aunque-aparezcan-el-resumen-n5993361)
- [Guía de contratos de alquiler 2025 — DNU 70/2023](https://misalquileres.com.ar/guia-contratos-alquiler)
- [Ley 941 CABA — texto actualizado](https://ligadelconsorcista.org/ley_941)
- [CABA — información que deben contener las liquidaciones de expensas](https://es.linkedin.com/pulse/caba-liquidaciones-de-expensas-informaci%C3%B3n-que-deben-cynthia-rosio)
- [Disposición 1146/DGDYPC/24 — QR / link a la documentación en el Modelo Único](https://boletinoficial.buenosaires.gob.ar/normativaba/norma/714586)
- [Disposición 2373/DGDYPC/24 — prórroga de la implementación del QR](https://caphai.com.ar/site/wp-content/uploads/2024/04/DI-2024-2373-GCABA-DGDYPC-Pr%C3%B3rroga-implementaci%C3%B3n-c%C3%B3digo-QR.pdf)
- [Cómo se calculan las expensas en CABA 2026 (coeficientes y categorías por reglamento)](https://www.ramosestudio.com.ar/blog/como-se-calculan-las-expensas-consorcio/)
- [Fondo de reserva en consorcios: qué es y cuánto](https://www.ramosestudio.com.ar/blog/fondo-reserva-consorcio/)

> **Nota sobre las fuentes:** la ley (CCyC, Ley 941, DNU 70/2023) es la fuente primaria; los
> artículos de administradores y estudios se usaron para la práctica de mercado y se citan como
> tal, no como norma. Nada de esto es asesoramiento legal: las brechas 1 a 5 deberían validarse
> con el abogado del proyecto antes de emitir expensas reales.
