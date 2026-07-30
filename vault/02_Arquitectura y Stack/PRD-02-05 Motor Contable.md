---
title: "PRD-02-05: Motor Contable"
description: "Liquidación engine determinístico en NodeJS. Distribución A/B/C, validaciones matemáticas, generación de recibos con QR (Ley 941)."
author: "ConsorcIA Team"
date: 2026-07-28
status: "vigente"
priority: "P0"
tags: [motor-contable, liquidacion, decimal, deterministico, ley-941, recibos, qr]
outcomes:
  - "Implementar cálculo exacto de distribución de gastos con decimal.js"
  - "Validar matemáticamente que suma de coeficientes = 1 y suma de montos = montoTotal"
  - "Soportar categorías A/B/C de distribución según reglamento de PH"
  - "Generar recibos PDF con QR válido según Ley 941 CABA"
  - "Garantizar cero tolerancia para errores matemáticos en liquidaciones"
---

# PRD-02-05: Motor Contable

> **100% determinístico. 0% IA.**  
> Los agentes Swarm **nunca** calculan expensas. Solo wrappean y explican.  
> La Ley 941 y el CCyC exigen precisión matemática. Un error de 1 centavo es un problema legal.

---

## 1. Principios del Motor Contable

```
┌─────────────────────────────────────────────────────────────┐
│  PRINCIPIOS DEL MOTOR CONTABLE                               │
│                                                              │
│  1. CERO uso de punto flotante (float/double)               │
│     → decimal.js con precisión arbitraria                  │
│                                                              │
│  2. CERO redondeo intermedio                                 │
│     → Solo redondear al resultado final (2 decimales)      │
│                                                              │
│  3. VALIDACIÓN exhaustiva después de cada cálculo          │
│     → Suma coeficientes = 1.000000                           │
│     → Suma montos = montoTotal (al centavo)                  │
│                                                              │
│  4. DETERMINÍSTICO 100%                                     │
│     → Mismo input = mismo output, siempre                   │
│     → Sin aleatoriedad, sin "creatividad"                   │
│                                                              │
│  5. AUDITABLE                                               │
│     → Cada paso del cálculo se loguea                       │
│     → Diff de audit log en cada liquidación                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Arquitectura del Motor

```
backend/src/core/
├── liquidacion.engine.js          # Motor principal
├── distribucion.coeficientes.js   # Cálculo de coeficientes
├── recibos.generator.js           # PDF + QR (Ley 941)
├── conciliacion.bancaria.js       # Conciliación (Fase 2)
└── validators/
    ├── coeficientes.validator.js
    ├── montos.validator.js
    └── recibo.validator.js
```

---

## 3. Liquidación Engine

### 3.1 Cálculo de Distribución

```javascript
// src/core/liquidacion.engine.js
const Decimal = require('decimal.js');

/**
 * Configuración de precisión
 * decimal.js usa precisión arbitraria por defecto (20 dígitos)
 * Para consorcios, 10 dígitos son más que suficientes
 */
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

