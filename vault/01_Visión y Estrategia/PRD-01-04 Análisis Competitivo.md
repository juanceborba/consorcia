---
title: "PRD-01-04: Análisis Competitivo"
description: "Matriz comparativa de competidores, análisis de gaps estratégicos, posicionamiento de ConsorcIA y respuesta competitiva por escenario."
author: "ConsorcIA Team"
date: 2026-07-26
status: "vigente"
priority: "P0"
tags: [competencia, mercado, posicionamiento, consorcioabierto, adminia, conso, octopus, consorcIA]
outcomes:
  - "Mapear competidores directos e indirectos con datos actualizados"
  - "Identificar gaps funcionales que ConsorcIA puede ocupar"
  - "Definir posicionamiento único frente a cada competidor"
  - "Establecer ventajas defensivas (moats) a corto y largo plazo"
  - "Planificar respuesta ante movimientos de la competencia"
---

# PRD-01-04: Análisis Competitivo

> **ConsorcIA compite en un mercado con 5 jugadores establecidos. La ventaja no está en replicar funcionalidades, sino en diferenciadores que NADIE tiene: gestión personal del hogar, benchmarking, kanban con comunicación integrada, y costos operativos 70-85% menores.**

---

## 1. Panorama Competitivo

### 1.1 Competidores directos

| Plataforma | Años en mercado | Consorcios/UF | Modelo | Precio ref. |
|------------|-----------------|---------------|--------|-------------|
| **ConsorcioAbierto** | 15+ | +12.000 consorcios, +500K UF | Por UF | ARS 800-1.400/UF |
| **Octopus** | 8+ | +300 administradores | Premium fijo | ARS 100K+/edificio |
| **Adminia Manager** | 4+ | Creciendo rápido | Por edificio | ARS 55-70K/edificio |
| **CONSO** | 3+ | Creciendo | Por UF | ARS 2.950/UF/mes |
| **KM44 Cloud** | 5+ | N/D | Por UF | ARS 1.520/UF (Pro) |
| **Vecinos360** | 6+ | N/D | Por UF + fijo | USD $35 + $1/UF/mes |
| **Cuotia** | 2+ | N/D | Freemium | Gratis → $4.990/mes |

### 1.2 Competidores indirectos

- **Excel + WhatsApp:** 60-70% del mercado. Competidor más grande.
- **Plataforma oficial CABA (Ley 5983):** Gratuita, básica, solo para consorcios pequeños.
- **Estudios contables con software propietario:** Soluciones custom, no escalables.

---

## 2. Análisis Detallado por Competidor

### 2.1 ConsorcioAbierto — El líder histórico

**Fortalezas:**
- +12.000 consorcios = network effect débil pero real.
- App móvil nativa madura (iOS + Android).
- Liquidación contable robusta, cumple Ley 941.
- Votaciones online, reserva de amenities.
- Comunidad grande, soporte establecido.

**Debilidades:**
- UX de los años 2010. Frontend lento, no responsive.
- Sin IA, sin OCR, sin API pública.
- Pricing por UF penaliza edificios grandes.
- Sin kanban, sin trazabilidad de comunicaciones.
- Sin gestión personal del hogar.

**Estrategia frente a ConsorcioAbierto:**
> Migración asistida gratuita. Demo de importación inteligente de PDFs (onboarding en minutos vs semanas). App moderna con notificaciones push.

### 2.2 Octopus — El premium

**Fortalezas:**
- Balance automático, OCR de facturas.
- Cobros QR integrados.
- Soporte real (no solo tickets).
- Cumplimiento legal sólido.

**Debilidades:**
- **Muy caro.** Pricing premium excluye al 80% del mercado.
- Sin app móvil nativa (solo portal web).
- Sin IA conversacional.
- Sin liquidación end-to-end automatizada.
- Sin benchmarking.

**Estrategia frente a Octopus:**
> "Octopus cuesta 2x y no tiene app ni IA. ConsorcIA tiene todo eso por la mitad."

### 2.3 Adminia Manager — El innovador

**Fortalezas:**
- **ADA:** agente IA en WhatsApp (diferenciador real).
- PWA funcional, OCR, conciliación bancaria IA.
- API pública, firma digital de sueldos.
- Crecimiento agresivo.

**Debilidades:**
- Sin app móvil nativa (PWA limitada en iOS).
- Sin gestión personal del hogar.
- Sin benchmarking.
- Madurez de comunidad menor.
- Sin kanban con trazabilidad completa.

**Estrategia frente a Adminia:**
> "Adminia tiene IA en WhatsApp. Nosotros tenemos IA en WhatsApp + app nativa + gestión personal del hogar + benchmarking."

### 2.4 CONSO — El end-to-end

**Fortalezas:**
- Liquidación end-to-end completa.
- Copiloto IA integrado.
- OCR de documentos.
- Cumplimiento Ley 941 impecable.

**Debilidades:**
- Sin app móvil.
- Sin cobros online consolidados (MP, QR).
- Sin gestión personal del hogar.
- Pricing por UF = caro para edificios medianos.
- Sin benchmarking.

**Estrategia frente a CONSO:**
> "CONSO liquida bien pero no cobra online y no tiene app. Nosotros hacemos las dos cosas."

### 2.5 Vecinos360 — La app fuerte

