---
title: "PRD-06-01: Ley 941 CABA"
description: "Requisitos legales, obligaciones del administrador, recibos de expensas y plataforma web oficial según la Ley 941 de CABA y sus modificatorias."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [compliance, legal, ley-941, caba, expensas, recibos, qr, rpa, consorcIA]
outcomes:
  - "Comprender los 20+ requisitos que la Ley 941 impone a los administradores"
  - "Diseñar recibos de expensas que cumplan todos los requisitos formales"
  - "Implementar separación ordinarias/extraordinarias en el motor contable"
  - "Integrar matrícula RPA, QR y plataforma web oficial en los flujos"
  - "Establecer controles automáticos de compliance en cada liquidación"
---

# PRD-06-01: Ley 941 CABA

> **La Ley 941 es el marco regulatorio principal para administradores de consorcios en CABA.** ConsorcIA debe cumplir cada requisito de forma automática e inmutable. Un error en un recibo puede invalidar un cobro judicial.

---

## 1. Marco Normativo

### 1.1 Leyes aplicables

| Ley | Año | Contenido principal |
|-----|-----|---------------------|
| **Ley 941** | 1999 | Registro Público de Administradores (RPA), obligaciones del admin |
| **Ley 3254** | 2009 | Ampliación de obligaciones, requisitos RPA más estrictos |
| **Ley 3291** | 2010 | Modificaciones menores a procedimientos |
| **Ley 5932** | 2018 | Plataforma web oficial obligatoria (art. 23) |
| **Ley 5983** | 2018 | Refuerzo de transparencia, comprobantes digitales |

### 1.2 Ámbito de aplicación

- **Aplica a:** Todo administrador de consorcio de propiedad horizontal en CABA que perciba honorarios — sea persona humana o persona jurídica matriculada. En ConsorcIA, el administrador matriculado es atributo de la **organización** (administración/estudio), no del edificio.
- **No aplica a:** Administradores ad honorem (salvo que administren a título oneroso en otro consorcio).
- **Jurisdicción:** CABA. Para PBA ver [[PRD-06-02 Ley 14.701 PBA]] (la Ley 14.701 contempla la persona jurídica administradora con Responsable Técnico).

---

## 2. Requisitos del RPA (Registro Público de Administradores)

### 2.1 Inscripción obligatoria

El administrador debe estar inscripto en el RPA con:

| Requisito | Documentación | Validez |
|-----------|---------------|---------|
| Domicilio en CABA | Constancia | Permanente |
| Seguro de caución | Póliza vigente | Anual |
| Seguro de RC | Póliza vigente | Anual |
| Capacitación inicial | 120 horas | Única |
| Capacitación anual | 10 horas/año | Anual |
| Antecedentes penales | Certificado vigente | Anual |
| Inscripción AFIP | Constancia CUIT | Permanente |

> **En ConsorcIA, todos estos atributos (matrícula RPA, CUIT, seguros de caución y RC, capacitaciones) pertenecen al administrador responsable de la organización** — la persona humana o jurídica matriculada que es cliente del SaaS — y **no al edificio**. Cada recibo, liquidación o documento oficial los resuelve por **herencia edificio → organización**: el edificio sabe a qué organización pertenece y toma de ella los datos del administrador matriculado.

### 2.2 Matrícula RPA en documentos

> **Art. 10, inc. l — La matrícula RPA debe figurar en:**
> - Todos los recibos de expensas
> - Toda correspondencia oficial del administrador
> - Las liquidaciones mensuales

**Implementación en ConsorcIA:**

```
RECIBO DE EXPENSAS
─────────────────────────────────
Consorcio: Edificio Rivadavia 1234
Matrícula Admin RPA: 12.345-A  ← OBLIGATORIO (heredado de la organización)
CUIT Admin: 20-12345678-9      ← heredado de la organización
Período: Julio 2026
─────────────────────────────────
```

