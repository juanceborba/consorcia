---
title: "PRD-06-04: Código Civil y Comercial"
description: "Aplicación de los arts. 2037-2072 del CCyC a ConsorcIA: propiedad horizontal, consorcio como persona jurídica, obligaciones de propietarios y administradores, subconsorcios."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [compliance, legal, ccyc, propiedad-horizontal, consorcio, articulos-2037-2072, consorcIA]
outcomes:
  - "Comprender la estructura jurídica del consorcio según el CCyC"
  - "Implementar soporte para unidades funcionales y complementarias"
  - "Diseñar flujos de asamblea, consejo de propietarios y administrador"
  - "Soportar subconsorcios y sectores con independencia"
  - "Validar certificados de deuda como títulos ejecutivos"
---

# PRD-06-04: Código Civil y Comercial

> **El CCyC (arts. 2037-2072) establece el régimen de propiedad horizontal en Argentina.** Reconoce al consorcio como persona jurídica, define unidades funcionales y complementarias, y regula órganos, obligaciones y certificados de deuda. ConsorcIA debe reflejar fielmente este marco.

---

## 1. Estructura del Título V (Arts. 2037-2072)

```
TÍTULO V — PROPIEDAD HORIZONTAL (Arts. 2037-2072)
│
├── Capítulo 1: Disposiciones Generales (2037-2042)
│   ├── 2037: Concepto de propiedad horizontal
│   ├── 2038: Constitución (reglamento de PH)
│   ├── 2039: Unidad funcional
│   ├── 2040: Cosas y partes comunes
│   ├── 2041: Cosas y partes NECESARIAMENTE comunes
│   └── 2042: Cosas y partes comunes NO indispensables
│
├── Capítulo 2: Consorcio (2043-2050)
│   ├── 2043: Cosas y partes propias
│   ├── 2044: Consorcio como persona jurídica
│   ├── 2045: Facultades del propietario
│   ├── 2046: Obligaciones del propietario
│   ├── 2047: Prohibiciones
│   ├── 2048: Gastos y contribuciones (certificado de deuda)
│   ├── 2049: Defensas
│   └── 2050: Obligados al pago de expensas
│
├── Capítulo 3: Reglamento de PH (2056-2057)
│   ├── 2056: Contenido del reglamento
│   └── 2057: Modificación (mayoría 2/3)
│
├── Capítulo 4: Asambleas (2058-2063)
│   ├── 2058: Facultades
│   ├── 2059: Convocatoria y quórum
│   ├── 2060: Mayoría absoluta
│   └── 2063: Asamblea judicial
│
├── Capítulo 5: Consejo de Propietarios (2064)
│
├── Capítulo 6: Administrador (2065-2067)
│   ├── 2065: Representación legal
│   ├── 2066: Designación y remoción
│   └── 2067: Derechos y obligaciones
│
├── Capítulo 7: Subconsorcios (2068)
│
└── Capítulo 8: Infracciones (2069)
```

---

## 2. Unidades Funcionales y Complementarias

### 2.1 Unidad funcional (Art. 2039)

> **"El derecho de propiedad horizontal se determina en la unidad funcional, que consiste en pisos, departamentos, locales u otros espacios susceptibles de aprovechamiento por su naturaleza o destino, que tengan independencia funcional, y comunicación con la vía pública, directamente o por un pasaje común."**

**Propiedad de la UF comprende:**
- Parte indivisa del terreno
- Cosas y partes de uso común indispensables para seguridad
- Una o más unidades complementarias

### 2.2 Tipologías soportadas por ConsorcIA

| Tipología | Código | UF | Complementaria | Ejemplo |
|-----------|--------|----|---------------|---------|
| Departamento | DEPTO | ✅ | Opcional | 3° "A" |
| Local comercial | LOCAL | ✅ | Opcional | Local PB |
| Oficina | OFIC | ✅ | Opcional | Oficina 5° |
| Cochera cubierta | COCH-C | ❌ | ✅ | Cochera 1 |
| Cochera semicubierta | COCH-S | ❌ | ✅ | Cochera 2 |
| Cochera descubierta | COCH-D | ❌ | ✅ | Cochera 3 |
| Baulera | BAUL | ❌ | ✅ | Baulera 1 |
| Unidad de encargado | ENC | ✅ | No | Vivienda encargado |
| Amenities exclusivos | AMEN | ❌ | ✅ | Terraza privada |

