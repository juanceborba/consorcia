# AGENTS.md — ConsorcIA Vault (PRDs)

## Descripción del proyecto

Este directorio **no es un repositorio de código**: es un **vault de Obsidian** que contiene los PRDs (Product Requirement Documents) del proyecto **ConsorcIA**, una plataforma de gestión de consorcios (edificios) potenciada por IA. No hay código fuente, tests, dependencias ni build — solo documentos Markdown con frontmatter YAML y enlaces estilo Obsidian (`[[wikilinks]]`).

ConsorcIA combina tres líneas de producto:
1. **ERP de consorcio** (gestión de edificios, gastos, liquidación de expensas, cobranzas).
2. **Gestión personal del hogar** (Fase 3).
3. **Benchmarking de costos** entre edificios (Fase 3).

El roadmap se organiza en 3 fases (ver `01_Visión y Estrategia/PRD-01-02 Estrategia de MVP y Fases.md`):
- **MVP** (meses 1–3), **Fase 2** (meses 4–5.5), **Fase 3** (meses 6–12).

## Stack tecnológico documentado (aún no implementado aquí)

Según `02_Arquitectura y Stack/PRD-02-02 Stack Tecnológico.md`:

- **Frontend:** React 19 + Vite 6 + Tailwind + shadcn/ui (React Native en Fase 2).
- **Backend:** NodeJS 20 + Express 5, validación con Zod, motor contable determinístico con decimal.js.
- **IA:** Kimi3 Swarm (orquestación de agentes), modelos NVIDIA Nemotron y Kimi K2/K3 vía router LLM CheaperInference.
- **Microservicios Python:** OCR (FastAPI + baidu/Unlimited-OCR) y Embeddings (Nemotron 3 Embed 1B).
- **Datos:** PostgreSQL 17 (+ pgvector), Redis 7, MinIO → S3.
- **Integraciones:** AgentMail (email), MercadoPago, WhatsApp Business API, Cerbos (RBAC).
- **Infra:** Docker Compose (dev) → AWS ECS/Fargate + RDS + ElastiCache (prod). CI/CD con GitHub Actions + Docker Hub. Observabilidad con OpenTelemetry, Jaeger, Prometheus/Grafana.
- **Principio arquitectónico clave:** el Swarm de agentes **orquesta**, pero el motor contable **calcula** (nunca al revés). Los cálculos monetarios son siempre determinísticos, fuera de los LLMs.

## Estructura del vault

Los documentos siguen la convención de nombres `PRD-XX-YY Título.md`, donde `XX` es el número de área (carpeta) e `YY` el número de documento dentro del área:

| Carpeta | Contenido |
|---|---|
| `00_MOC/` | Map of Content — índice maestro y punto de entrada (`PRD-00-00 Map of Content.md`) |
| `01_Visión y Estrategia/` | Visión de producto, roadmap MVP/fases, modelo de negocio, análisis competitivo |
| `02_Arquitectura y Stack/` | Arquitectura general (6 capas), stack, Docker, base de datos, motor contable, router LLM |
| `03_Agentes IA/` | Arquitectura del swarm y especificación de cada agente (Onboarding, Contable, Documental, Comunicador, Cobranzas, Kanban, Dashboard, Benchmarking) |
| `04_Módulos Core/` | Módulos funcionales: edificios, gastos, liquidación de expensas, cobranzas, portal del residente, kanban, importación, dashboard, etc. |
| `05_Integraciones/` | AgentMail, MercadoPago, WhatsApp, Cerbos RBAC, OCR, Embeddings/RAG |
| `06_Compliance y Legal/` | Ley 941 CABA, Ley 14.701 PBA, Ley 25.326 (datos personales), Código Civil, CCT 589/10 SUTERH |
| `07_Frontend y UX/` | Stack frontend, app móvil |
| `08_DevOps y Observabilidad/` | Docker Compose local, CI/CD, deploy AWS, monitoring, seguridad |
| `09_Riesgos y Decisiones/` | ADRs y decisiones de arquitectura |

Además existe `consorcia.code-workspace` (workspace trivial de VS Code que apunta a la raíz).

