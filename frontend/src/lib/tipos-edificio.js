// frontend/src/lib/tipos-edificio.js — ConsorcIA
// Enum canónico de tipos de edificio (TIPOS_EDIFICIO del backend, PRD-04-01
// §2) con sus labels en español. Lo comparten el formulario de alta (S2-06)
// y el detalle (S2-07).

export const TIPOS_EDIFICIO = [
  { value: 'ph', label: 'PH / Consorcio' },
  { value: 'barrio_privado', label: 'Barrio privado' },
  { value: 'centro_comercial', label: 'Centro comercial' },
  { value: 'otro', label: 'Otro' },
];

export function etiquetaTipoEdificio(value) {
  return TIPOS_EDIFICIO.find((tipo) => tipo.value === value)?.label ?? value;
}