> La matrícula RPA y el CUIT se leen desde la organización a la que pertenece el edificio (herencia edificio → organización). Si el administrador responsable de la organización cambia, todos los recibos de su cartera se actualizan automáticamente.

---

## 3. Requisitos de los Recibos de Expensas

### 3.1 Datos obligatorios (Art. 10, inc. l)

Cada recibo debe contener:

| Campo | Obligatorio | Implementación ConsorcIA |
|-------|-------------|--------------------------|
| Denominación y domicilio del consorcio | ✅ | Campo `edificio.nombre`, `edificio.domicilio` |
| Piso y departamento | ✅ | Campo `unidad.piso`, `unidad.depto` |
| Nombre y apellido del propietario | ✅ | Campo `propietario.nombre_completo` |
| Mes que se abona, período o concepto | ✅ | Campo `liquidacion.periodo` |
| Vencimiento con interés respectivo | ✅ | Calculado por motor contable |
| Datos del admin, firma, CUIT, matrícula RPA | ✅ | Heredados de la organización (`organizacion.administrador.*`) |
| Lugar y formas de pago | ✅ | Campo `recibo.formas_pago` |
| **Separación ordinarias/extraordinarias** | ✅ | Campo `gasto.esOrdinario` → `totalOrdinarias` / `totalExtraordinarias` por liquidación y por UF |
| **Código QR** | ✅ (Ley 5983) | **Generado automáticamente** |

### 3.2 Separación ordinarias vs extraordinarias

> **Corrección (2026-07-29, research previo a S3-09):** la separación ordinarias/extraordinarias
> **no** la produce la categoría A/B/C. Son **dos ejes independientes**: A/B/C decide **quiénes**
> pagan el gasto (base legal: CCyC art. 2049, último párrafo — el reglamento puede eximir
> parcialmente a las UF sin acceso al servicio o sector), y `esOrdinario` decide **en qué subtotal
> cae** (Ley 941 art. 10: "separadas y diferenciadas"), **quién lo absorbe** entre propietario e
> inquilino y **qué respaldo de asamblea** necesita (CCyC arts. 2051/2052). Cualquiera de las 6
> combinaciones es válida: una extraordinaria puede ser de categoría C.
>
> El mockup de abajo dibuja "Pintura fachada (cuota 3/6)": **el modelo de datos todavía no
> soporta cuotas**. Es la brecha 1 del research, y hay que resolverla o declararla fuera de
> alcance antes de S3-09. Detalle completo, brechas y fuentes:
> `app/docs/investigacion/ordinarias-extraordinarias-y-categorias.md`.

```
┌─────────────────────────────────────────────────────────────┐
│  RECIBO DE EXPENSAS — JULIO 2026                             │
├─────────────────────────────────────────────────────────────┤
│  EXPENSAS ORDINARIAS                                          │
│  ├── Sueldos y cargas sociales        $ 450.000              │
│  ├── Seguros (incendio, RC)           $ 120.000              │
│  ├── ABL / Tasa municipal           $  85.000              │
│  ├── Suministros (luz, gas, agua)   $ 230.000              │
│  ├── Mantenimiento general          $ 180.000              │
│  └── Honorarios administrador       $ 150.000              │
│  SUBTOTAL ORDINARIAS                  $1.215.000            │
├─────────────────────────────────────────────────────────────┤
│  EXPENSAS EXTRAORDINARIAS                                     │
│  ├── Reparación ascensor            $ 320.000              │
│  └── Pintura fachada (cuota 3/6)    $ 180.000              │
│  SUBTOTAL EXTRAORDINARIAS             $ 500.000            │
├─────────────────────────────────────────────────────────────┤
│  TOTAL A PAGAR                        $1.715.000            │
│  Coeficiente UF: 3.45% → Monto UF:    $  59.168            │
└─────────────────────────────────────────────────────────────┘
```

**Validación automática:** El motor contable verifica que:
1. Cada gasto tenga categoría A/B/C asignada
2. La suma de ordinarias + extraordinarias = total
3. La distribución por coeficientes sea exacta (suma = 100%)