**Fortalezas:**
- App móvil muy fuerte (mejor del mercado en UX).
- Comunicación e intranet personalizada.
- Buena adopción por habitantes.

**Debilidades:**
- Liquidación débil, no cumple Ley 941 en detalle.
- Sin OCR, sin IA.
- Precio en USD (riesgo cambiario para clientes argentinos).
- Sin gestión de expensas robusta.

**Estrategia frente a Vecinos360:**
> "Vecinos360 tiene buena app pero no liquida. Nosotros tenemos app + liquidación + IA."

---

## 3. Matriz Comparativa Completa

| Feature | ConsorcIA | ConsorcioAbierto | Octopus | Adminia | CONSO | Vecinos360 |
|---------|-----------|------------------|---------|---------|-------|------------|
| Liquidación Ley 941 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Cobros online (MP) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| App móvil nativa | ✅ (F2) | ✅ | ❌ | ❌ (PWA) | ❌ | ✅ |
| IA conversacional | ✅ (Swarm) | ❌ | ❌ | ✅ (ADA) | ✅ (Copiloto) | ❌ |
| OCR facturas | ✅ (F2) | ❌ | ✅ | ✅ | ✅ | ❌ |
| Kanban tareas | ✅ (F2) | ❌ | ❌ | ⚠️ | ❌ | ⚠️ |
| Comunicación integrada | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ | ✅ |
| **Gestión personal hogar** | ✅ (F3) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Benchmarking** | ✅ (F3) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Importación PDFs** | ✅ (F2) | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| API pública | ✅ (F3) | ❌ | ❌ | ✅ | ❌ | ❌ |
| Pricing competitivo | ✅ | ⚠️ | ❌ | ✅ | ❌ | ❌ |
| Multi-edificio | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

> **Leyenda:** ✅ Disponible | ⚠️ Parcial | ❌ No disponible | (F2) Fase 2 | (F3) Fase 3

---

## 4. Ventajas Competitivas (Moats)

### 4.1 Moat a corto plazo (6-12 meses)

1. **Costos operativos 70-85% menores:** Nemotron + CheaperInference permiten pricing agresivo sin sacrificar margen.
2. **Gestión personal del hogar:** Ningún competidor lo tiene. Hook viral para habitantes.
3. **Importación inteligente de PDFs:** Onboarding masivo para carteras grandes. Barrera de migración invertida.

### 4.2 Moat a mediano plazo (1-2 años)

1. **Datos de benchmarking:** Mejora con cada edificio agregado. Efecto red de datos.
2. **App móvil nativa + portal web:** Experiencia omnicanal que pocos tienen.
3. **Integraciones ecosystem:** AgentMail, MercadoPago, WhatsApp, AFIP — todo conectado.

### 4.3 Moat a largo plazo (2+ años)

1. **Switching costs:** Una vez que el admin liquida 12 meses en ConsorcIA, migrar es doloroso.
2. **Brand en compliance:** "Si usás ConsorcIA, cumplís la ley." Posicionamiento de confianza.
3. **Network effects B2B2C:** Más habitantes → más admins → más datos → mejor benchmarking.

---

## 5. Escenarios de Respuesta Competitiva

### 5.1 Si ConsorcioAbierto lanza IA (probable en 12-18 meses)

**Respuesta:**
- Acelerar Fase 3 (gestión personal del hogar) antes de que puedan replicar.
- Doblar down en benchmarking como producto de datos.
- Ofrecer migración gratuita desde ConsorcioAbierto con importación de datos.

### 5.2 Si Adminia lanza app nativa (probable en 6-12 meses)

**Respuesta:**
- Diferenciarse con benchmarking y gestión personal (Adminia no tiene roadmap de esto).
- Mejorar kanban con IA predictiva (mantenimiento preventivo).
- Alianzas estratégicas con colegios de administradores.

### 5.3 Si CONSO baja precios o lanza app

**Respuesta:**
- Competir en valor, no en precio. "Más features por menos plata."
- Enfocar en la experiencia del habitante (CONSO es 100% B2B).

### 5.4 Si entra un nuevo jugador con IA

**Respuesta:**
- La barrera no es la IA, es el cumplimiento legal + datos históricos.
- Acelerar onboarding de edificios para acumular datos de benchmarking.
- Patentar (si es posible) los algoritmos de anonimización de benchmarking.

---

## 6. Decisiones de Diseño Clave

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| **No competir en precio con ConsorcioAbierto** | Competir en valor | Nuestro target es admin que quiere crecer, no la más barata |
| **Diferenciadores primero en Fase 2-3** | Kanban, OCR, benchmarking | El core (liquidación) debe ser igual de bueno, no mejor |
| **App nativa vs PWA** | Nativa (React Native) | Adminia usa PWA y es su debilidad. Vecinos360 gana con app nativa. |
| **API pública** | Fase 3 | Adminia ya la tiene. Es table stakes para enterprise. |
| **Benchmarking como producto separado** | Sí | No diluye el mensaje del ERP. Genera ingreso adicional. |

---

*Documento relacionado:* [[PRD-01-01 Visión del Producto]]  
*Documento relacionado:* [[PRD-01-03 Modelo de Negocio]]  
*Documento relacionado:* [[PRD-04-06 Kanban de Tareas]]  
*Documento relacionado:* [[PRD-04-07 Importación Inteligente]]  
*Documento relacionado:* [[PRD-04-10 Benchmarking]]