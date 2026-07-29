// src/core/validators/recibo.validator.js — Requisitos Ley 941 de un recibo (S3-05)
// Spec: PRD-02-05 §5.2 · PRD-06-01 §3.1 (datos obligatorios del recibo).
//
// Corre ANTES de escribir el PDF: un recibo que no cumple no se emite. Es la
// última línea de defensa contra un dato faltante que se colara desde la
// liquidación (p.ej. una organización sin matrícula RPA cargada).

const REQUISITOS = [
  { campo: 'matriculaRPA', mensaje: 'Matrícula RPA del administrador es obligatoria' },
  { campo: 'qrData', mensaje: 'QR con datos de la liquidación es obligatorio' },
  { campo: 'periodo', mensaje: 'Período de liquidación es obligatorio' },
  { campo: 'fechaEmision', mensaje: 'Fecha de emisión es obligatoria' },
  { campo: 'consorcio', mensaje: 'Denominación del consorcio es obligatoria' },
  { campo: 'direccion', mensaje: 'Domicilio del consorcio es obligatorio' },
  { campo: 'unidad', mensaje: 'Identificación de la unidad funcional es obligatoria' },
];

// La separación ordinarias/extraordinarias se valida por presencia, no por
// verdad: "0.00" es un valor legítimo (un mes sin extraordinarias) pero
// `undefined` significa que el recibo no separa, y eso la Ley 941 no lo permite.
const MONTOS = ['totalOrdinarias', 'totalExtraordinarias', 'totalGeneral'];

export function validarRecibo(recibo) {
  const errores = REQUISITOS.filter((r) => !recibo[r.campo]).map((r) => ({
    campo: r.campo,
    mensaje: r.mensaje,
  }));

  for (const campo of MONTOS) {
    if (recibo[campo] === undefined || recibo[campo] === null || recibo[campo] === '') {
      errores.push({
        campo,
        mensaje: 'La separación ordinarias/extraordinarias con su total es obligatoria',
      });
    }
  }

  if (recibo.qrData) {
    try {
      const qr = JSON.parse(recibo.qrData);
      if (!qr.matriculaRPA || !qr.periodo || !qr.unidad) {
        errores.push({
          campo: 'qrData',
          mensaje: 'El QR debe contener matrícula RPA, período y unidad',
        });
      }
    } catch {
      errores.push({ campo: 'qrData', mensaje: 'El QR debe contener JSON válido' });
    }
  }

  return { valido: errores.length === 0, cumpleLey941: errores.length === 0, errores };
}

export default { validarRecibo };