### 3.3 Código QR (Ley 5983 / Disposición 2024)

> **Desde agosto 2024, los recibos deben incluir un código QR o enlace web** hacia una carpeta con los comprobantes de gastos escaneados.

**Formato del QR en ConsorcIA:**

```
https://consorcia.app/r/ABC123DEF456
  ↓ (redirecciona a)
https://storage.consorcia.app/edificios/123/
  liquidaciones/2026-07/comprobantes/
```

**Contenido del enlace:**
- Fotos/facturas de cada gasto del mes
- Resumen bancario del mes anterior
- Estado de juicios (si existen)
- Link a AFIP para verificar aportes del encargado

**Generación:** El Agente Contable genera el QR automáticamente al cerrar la liquidación.

---

## 4. Rendición de Cuentas Mensual

### 4.1 Contenido obligatorio (Art. 10)

La liquidación mensual debe incluir:

1. **Remuneraciones al personal** — detalle de sueldos, cargas sociales, ART
2. **Pagos por suministros, servicios, abonos y seguros** — con comprobantes
3. **Estado financiero** — ingresos vs egresos del mes
4. **Resumen de movimientos bancarios** — mes anterior
5. **Estado patrimonial** — fondo de reserva, inversiones
6. **Datos de juicios** — número de juzgado, expediente, carátula, objeto, estado, capital reclamado
7. **Recibo de pago** — del administrador por sus honorarios (CUIT, matrícula, situación fiscal, importe)
8. **Link a comprobantes** — QR o enlace web
9. **Link a AFIP** — para verificar aportes del encargado
10. **Texto visible** — sitio web oficial y teléfono de contacto para quejas

### 4.2 Libros obligatorios (Art. 2067 CCyC)

| Libro | Formato | Digitalización |
|-------|---------|----------------|
| Libro de actas | Escritura pública | PDF firmado digitalmente |
| Libro de administración | Contable | ConsorcIA (automático) |
| Libro de registro de propietarios | Nominal | ConsorcIA (automático) |
| Libro de registros de firmas | Firmas | ConsorcIA (carga manual) |

---

## 5. Plataforma Web Oficial (Ley 5983, Art. 23)

### 5.1 Requisitos de la plataforma

> **El administrador debe dar de alta al consorcio en la plataforma web oficial de CABA y mantenerla actualizada.**

**Datos a publicar:**
- Nombre y domicilio del consorcio
- Matrícula RPA del administrador (resuelta desde la organización)
- Nómina de propietarios (actualizada)
- Liquidaciones mensuales (histórico)
- Convocatorias a asambleas
- Actas de asambleas

### 5.2 Integración ConsorcIA → Plataforma Oficial

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   ConsorcIA     │────▶│  API / Scraping      │────▶│  CABA Oficial   │
│   (backend)     │     │  (automatización)    │     │  (buenosaires)  │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
        │
        ├──▶ Sincronización mensual de liquidaciones
        ├──▶ Alta automática de nuevos consorcios
        ├──▶ Actualización de nómina de propietarios
        └──▶ Publicación de actas de asamblea