class LiquidacionEngine {
  /**
   * Calcula la distribución de un gasto entre las unidades de un edificio
   * según las categorías A/B/C del reglamento de PH.
   * 
   * @param {Object} gasto - { monto: string|number, categoria: 'A'|'B'|'C', servicio?: string, sector?: string }
   * @param {Array} unidades - [{ id, coeficiente, servicios?: [], sector?: string }]
   * @returns {Array} - [{ unidadId, coeficiente, monto, moneda }]
   * @throws {Error} - Si la suma de coeficientes != 1 o hay desbalance
   */
  static calcularDistribucion(gasto, unidades) {
    const montoTotal = new Decimal(gasto.monto);
    const distribucion = [];

    // ─── VALIDACIÓN 1: Suma de coeficientes = 1 ───
    const sumaCoef = unidades.reduce((sum, u) => 
      sum.plus(new Decimal(u.coeficiente)), new Decimal(0)
    );

    if (!sumaCoef.equals(1)) {
      throw new LiquidacionError(
        `SUMA_COEFICIENTES_INVALIDA`,
        `Suma de coeficientes inválida: ${sumaCoef.toFixed(6)} (debe ser 1.000000)`,
        { sumaActual: sumaCoef.toString(), unidades: unidades.length }
      );
    }

    // ─── CÁLCULO: Distribuir según categoría del gasto ───
    for (const unidad of unidades) {
      let coefAplicable = new Decimal(0);

      switch(gasto.categoria) {
        case 'A':
          // Gastos generales → TODAS las UF
          coefAplicable = new Decimal(unidad.coeficiente);
          break;

        case 'B':
          // Servicios específicos → SOLO UF que los usan
          // Ej: ascensor, calefacción central, agua caliente
          coefAplicable = unidad.servicios?.includes(gasto.servicio)
            ? new Decimal(unidad.coeficiente)
            : new Decimal(0);
          break;

        case 'C':
          // Sectores específicos → SOLO UF del sector
          // Ej: torre A, pileta, sector comercial
          coefAplicable = unidad.sector === gasto.sector
            ? new Decimal(unidad.coeficiente)
            : new Decimal(0);
          break;

        default:
          throw new LiquidacionError(
            `CATEGORIA_INVALIDA`,
            `Categoría inválida: ${gasto.categoria}. Debe ser A, B o C.`,
            { categoria: gasto.categoria }
          );
      }

      const montoUnidad = montoTotal.times(coefAplicable);

      distribucion.push({
        unidadId: unidad.id,
        coeficiente: coefAplicable.toString(),
        monto: montoUnidad.toFixed(2), // EXACTO a 2 decimales
        moneda: gasto.moneda || 'ARS'
      });
    }

    // ─── VALIDACIÓN 2: Suma de montos = montoTotal ───
    const sumaMontos = distribucion.reduce((sum, d) => 
      sum.plus(new Decimal(d.monto)), new Decimal(0)
    );

    if (!sumaMontos.equals(montoTotal)) {
      // Ajuste de centavos: distribuir diferencia en la última unidad
      const diferencia = montoTotal.minus(sumaMontos);
      const ultima = distribucion[distribucion.length - 1];
      ultima.monto = new Decimal(ultima.monto).plus(diferencia).toFixed(2);

      // Revalidar
      const sumaAjustada = distribucion.reduce((sum, d) => 
        sum.plus(new Decimal(d.monto)), new Decimal(0)
      );

      if (!sumaAjustada.equals(montoTotal)) {
        throw new LiquidacionError(
          `DESBALANCE_LIQUIDACION`,
          `Desbalance en liquidación después de ajuste: ${sumaAjustada} vs ${montoTotal}`,
          { sumaMontos: sumaAjustada.toString(), montoTotal: montoTotal.toString() }
        );
      }
    }

    return distribucion;
  }

  /**
   * Calcula una liquidación completa para un período
   */
  static async calcularLiquidacion(edificioId, periodo, gastos, unidades) {
    const liquidacion = {
      edificioId,
      periodo,
      fechaLiquidacion: new Date(),
      estado: 'BORRADOR',
      totalOrdinarias: new Decimal(0),
      totalExtraordinarias: new Decimal(0),
      detalles: []
    };

    for (const gasto of gastos) {
      const distribucion = this.calcularDistribucion(gasto, unidades);

      for (const detalle of distribucion) {
        liquidacion.detalles.push({
          unidadId: detalle.unidadId,
          gastoId: gasto.id,
          coeficienteAplicado: detalle.coeficiente,
          montoAsignado: detalle.monto
        });
      }

      // Acumular totales
      if (gasto.esOrdinario) {
        liquidacion.totalOrdinarias = liquidacion.totalOrdinarias.plus(gasto.monto);
      } else {
        liquidacion.totalExtraordinarias = liquidacion.totalExtraordinarias.plus(gasto.monto);
      }
    }

    liquidacion.totalGeneral = liquidacion.totalOrdinarias
      .plus(liquidacion.totalExtraordinarias);

    return {
      ...liquidacion,
      totalOrdinarias: liquidacion.totalOrdinarias.toFixed(2),
      totalExtraordinarias: liquidacion.totalExtraordinarias.toFixed(2),
      totalGeneral: liquidacion.totalGeneral.toFixed(2)
    };
  }
}

// ─── Custom Error ───
class LiquidacionError extends Error {
  constructor(codigo, mensaje, metadata = {}) {
    super(mensaje);
    this.name = 'LiquidacionError';
    this.codigo = codigo;
    this.metadata = metadata;
    this.timestamp = new Date().toISOString();
  }
}