### 2.3 Coeficiente de propiedad horizontal

> **Fijado en el reglamento, invariable salvo modificación por escritura pública con mayoría de 2/3.**

**Componentes del coeficiente:**
- Metros cuadrados de la UF
- Ubicación (piso, frente vs. contrafrente)
- Servicios incluidos (ascensor, terraza, amenities)
- Uso (residencial vs. comercial)

**Validación en ConsorcIA:**
```javascript
// Motor contable: validar que suma de coeficientes = 1 (100%)
const sumaCoeficientes = unidades.reduce(
  (sum, u) => sum.plus(new Decimal(u.coeficiente)),
  new Decimal(0)
);

if (!sumaCoeficientes.equals(1)) {
  throw new Error(`Suma de coeficientes inválida: ${sumaCoeficientes}`);
}
```

---

## 3. Consorcio como Persona Jurídica (Art. 2044)

### 3.1 Características

> **"El conjunto de los propietarios de las unidades funcionales constituye la persona jurídica consorcio. Tiene su domicilio en el inmueble."**

**Órganos del consorcio:**
1. **Asamblea** — máximo órgano deliberativo
2. **Consejo de Propietarios** — órgano de fiscalización (optativo)
3. **Administrador** — representante legal (mandatario)

### 3.2 Representación legal (Art. 2065)

> **"El administrador es representante legal del consorcio con el carácter de mandatario. Puede serlo un propietario o un tercero, persona humana o jurídica."**

**En ConsorcIA:**
- El admin actúa en nombre del consorcio
- Las comunicaciones del sistema se emiten "a nombre del consorcio"
- El admin firma digitalmente en representación del consorcio

---

## 4. Obligaciones del Propietario (Art. 2046)

### 4.1 Enumeración legal

| Obligación | Implementación ConsorcIA |
|------------|--------------------------|
| a) Cumplir el reglamento de PH | Validación de reglas en onboarding |
| b) Conservar en buen estado su UF | Kanban: solicitudes de reparación |
| c) Pagar expensas ordinarias y extraordinarias | Motor contable + cobranzas |
| d) Contribuir al fondo de reserva | Cálculo automático en liquidación |
| e) Permitir acceso para reparaciones | Notificación programada |
| f) Notificar domicilio especial | Campo `propietario.domicilio_especial` |

### 4.2 Certificado de deuda = Título Ejecutivo (Art. 2048)

> **"El certificado de deuda expedido por el administrador y aprobado por el consejo de propietarios, si éste existe, es título ejecutivo para el cobro a los propietarios de las expensas y demás contribuciones."**

**Requisitos del certificado:**
- Deudas y créditos por todo concepto
- Constancia de reclamos administrativos o judiciales
- Información sobre seguros vigentes
- Firmado por administrador (con matrícula)

**En ConsorcIA:**
```
CERTIFICADO DE DEUDA — Edificio Rivadavia 1234
UF: 3° "A" — Propietario: Juan Pérez

DEUDAS:
├── Expensas Julio 2026:           $  59.168 (vencida)
├── Expensas Junio 2026:           $  59.168 (vencida)
├── Intereses moratorios:          $   5.917
└── TOTAL ADEUDADO:                $ 124.253

RECLAMOS PENDIENTES: Ninguno
SEGUROS VIGENTES: Sí (póliza 12345, vence 31/12/2026)

Administrador: María González
Matrícula RPA: 12.345-A
Fecha: 26/07/2026

[FIRMA DIGITAL]
```

---

## 5. Obligados al Pago de Expensas (Art. 2050)

### 5.1 Regla general

> **"Además del propietario, y sin implicar liberación de éste, están obligados al pago de los gastos y contribuciones de la propiedad horizontal los que sean poseedores por cualquier título."**

**Obligados directos:**
1. **Propietario** — obligación principal
2. **Usufructuario** — poseedor por título legal
3. **Titular de derecho real de uso/habitación** — poseedor por título legal

**NO obligados directos (pero pueden serlo por contrato):**
- Locatarios (inquilinos) — no son poseedores en el sentido del CCyC
- PERO: el contrato de locación puede establecer que pague expensas