**Nota de consistencia:** el MOC lista algunos documentos que **todavía no existen** en el vault (p. ej. `PRD-09-02` a `PRD-09-04` y toda la sección `10 — Referencias`). Tratá el MOC como plan, no como inventario exacto; verificá la existencia del archivo antes de asumir su contenido.

## Comandos de build y test

**No existen.** Este vault no contiene código, gestores de paquetes, CI ni tests. No hay nada que compilar ni ejecutar. Las validaciones útiles son editoriales:

- Verificar que el frontmatter YAML de cada PRD nuevo sea válido y completo.
- Verificar que los `[[wikilinks]]` apunten a documentos existentes.
- Actualizar el MOC cuando se agregue, renombre o modifique un PRD.

## Convenciones de documentación (obligatorias)

Definidas en el MOC (`PRD-00-00`, sección "Notas para el Equipo"):

- **Idioma:** español (rioplatense) en todo el contenido y los metadatos.
- **Frontmatter obligatorio** en cada PRD: `title`, `description`, `author`, `date`, `status`, `priority`, `tags` y `outcomes` (lista de resultados esperados del documento).
- **Estados (`status`):** `borrador` → `revisión` → `aprobado` → `vigente` → `obsoleto`.
- **Prioridades (`priority`):** `P0` (crítico/MVP), `P1` (Fase 2), `P2` (Fase 3).
- **Nomenclatura de archivos:** `PRD-XX-YY Título Descriptivo.md` dentro de la carpeta de su área.
- **Cada PRD es autocontenido:** no asumir que el lector conoce otro documento.
- **Links bidireccionales:** usar `[[PRD-XX-YY]]` para conectar documentos.
- **Regla de actualización:** si cambiás una decisión de diseño, actualizá el PRD correspondiente **y** el MOC.
- **Regla de sincronización con la implementación:** el código vive en `../app` (sibling del vault). Siempre que una implementación diverja de lo que dice un PRD (puertos, versiones, servicios, configs, ADRs), **actualizá el PRD en la misma tarea** — el PRD debe reflejar lo que realmente existe, no el diseño original. No dejar secciones de "notas de implementación" permanentes: integrar la corrección en el cuerpo del documento. Si un documento entero queda divergente, marcarlo `status: obsoleto`, reducir su contenido a un puntero al documento canónico y anotarlo en el MOC.
- **Dashboard generado:** `00_MOC/Estado de Implementación.md` lo genera `app/state/engine.py` (motor de estado). No editarlo a mano: el próximo `rebuild` pisa los cambios.
- **Tags principales:** `#consorcIA #mvp #fase2 #fase3 #agente #core #integracion #compliance #frontend #devops #riesgo #decision`.

## Consideraciones de dominio y seguridad

- **Jerarquía de entidades:** `Organización → Edificio → Unidad → Usuario`. La **Organización** (administración/estudio administrador de consorcios) es el cliente del SaaS y el tenant raíz: el aislamiento de datos es por `organizacion_id` (nunca por edificio). El edificio es el segundo nivel de scope. El staff (`org_admin`, `gestor`) pertenece a la organización; los residentes (propietario, inquilino, encargado, proveedor, consejo) pertenecen al edificio.
- **Roles únicos:** `superadmin`, `org_admin`, `gestor` (nivel organización); `consejo`, `propietario`, `inquilino`, `encargado`, `proveedor` (nivel edificio/UF).

Aunque no hay código, los PRDs fijan restricciones que cualquier implementación futura debe respetar:

- **Cálculos monetarios determinísticos:** la liquidación de expensas usa decimal.js (precisión arbitraria) en el motor contable; los agentes IA solo interpretan y explican, jamás calculan montos.
- **Multi-tenancy y RBAC:** autorización con Cerbos (políticas como código) y JWT (con `org_id` y `roles`); aislamiento de datos entre organizaciones (RLS por `organizacion_id`).
- **Compliance legal argentino:** recibos con QR y matrícula RPA (Ley 941 CABA), RPAC/DDJJ (Ley 14.701 PBA), protección de datos personales (Ley 25.326), Código Civil arts. 2037–2072, sueldos de encargados según CCT 589/10 SUTERH.
- **Anonimización obligatoria** de datos en el módulo de Benchmarking (Fase 3).