module.exports = { LiquidacionEngine, LiquidacionError };
```

### 3.2 Tests del Motor

```javascript
// tests/core/liquidacion.engine.test.js
const { LiquidacionEngine, LiquidacionError } = require('../../src/core/liquidacion.engine');
const Decimal = require('decimal.js');

describe('LiquidacionEngine', () => {
  describe('calcularDistribucion', () => {
    const unidades = [
      { id: 'u1', coeficiente: '0.076923', servicios: ['ascensor'], sector: 'torre_a' },
      { id: 'u2', coeficiente: '0.076923', servicios: ['ascensor'], sector: 'torre_a' },
      { id: 'u3', coeficiente: '0.153846', servicios: [], sector: 'torre_b' },
      { id: 'u4', coeficiente: '0.692308', servicios: ['ascensor', 'calefaccion'], sector: 'torre_a' }
    ];

    test('debe distribuir gasto categoría A entre TODAS las UF', () => {
      const gasto = { monto: '100000.00', categoria: 'A', moneda: 'ARS' };
      const resultado = LiquidacionEngine.calcularDistribucion(gasto, unidades);

      // Todas las UF deben tener monto > 0
      expect(resultado.every(r => new Decimal(r.monto).gt(0))).toBe(true);

      // Suma debe ser exactamente 100000.00
      const suma = resultado.reduce((s, r) => s.plus(r.monto), new Decimal(0));
      expect(suma.toFixed(2)).toBe('100000.00');
    });

    test('debe distribuir gasto categoría B solo a UF con el servicio', () => {
      const gasto = { monto: '50000.00', categoria: 'B', servicio: 'ascensor', moneda: 'ARS' };
      const resultado = LiquidacionEngine.calcularDistribucion(gasto, unidades);

      // u3 no tiene ascensor → monto = 0
      const u3 = resultado.find(r => r.unidadId === 'u3');
      expect(new Decimal(u3.monto).toFixed(2)).toBe('0.00');

      // u1, u2, u4 tienen ascensor → monto > 0
      const conAscensor = resultado.filter(r => r.unidadId !== 'u3');
      expect(conAscensor.every(r => new Decimal(r.monto).gt(0))).toBe(true);

      // Suma debe ser exactamente 50000.00
      const suma = resultado.reduce((s, r) => s.plus(r.monto), new Decimal(0));
      expect(suma.toFixed(2)).toBe('50000.00');
    });

    test('debe distribuir gasto categoría C solo al sector', () => {
      const gasto = { monto: '30000.00', categoria: 'C', sector: 'torre_a', moneda: 'ARS' };
      const resultado = LiquidacionEngine.calcularDistribucion(gasto, unidades);

      // u3 es torre_b → monto = 0
      const u3 = resultado.find(r => r.unidadId === 'u3');
      expect(new Decimal(u3.monto).toFixed(2)).toBe('0.00');
    });

    test('debe rechazar si suma de coeficientes != 1', () => {
      const unidadesInvalidas = [
        { id: 'u1', coeficiente: '0.5' },
        { id: 'u2', coeficiente: '0.4' } // Suma = 0.9
      ];
      const gasto = { monto: '10000.00', categoria: 'A' };

      expect(() => {
        LiquidacionEngine.calcularDistribucion(gasto, unidadesInvalidas);
      }).toThrow(LiquidacionError);
    });

    test('debe manejar montos con muchos decimales sin perder precisión', () => {
      const gasto = { monto: '12345.678901', categoria: 'A', moneda: 'ARS' };
      const resultado = LiquidacionEngine.calcularDistribucion(gasto, unidades);

      const suma = resultado.reduce((s, r) => s.plus(r.monto), new Decimal(0));
      expect(suma.toFixed(2)).toBe('12345.68'); // Redondeo a 2 decimales
    });
  });
});
```

---

## 4. Generación de Recibos (Ley 941)

### 4.1 Requisitos Legales

Según **Ley 941 CABA**, todo recibo de expensas debe incluir:

1. **Matrícula RPA** del administrador (resuelta desde la organización por herencia edificio → organización)
2. **QR code** escaneable con datos de la liquidación
3. **Separación clara** entre expensas ordinarias y extraordinarias
4. **Detalle de seguros** contratados
5. **Resumen bancario** del consorcio
6. **Fecha de emisión** y **período**
7. **Nombre del consorcio** y **dirección**
8. **Datos de la UF**: nombre del propietario, coeficiente, m²

### 4.2 Generador de Recibos

```javascript
// src/core/recibos.generator.js
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