### 5.2 Implementación en ConsorcIA

```
UNIDAD FUNCIONAL: 3° "A"
├── Propietario: Juan Pérez (obligado principal)
├── Usufructuario: —
├── Derecho real de uso: —
│
└── Inquilino: Ana López (obligado por contrato)
    └── Contrato: "El inquilino paga expensas ordinarias"
        └── En ConsorcIA: facturación a nombre del inquilino
            pero responsable solidario: propietario
```

---

## 6. Asambleas (Arts. 2058-2063)

### 6.1 Facultades de la asamblea (Art. 2058)

| Tema | Mayoría requerida |
|------|-------------------|
| Cuestiones atribuidas por ley/reglamento | Mayoría absoluta |
| Cuestiones del admin o consejo (5% solicita) | Mayoría absoluta |
| Nombramiento/despido de personal | Mayoría absoluta |
| Cuestiones no atribuidas al admin | Mayoría absoluta |
| Modificación del reglamento | 2/3 de propietarios |
| Mejoras/obras nuevas | Mayoría simple |
| Obras que modifican estructura | Unanimidad |

### 6.2 Quórum y convocatoria (Art. 2059)

**Requisitos:**
- Convocatoria en forma prevista en el reglamento
- Transcripción del orden del día preciso y completo
- **Nulidad:** tratar temas fuera del orden del día (salvo unanimidad de todos)

**En ConsorcIA:**
```
┌─────────────────────────────────────────────────────────────┐
│  CONVOCATORIA ASAMBLEA — Edificio Rivadavia 1234            │
├─────────────────────────────────────────────────────────────┤
│  Fecha: 15/08/2026 — 19:00 hs                               │
│  Lugar: Salón de usos múltiples                             │
│                                                             │
│  ORDEN DEL DÍA:                                             │
│  1. Aprobación de liquidación Julio 2026                    │
│  2. Presupuesto reparación ascensor ($320.000)              │
│  3. Designación de encargado (sustitución)                 │
│                                                             │
│  [Confirmar asistencia]  [Delegar voto]  [Ver documentos]  │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Consejo de Propietarios (Art. 2064)

### 7.1 Atribuciones

| Atribución | Descripción |
|------------|-------------|
| a) Convocar asamblea | Si el admin omite hacerlo |
| b) Control económico-financiero | Revisar liquidaciones, gastos |
| c) Autorizar fondo de reserva | Gastos imprevistos > ordinarios |
| d) Ejercer administración | En caso de vacancia del admin |

### 7.2 Limitaciones

> **"Excepto los casos indicados en este artículo, el consejo de propietarios no sustituye al administrador, ni puede cumplir sus obligaciones."**

### 7.3 En ConsorcIA

- Rol específico: `CONSEJO`
- Acceso a: reportes, liquidaciones, gastos
- NO puede: liquidar, cobrar, modificar coeficientes
- Alerta automática si el admin no convoca asamblea en plazo

---

## 8. Administrador (Arts. 2065-2067)

### 8.1 Designación y remoción (Art. 2066)

| Aspecto | Regla |
|---------|-------|
| Designación inicial | En reglamento de PH |
| Ratificación | Primera asamblea (90 días de 2 años o 50% ocupación) |
| Administradores sucesivos | Nombrados por asamblea |
| Remoción | Sin expresión de causa |

### 8.2 Obligaciones específicas (Art. 2067)

| Inciso | Obligación | En ConsorcIA |
|--------|------------|--------------|
| a) | Convocar asamblea y redactar orden del día | Agente Comunicador |
| b) | Ejecutar decisiones de la asamblea | Kanban de tareas |
| c) | Conservar cosas comunes y seguridad | Mantenimiento preventivo |
| d) | Practicar cuenta de expensas | Motor contable |
| e) | Rendir cuentas documentadas (60 días) | Reporte automático |
| f) | Nombrar/despedir personal (con asamblea) | Módulo RRHH |
| g) | Cumplir obligaciones laborales/previsionales | Integración AFIP |
| h) | Seguro integral (incendio, RC, riesgos) | Gestor de seguros |
| i) | Libros de actas, administración, registro | Digitalización |
| j) | Entregar documentos al cesar (15 días) | Offboarding checklist |
| k) | Notificar reclamos en 48 horas | Alerta automática |
| l) | Expedir certificado de deuda (3 días) | Portal self-service |
| m) | Representar al consorcio | Firma digital |

---

## 9. Subconsorcios (Art. 2068)

### 9.1 Definición

> **"En edificios cuya estructura o naturaleza lo haga conveniente, el reglamento de propiedad horizontal puede prever la existencia de sectores con independencia económica, funcional o administrativa."**

**Características:**
- Subasamblea propia
- Subadministrador propio
- Frente a terceros: responde TODO el consorcio

### 9.2 Implementación en ConsorcIA

```
EDIFICIO: Torres del Sol (2 torres)
├── Torre A (subconsorcio)
│   ├── Subadministrador: Carlos López
│   ├── Subasamblea propia
│   ├── Gastos propios (pileta, gimnasio Torre A)
│   └── Coeficientes propios (suman 100% dentro de Torre A)
│
└── Torre B (subconsorcio)
    ├── Subadministrador: Ana Martínez
    ├── Subasamblea propia
    ├── Gastos propios (sum, lavadero Torre B)
    └── Coeficientes propios