```

> **Nota:** La plataforma oficial de CABA no tiene API pública documentada. La integración puede requerir scraping o carga manual asistida por el Agente Documental.

---

## 6. Requisitos de Contratación (Art. 11)

### 6.1 Presupuestos obligatorios

Todo presupuesto debe incluir:

| Requisito | Implementación |
|-----------|----------------|
| Título/matricula del prestador | Campo `proveedor.matricula` |
| Nombre, domicilio, CUIT, AFIP, ANSES | Campo `proveedor.*` |
| Descripción detallada de precios, materiales, mano de obra | Campo `presupuesto.detalle` |
| Plazo de ejecución | Campo `presupuesto.plazo` |
| Garantía (alcance y duración) | Campo `presupuesto.garantia` |
| Plazo de aceptación con precio fijo | Campo `presupuesto.validez` |
| Seguros de riesgos del trabajo y RC | Campo `proveedor.seguros` |

### 6.2 Archivo de comprobantes

> **El administrador debe guardar copia de comprobantes por 2 años mínimo.**

**En ConsorcIA:**
- Todos los comprobantes se almacenan en MinIO/S3
- Retención automática de 5 años (supera el mínimo legal)
- Indexación por fecha, proveedor, monto
- Búsqueda full-text via OCR

---

## 7. Notificaciones y Plazos

### 7.1 Plazos críticos

| Evento | Plazo | Implementación |
|--------|-------|----------------|
| Notificar reclamos/sanciones/juicios | 48 horas | Alerta automática del Agente Comunicador |
| Rendir cuentas documentadas | 60 días post-cierre | Recordatorio automático día 45 |
| Entregar libros/docs al cesar | 15 días hábiles | Checklist de offboarding |
| Expedir certificado de deuda | 3 días hábiles | Generación automática en portal |
| Renovar matrícula RPA | Anual | Alerta 30 días antes, a nivel organización (una sola alerta para toda la cartera, no por edificio) |

### 7.2 Certificado de deuda (Art. 2048 CCyC)

> **El certificado de deuda expedido por el administrador es TÍTULO EJECUTIVO.**

**Requisitos del certificado:**
- Deudas y créditos por todo concepto
- Constancia de reclamos administrativos o judiciales
- Información sobre seguros vigentes
- Firmado por administrador (con matrícula RPA)

**En ConsorcIA:** Generación automática desde el portal, con firma digital.

---

## 8. Decisiones de Diseño

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Motor contable** | 100% determinístico | Ley 941 exige precisión matemática. Swarm NUNCA calcula expensas. |
| **Recibos** | PDF generado por template validado | Template revisado por abogado. Swarm solo llena variables. |
| **QR** | Generado por librería `qrcode` (NodeJS) | Determinístico, auditado, sin dependencia de servicios externos. |
| **Separación ord/ext** | Hard-coded en motor contable | No configurable por usuario. Categoría A=ordinaria, B/C=según reglamento. |
| **Plataforma oficial** | Sincronización manual asistida (MVP) | Sin API pública. Fase 2: scraping automatizado. |
| **Retención comprobantes** | 5 años en S3 (vs 2 mínimo legal) | Margen de seguridad para auditorías. |

---

## 9. Checklist de Compliance

### Por cada liquidación generada:

- [ ] Recibo numerado correlativo
- [ ] Matrícula RPA del admin visible
- [ ] CUIT del admin incluido
- [ ] Separación clara ordinarias/extraordinarias
- [ ] Código QR válido y funcional
- [ ] Link a comprobantes accesible
- [ ] Resumen bancario del mes anterior
- [ ] Datos de seguros (compañía, póliza, vencimiento)
- [ ] Enlace a AFIP para aportes del encargado
- [ ] Texto de contacto para quejas visible
- [ ] Suma de coeficientes = 100%
- [ ] Suma de montos distribuidos = monto total (al centavo)

---

## 10. Glosario

| Término | Definición |
|---------|------------|
| **RPA** | Registro Público de Administradores (CABA) |
| **Matrícula RPA** | Número de inscripción del admin (ej: 12.345-A). Atributo de la organización, heredado por sus edificios |
| **Ordinarias** | Gastos regulares mensuales de administración |
| **Extraordinarias** | Gastos no recurrentes (reparaciones, mejoras) |
| **Certificado de deuda** | Documento con fuerza ejecutiva para cobro judicial |
| **Fondo de reserva** | Ahorro del consorcio para gastos imprevistos |

---

*Documento relacionado:* [[PRD-06-02 Ley 14.701 PBA]]  
*Documento relacionado:* [[PRD-06-04 Código Civil y Comercial]]  
*Documento relacionado:* [[PRD-02-05 Motor Contable]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]