class RecibosGenerator {
  /**
   * Genera un recibo PDF con QR según Ley 941 CABA
   */
  static async generarRecibo(liquidacion, unidad, usuario, config) {
    const doc = new PDFDocument({ margin: 50 });
    const outputPath = path.join(__dirname, '../../uploads/recibos');

    // Asegurar directorio
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    const filename = `recibo_${liquidacion.periodo}_${unidad.numero}.pdf`;
    const filepath = path.join(outputPath, filename);

    const stream = fs.createWriteStream(filepath);
    doc.pipe(stream);

    // ─── HEADER ───
    doc.fontSize(20).text('RECIBO DE EXPENSAS', { align: 'center' });
    doc.moveDown();

    // Datos del consorcio
    doc.fontSize(12).text(`Consorcio: ${config.nombreEdificio}`);
    doc.text(`Dirección: ${config.direccionEdificio}`);
    doc.text(`Matrícula RPA: ${config.matriculaRPA}`);
    doc.moveDown();

    // Datos de la UF
    doc.text(`Unidad Funcional: ${unidad.numero}`);
    doc.text(`Propietario: ${usuario.nombre} ${usuario.apellido}`);
    doc.text(`Coeficiente: ${unidad.coeficiente}`);
    doc.text(`m²: ${unidad.m2}`);
    doc.moveDown();

    // ─── QR CODE ───
    const qrData = JSON.stringify({
      consorcio: config.nombreEdificio,
      matriculaRPA: config.matriculaRPA,
      periodo: liquidacion.periodo,
      unidad: unidad.numero,
      totalOrdinarias: liquidacion.totalOrdinarias,
      totalExtraordinarias: liquidacion.totalExtraordinarias,
      totalGeneral: liquidacion.totalGeneral,
      fechaEmision: new Date().toISOString()
    });

    const qrBuffer = await QRCode.toBuffer(qrData, { 
      type: 'png', 
      width: 150,
      errorCorrectionLevel: 'H'
    });

    doc.image(qrBuffer, doc.page.width - 200, 50, { width: 150 });
    doc.moveDown(3);

    // ─── DETALLE ORDINARIAS ───
    doc.fontSize(14).text('EXPENSAS ORDINARIAS', { underline: true });
    doc.moveDown();

    const detallesOrd = liquidacion.detalles.filter(d => d.gasto.esOrdinario);
    for (const detalle of detallesOrd) {
      doc.fontSize(10).text(
        `${detalle.gasto.concepto.padEnd(40)} $${detalle.montoAsignado}`,
        { continued: false }
      );
    }
    doc.fontSize(12).text(`Total Ordinarias: $${liquidacion.totalOrdinarias}`, { align: 'right' });
    doc.moveDown();

    // ─── DETALLE EXTRAORDINARIAS ───
    doc.fontSize(14).text('EXPENSAS EXTRAORDINARIAS', { underline: true });
    doc.moveDown();

    const detallesExt = liquidacion.detalles.filter(d => !d.gasto.esOrdinario);
    for (const detalle of detallesExt) {
      doc.fontSize(10).text(
        `${detalle.gasto.concepto.padEnd(40)} $${detalle.montoAsignado}`,
        { continued: false }
      );
    }
    doc.fontSize(12).text(`Total Extraordinarias: $${liquidacion.totalExtraordinarias}`, { align: 'right' });
    doc.moveDown();

    // ─── TOTAL ───
    doc.fontSize(16).text(`TOTAL A PAGAR: $${liquidacion.totalGeneral}`, { align: 'right', bold: true });
    doc.moveDown();

    // ─── FOOTER ───
    doc.fontSize(9).text('Este recibo es un documento válido según Ley 941 de la Ciudad Autónoma de Buenos Aires.', { align: 'center' });
    doc.text(`Fecha de emisión: ${new Date().toLocaleDateString('es-AR')}`, { align: 'center' });
    doc.text(`Período: ${liquidacion.periodo}`, { align: 'center' });

    doc.end();

    return new Promise((resolve, reject) => {
      stream.on('finish', () => resolve({ filepath, filename }));
      stream.on('error', reject);
    });
  }
}

module.exports = { RecibosGenerator };
```

---

## 5. Validaciones del Motor

### 5.1 Validador de Coeficientes

```javascript
// src/core/validators/coeficientes.validator.js
const Decimal = require('decimal.js');