GASTOS COMUNES (ambas torres):
├── Portería
├── Seguridad
├── Seguros generales
└── ABL → Distribuidos por coeficientes del edificio TOTAL
```

**Modelo de datos:**
```prisma
model Subconsorcio {
  id          String   @id @default(uuid())
  edificioId  String
  nombre      String
  adminId     String?  // Subadministrador
  coeficientes Coeficiente[]
  gastos      Gasto[]  // Solo gastos de este subconsorcio
}
```

---

## 10. Decisiones de Diseño

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **Consorcio como entidad** | Tabla `consorcio` separada de `edificio` | El CCyC reconoce personalidad jurídica independiente. Un edificio puede cambiar de consorcio (desafectación). |
| **UF vs complementarias** | Relación 1:N con discriminación de tipo | Art. 2039: la UF puede tener una o más complementarias. |
| **Coeficientes** | Inmutable salvo escritura pública | Art. 2057: modificación solo con 2/3. No editable desde UI. |
| **Certificado de deuda** | Generación automática + firma digital | Art. 2048: título ejecutivo. Debe ser preciso y firmado. |
| **Subconsorcios** | Soporte desde Fase 2 | Complejidad alta. MVP: un solo consorcio por edificio. |
| **Asambleas** | Módulo digital con quórum automático | Facilita participación. Valida mayorías según CCyC. |
| **Poseedores** | Campo `obligado_pago` en unidad | Art. 2050: propietario + usufructuario + derecho real de uso. |

---

## 11. Checklist de Compliance CCyC

### Al configurar un edificio:

- [ ] Reglamento de PH cargado (escritura pública)
- [ ] Unidades funcionales identificadas con tipo
- [ ] Unidades complementarias vinculadas a su UF
- [ ] Coeficientes validados (suma = 100%)
- [ ] Categorías A/B/C definidas en reglamento
- [ ] Fondo de reserva configurado (si aplica)

### Por cada liquidación:

- [ ] Expensas ordinarias separadas de extraordinarias
- [ ] Distribución por coeficientes exacta
- [ ] Certificado de deuda disponible en portal
- [ ] Datos de seguros vigentes incluidos

---

## 12. Glosario

| Término | Definición |
|---------|------------|
| **UF** | Unidad Funcional |
| **PH** | Propiedad Horizontal |
| **Coeficiente** | Porcentaje de participación en gastos comunes |
| **Parte indivisa** | Porción proporcional del terreno y bienes comunes |
| **Título ejecutivo** | Documento que permite iniciar ejecución judicial sin juicio previo |
| **Usufructuario** | Persona con derecho de usufructo sobre la UF |
| **Subconsorcio** | Sector del edificio con independencia económica/funcional |

---

*Documento relacionado:* [[PRD-06-01 Ley 941 CABA]]  
*Documento relacionado:* [[PRD-06-02 Ley 14.701 PBA]]  
*Documento relacionado:* [[PRD-04-01 Gestión de Edificios]]  
*Documento relacionado:* [[PRD-02-05 Motor Contable]]