class CoeficientesValidator {
  static validar(unidades) {
    const errores = [];

    // 1. Todos los coeficientes >= 0
    for (const u of unidades) {
      if (new Decimal(u.coeficiente).lt(0)) {
        errores.push({
          campo: `unidades[${u.id}].coeficiente`,
          mensaje: 'El coeficiente no puede ser negativo',
          valor: u.coeficiente
        });
      }
    }

    // 2. Suma = 1.000000 (con tolerancia de 0.0001%)
    const suma = unidades.reduce((s, u) => s.plus(u.coeficiente), new Decimal(0));
    if (!suma.equals(1)) {
      errores.push({
        campo: 'coeficientes.suma',
        mensaje: `La suma de coeficientes debe ser 1.000000. Actual: ${suma.toFixed(6)}`,
        valor: suma.toString()
      });
    }

    // 3. No hay duplicados de número de unidad
    const numeros = unidades.map(u => u.numero);
    const duplicados = numeros.filter((n, i) => numeros.indexOf(n) !== i);
    if (duplicados.length > 0) {
      errores.push({
        campo: 'unidades.numero',
        mensaje: `Números de unidad duplicados: ${duplicados.join(', ')}`,
        valor: duplicados
      });
    }

    return {
      valido: errores.length === 0,
      errores
    };
  }
}

module.exports = { CoeficientesValidator };
```

### 5.2 Validador de Recibos

```javascript
// src/core/validators/recibo.validator.js
class ReciboValidator {
  static validar(recibo) {
    const requisitosLey941 = [
      { campo: 'matriculaRPA', mensaje: 'Matrícula RPA es obligatoria' },
      { campo: 'qrData', mensaje: 'QR con datos de liquidación es obligatorio' },
      { campo: 'totalOrdinarias', mensaje: 'Separación ordinarias/extraordinarias es obligatoria' },
      { campo: 'totalExtraordinarias', mensaje: 'Separación ordinarias/extraordinarias es obligatoria' },
      { campo: 'periodo', mensaje: 'Período de liquidación es obligatorio' },
      { campo: 'fechaEmision', mensaje: 'Fecha de emisión es obligatoria' }
    ];

    const errores = requisitosLey941
      .filter(req => !recibo[req.campo])
      .map(req => ({ campo: req.campo, mensaje: req.mensaje }));

    // Validar que QR sea parseable
    if (recibo.qrData) {
      try {
        const qrJson = JSON.parse(recibo.qrData);
        if (!qrJson.matriculaRPA || !qrJson.periodo) {
          errores.push({
            campo: 'qrData',
            mensaje: 'QR debe contener matrícula RPA y período'
          });
        }
      } catch {
        errores.push({
          campo: 'qrData',
          mensaje: 'QR debe contener JSON válido'
        });
      }
    }

    return {
      valido: errores.length === 0,
      errores,
      cumpleLey941: errores.length === 0
    };
  }
}

module.exports = { ReciboValidator };
```

---

## 6. Decisiones de Diseño

| Decisión | Contexto | Justificación |
|----------|----------|---------------|
| **decimal.js** | Cálculos monetarios | Precisión arbitraria. Evita errores de punto flotante que son comunes en JavaScript (0.1 + 0.2 != 0.3) |
| **Categorías A/B/C** | Reglamento de PH | Estándar del rubro. A = generales, B = servicios específicos, C = sectores |
| **Ajuste de centavos en última UF** | Redondeo | Si la suma no cuadra por redondeo, ajustar la última UF. Documentar en audit log |
| **PDF con pdfkit** | Recibos | Ligero, programático, sin dependencias de sistema. Alternativa: Puppeteer (más pesado) |
| **QR con qrcode** | Ley 941 | Estándar, compatible con cualquier lector de QR |
| **Template validado por abogado** | Legal | El PDF debe cumplir TODOS los requisitos de Ley 941. Validar con abogado especialista en PH |
| **Separación ord/ext** | Ley 941 | Obligatorio. Las extraordinarias no pueden financiarse con ordinarias sin asamblea |

---

*Documento relacionado:* [[PRD-02-01 Arquitectura General]]  
*Documento relacionado:* [[PRD-02-04 Base de Datos]]  
*Documento relacionado:* [[PRD-04-03 Liquidación de Expensas]]  
*Documento relacionado:* [[PRD-06-01 Ley 941 CABA]]
