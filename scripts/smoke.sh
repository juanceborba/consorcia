#!/usr/bin/env bash
# scripts/smoke.sh — Smoke E2E de los slices S1+S2+S4 contra el stack dockerizado
# Flujo: health → login (admin y gestor) → listados de edificios → detalle
# con unidades → slice S2 (alta de edificio, bulk de unidades con invariante
# de coeficientes, PATCH, DELETE soft delete) → slice S4 (invitaciones, staff,
# residentes, cambio de organización) → casos del seed multi-caso (S4-10:
# segundo gestor, Org B aislada, residente multi-consorcio, invitación
# pendiente) → refresh (rotación) → logout.
# Cada paso imprime ✓/✗ y el script sale con 1 si algo falla. Lo que crea lo
# limpia al final (el edificio de prueba queda dado de baja con soft delete).
#
# Requisitos: stack levantado (`make up` + `make db-seed`) y `node` en el
# host (solo para parsear JSON). Configurable con BACKEND_URL (default
# http://localhost:3000, o el puerto de BACKEND_PORT del .env).

set -u

BASE_URL="${BACKEND_URL:-http://localhost:3000}"

PASOS_OK=0
PASOS_FAIL=0

ok()   { echo "  ✓ $1"; PASOS_OK=$((PASOS_OK + 1)); }
fail() { echo "  ✗ $1"; PASOS_FAIL=$((PASOS_FAIL + 1)); }

# check <descripción> <esperado> <actual>
check() {
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else fail "$1 (esperado $2, recibido $3)"; fi
}

# Parsea el JSON de stdin y evalúa una expresión JS sobre `d`.
json_eval() {
  node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);console.log($1)})"
}

# req <method> <path> [token] [payload] → deja el cuerpo en BODY y el status en STATUS
req() {
  local method="$1" path="$2" token="${3:-}" payload="${4:-}"
  local args=(-s -X "$method" -H 'Content-Type: application/json')
  [ -n "$token" ]   && args+=(-H "Authorization: Bearer $token")
  [ -n "$payload" ] && args+=(-d "$payload")
  local resp
  resp=$(curl "${args[@]}" -w $'\n%{http_code}' "$BASE_URL$path")
  STATUS=$(tail -n1 <<< "$resp")
  BODY=$(sed '$d' <<< "$resp")
}

echo "Smoke ConsorcIA (S1-14 + S2-12 + S4-02/03/04/05 + S4-10) contra $BASE_URL"
echo

# --- 1. Health ----------------------------------------------------------------
echo "1. Health"
req GET /health
check "GET /health → 200" 200 "$STATUS"

# --- 2. Login -----------------------------------------------------------------
echo "2. Login"
req POST /api/auth/login '' '{"email":"admin@demo.com","password":"demo1234"}'
check "login admin → 200" 200 "$STATUS"
ADMIN_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")
ADMIN_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")

req POST /api/auth/login '' '{"email":"gestor@demo.com","password":"demo1234"}'
check "login gestor → 200" 200 "$STATUS"
GESTOR_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")
GESTOR_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")

req POST /api/auth/login '' '{"email":"admin@demo.com","password":"incorrecta"}'
check "login con password incorrecta → 401" 401 "$STATUS"

req GET /api/edificios
check "GET /api/edificios sin token → 401" 401 "$STATUS"

# --- 3. Edificios ---------------------------------------------------------------
echo "3. Edificios"
req GET /api/edificios "$ADMIN_TOKEN"
check "GET /api/edificios (admin) → 200" 200 "$STATUS"
check "admin ve 2 edificios" 2 "$(json_eval 'd.length' <<< "$BODY")"
EDIFICIO_ID=$(json_eval 'd[0].id' <<< "$BODY")
EDIFICIO_NOMBRE=$(json_eval 'd[0].nombre' <<< "$BODY")

req GET /api/edificios "$GESTOR_TOKEN"
check "GET /api/edificios (gestor) → 200" 200 "$STATUS"
check "gestor ve 1 edificio" 1 "$(json_eval 'd.length' <<< "$BODY")"
check "el edificio del gestor es Torre Palermo" "Torre Palermo" "$(json_eval 'd[0].nombre' <<< "$BODY")"

req GET "/api/edificios/$EDIFICIO_ID" "$ADMIN_TOKEN"
check "GET /api/edificios/:id → 200" 200 "$STATUS"
UNIDAD_ID=$(json_eval 'd.unidades.length ? d.unidades[0].id : ""' <<< "$BODY")
UNIDADES=$(json_eval 'd.unidades.length' <<< "$BODY")
if [ "$UNIDADES" -gt 0 ] 2>/dev/null; then
  ok "detalle de $EDIFICIO_NOMBRE con $UNIDADES unidades"
else
  fail "detalle de $EDIFICIO_NOMBRE sin unidades"
fi

# --- 3.5 Slice S2: alta de edificio + unidades con invariante --------------
echo "3.5 Slice S2 (edificios + unidades)"
STAMP=$(date +%s)
NOMBRE_S2="Smoke S2 $STAMP"
S2_ID=""
S2_BORRADO=0

req POST /api/edificios "$GESTOR_TOKEN" '{"nombre":"Smoke S2 gestor","direccion":"Calle Falsa 123","codigoPostal":"1425","totalM2":100}'
check "gestor no puede crear edificio → 403" 403 "$STATUS"

req POST /api/edificios "$ADMIN_TOKEN" "{\"nombre\":\"$NOMBRE_S2\",\"direccion\":\"Av. Smoke 123\",\"codigoPostal\":\"C1425BGW\",\"tipo\":\"ph\",\"totalM2\":500}"
check "POST /api/edificios (admin) → 201" 201 "$STATUS"
if [ "$STATUS" = "201" ]; then
  S2_ID=$(json_eval 'd.id' <<< "$BODY")
fi

if [ -z "$S2_ID" ]; then
  fail "sin edificio de prueba: se saltean los chequeos de unidades"
else
  # Bulk que no cuadra (0.500000 + 0.400000 = 0.900000) → 422 con delta
  req POST "/api/edificios/$S2_ID/unidades" "$ADMIN_TOKEN" '[{"numero":"1A","tipo":"departamento","m2":80,"coeficiente":"0.500000"},{"numero":"1B","tipo":"departamento","m2":70,"coeficiente":"0.400000"}]'
  check "bulk que suma 0.900000 → 422" 422 "$STATUS"
  check "error COEFICIENTES_NO_CUADRAN" "COEFICIENTES_NO_CUADRAN" "$(json_eval 'd.error.code' <<< "$BODY")"
  check "el 422 informa el delta (0.100000)" "0.100000" "$(json_eval 'd.error.delta' <<< "$BODY")"

  # Bulk que cierra la invariante (suma 1.000000) → 201
  req POST "/api/edificios/$S2_ID/unidades" "$ADMIN_TOKEN" '[{"numero":"1A","tipo":"departamento","m2":80,"coeficiente":"0.300000"},{"numero":"1B","tipo":"departamento","m2":70,"coeficiente":"0.250000"},{"numero":"2A","tipo":"departamento","m2":65,"coeficiente":"0.200000"},{"numero":"2B","tipo":"departamento","m2":60,"coeficiente":"0.150000"},{"numero":"COCH","tipo":"cochera","m2":25,"coeficiente":"0.100000"}]'
  check "bulk que suma 1.000000 → 201" 201 "$STATUS"
  check "creó las 5 unidades" 5 "$(json_eval 'd.length' <<< "$BODY")"

  req GET "/api/edificios/$S2_ID/unidades?page=1&limit=100" "$ADMIN_TOKEN"
  check "GET unidades paginado → 200" 200 "$STATUS"
  check "la paginación reporta 5 unidades" 5 "$(json_eval 'd.pagination.total' <<< "$BODY")"

  req PATCH "/api/edificios/$S2_ID" "$ADMIN_TOKEN" "{\"nombre\":\"$NOMBRE_S2 (editado)\"}"
  check "PATCH /api/edificios/:id → 200" 200 "$STATUS"
  check "el PATCH aplicó el nuevo nombre" "$NOMBRE_S2 (editado)" "$(json_eval 'd.nombre' <<< "$BODY")"

  req DELETE "/api/edificios/$S2_ID" "$ADMIN_TOKEN"
  check "DELETE /api/edificios/:id (soft delete) → 204" 204 "$STATUS"
  [ "$STATUS" = "204" ] && S2_BORRADO=1

  req GET "/api/edificios/$S2_ID" "$ADMIN_TOKEN"
  check "GET del edificio dado de baja → 404" 404 "$STATUS"
fi

# --- 3.6 Slice S4 (invitaciones) ------------------------------------------------
# Los endpoints que CREAN invitaciones son de S4-03/04, así que el smoke la
# inserta con Prisma dentro del contenedor (igual que los tests) y después
# recorre el flujo público: GET → aceptar → login → segundo uso → 410.
echo "3.6 Slice S4 (invitaciones)"
if ! command -v docker >/dev/null 2>&1; then
  fail "docker no disponible: se saltean los chequeos de invitaciones"
else
  S4_EMAIL="smoke-invitado-$(date +%s)@test.dev"
  S4_TOKEN=$(docker exec consorcIA-backend node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    (async () => {
      const admin = await p.usuario.findUnique({ where: { email: 'admin@demo.com' } });
      // Membresía ACTIVA: el admin del seed puede arrastrar membresías
      // desactivadas de otras orgs (las que crea el spec E2E del selector).
      const m = await p.organizacionUsuario.findFirst({ where: { usuarioId: admin.id, activo: true } });
      const inv = await p.invitacion.create({ data: {
        email: '$S4_EMAIL', organizacionId: m.organizacionId, tipo: 'STAFF',
        payload: { rol: 'ORG_ADMIN', nombre: 'Smoke', apellido: 'Invitado', edificioIds: [] },
        expiraAt: new Date(Date.now() + 7 * 24 * 3600 * 1000), invitadoPorId: admin.id,
      } });
      console.log(inv.token);
      await p.\$disconnect();
    })();
  " 2>/dev/null | tr -d '\r')

  if [ -z "$S4_TOKEN" ]; then
    fail "no se pudo crear la invitación de prueba"
  else
    req GET "/api/invitaciones/$S4_TOKEN"
    check "GET /api/invitaciones/:token → 200" 200 "$STATUS"
    check "el email viaja enmascarado" "s***@test.dev" "$(json_eval 'd.email' <<< "$BODY")"

    req GET "/api/invitaciones/00000000-0000-0000-0000-000000000000"
    check "GET con token inexistente → 410" 410 "$STATUS"

    req POST "/api/invitaciones/$S4_TOKEN/aceptar" '' '{"password":"invitado1234","confirmacion":"invitado1234"}'
    check "POST /api/invitaciones/:token/aceptar → 200" 200 "$STATUS"
    check "la sesión trae el rol invitado" "org_admin" "$(json_eval 'd.user.roles[0]' <<< "$BODY")"
    S4_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")

    req POST /api/auth/login '' "{\"email\":\"$S4_EMAIL\",\"password\":\"invitado1234\"}"
    check "login del invitado activado → 200" 200 "$STATUS"
    S4_REFRESH_LOGIN=$(json_eval 'd.refreshToken' <<< "$BODY")

    req POST "/api/invitaciones/$S4_TOKEN/aceptar" '' '{"password":"invitado1234"}'
    check "segundo uso de la invitación → 410" 410 "$STATUS"

    # Limpieza: se cierran las sesiones y se borra el usuario invitado
    for r in "$S4_REFRESH" "${S4_REFRESH_LOGIN:-}"; do
      [ -n "$r" ] && req POST /api/auth/logout '' "{\"refreshToken\":\"$r\"}"
    done
    docker exec consorcIA-backend node -e "
      const { PrismaClient } = require('@prisma/client');
      const p = new PrismaClient();
      (async () => {
        await p.invitacion.deleteMany({ where: { email: '$S4_EMAIL' } });
        const u = await p.usuario.findUnique({ where: { email: '$S4_EMAIL' } });
        if (u) {
          await p.organizacionUsuario.deleteMany({ where: { usuarioId: u.id } });
          await p.usuario.delete({ where: { id: u.id } });
        }
        await p.\$disconnect();
      })();
    " >/dev/null 2>&1 || true
  fi
fi

# --- 3.7 Slice S4 (staff, residentes, cambio de organización) -------------------
# Recorre los tres endpoints nuevos con la API real (sin insertar en la DB):
# invitar staff → 409 de la segunda pendiente → activar → cambiar de org →
# vincular residente → desvincular. Todo lo creado se borra al final.
echo "3.7 Slice S4 (staff + residentes + cambio de org)"
S4B_EMAIL="smoke-staff-$(date +%s)@test.dev"
S4B_REFRESH=""

req POST /api/organizaciones/me/usuarios "$ADMIN_TOKEN" \
  "{\"email\":\"$S4B_EMAIL\",\"nombre\":\"Smoke\",\"apellido\":\"Staff\",\"rol\":\"GESTOR\",\"edificioIds\":[\"$EDIFICIO_ID\"]}"
check "POST /api/organizaciones/me/usuarios → 201" 201 "$STATUS"
S4B_URL=$(json_eval 'd.invitacionUrl' <<< "$BODY")
S4B_TOKEN_INV="${S4B_URL##*/}"
check "el alta devuelve el link de invitación" 1 "$(json_eval 'd.invitacionUrl.includes("/invitacion/") ? 1 : 0' <<< "$BODY")"
check "el email no se envía en el MVP" false "$(json_eval 'd.emailEnviado' <<< "$BODY")"

req GET /api/organizaciones/me/usuarios "$ADMIN_TOKEN"
check "GET /api/organizaciones/me/usuarios → 200" 200 "$STATUS"
check "el invitado aparece sin activar" false \
  "$(json_eval "String((d.find(m => m.email === '$S4B_EMAIL') || {}).cuentaActivada)" <<< "$BODY")"

req GET /api/organizaciones/me/usuarios "$GESTOR_TOKEN"
check "el gestor no ve el staff → 403" 403 "$STATUS"

req POST /api/organizaciones/me/usuarios "$ADMIN_TOKEN" \
  "{\"email\":\"$S4B_EMAIL\",\"nombre\":\"Smoke\",\"rol\":\"GESTOR\"}"
check "segunda invitación pendiente → 409" 409 "$STATUS"
check "código INVITACION_PENDIENTE" "INVITACION_PENDIENTE" "$(json_eval 'd.error.code' <<< "$BODY")"

req POST "/api/invitaciones/$S4B_TOKEN_INV/aceptar" '' '{"password":"smokestaff1234"}'
check "el invitado activa su cuenta → 200" 200 "$STATUS"
check "entra como gestor de la org" "gestor" "$(json_eval 'd.user.roles[0]' <<< "$BODY")"
S4B_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")
S4B_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")
S4B_ORG=$(json_eval 'd.user.organizacionId' <<< "$BODY")

# Cambio de organización: a la propia es una re-emisión válida; a una ajena, 403
req POST /api/auth/cambiar-organizacion "$S4B_TOKEN" \
  "{\"organizacionId\":\"$S4B_ORG\",\"refreshToken\":\"$S4B_REFRESH\"}"
check "POST /api/auth/cambiar-organizacion → 200" 200 "$STATUS"
check "la sesión queda en la org elegida" "$S4B_ORG" "$(json_eval 'd.user.organizacionId' <<< "$BODY")"
S4B_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")

req POST /api/auth/cambiar-organizacion "$S4B_TOKEN" \
  '{"organizacionId":"00000000-0000-0000-0000-000000000000"}'
check "cambiar a una org ajena → 403" 403 "$STATUS"
check "código SIN_MEMBRESIA" "SIN_MEMBRESIA" "$(json_eval 'd.error.code' <<< "$BODY")"

# Residentes de una UF
S4B_RESIDENTE="smoke-residente-$(date +%s)@test.dev"
if [ -z "$UNIDAD_ID" ]; then
  fail "sin unidades en $EDIFICIO_NOMBRE: se saltean los chequeos de residentes"
else
  req POST "/api/unidades/$UNIDAD_ID/residentes" "$ADMIN_TOKEN" \
    "{\"email\":\"$S4B_RESIDENTE\",\"nombre\":\"Smoke\",\"apellido\":\"Residente\",\"esPropietario\":true}"
  check "POST /api/unidades/:id/residentes → 201" 201 "$STATUS"
  S4B_VINCULO=$(json_eval 'd.vinculo.id' <<< "$BODY")
  check "el vínculo queda vigente" true "$(json_eval 'd.vinculo.vigente' <<< "$BODY")"

  req POST "/api/unidades/$UNIDAD_ID/residentes" "$ADMIN_TOKEN" \
    "{\"email\":\"$S4B_RESIDENTE\",\"nombre\":\"Smoke\",\"esInquilino\":true}"
  check "vínculo vigente duplicado → 409" 409 "$STATUS"
  check "código VINCULO_DUPLICADO" "VINCULO_DUPLICADO" "$(json_eval 'd.error.code' <<< "$BODY")"

  req GET "/api/unidades/$UNIDAD_ID/residentes" "$ADMIN_TOKEN"
  check "GET /api/unidades/:id/residentes → 200" 200 "$STATUS"
  check "el residente figura en la UF" 1 \
    "$(json_eval "d.filter(v => v.usuario.email === '$S4B_RESIDENTE').length" <<< "$BODY")"

  req DELETE "/api/unidades/$UNIDAD_ID/residentes/$S4B_VINCULO" "$ADMIN_TOKEN"
  check "DELETE residente (baja temporal) → 200" 200 "$STATUS"
  check "el vínculo queda no vigente con fechaFin" false "$(json_eval 'd.vigente' <<< "$BODY")"
fi

# Limpieza: se cierra la sesión y se borran las personas creadas
[ -n "$S4B_REFRESH" ] && req POST /api/auth/logout '' "{\"refreshToken\":\"$S4B_REFRESH\"}"
if command -v docker >/dev/null 2>&1; then
  docker exec consorcIA-backend node -e "
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    (async () => {
      const emails = ['$S4B_EMAIL', '$S4B_RESIDENTE'];
      await p.invitacion.deleteMany({ where: { email: { in: emails } } });
      const us = await p.usuario.findMany({ where: { email: { in: emails } } });
      const ids = us.map(u => u.id);
      await p.unidadUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
      await p.gestorEdificio.deleteMany({ where: { usuarioId: { in: ids } } });
      await p.organizacionUsuario.deleteMany({ where: { usuarioId: { in: ids } } });
      await p.usuario.deleteMany({ where: { id: { in: ids } } });
      await p.\$disconnect();
    })();
  " >/dev/null 2>&1 || fail "no se pudo limpiar el staff/residente de prueba"
else
  fail "docker no disponible: quedan sin borrar $S4B_EMAIL y $S4B_RESIDENTE"
fi

# --- 3.8 Casos del seed multi-caso (S4-10, PRD-04-11 §10) -----------------------
# Verifica por API los casos que el seed agrega: segundo gestor con ambos
# edificios, Org B aislada de Org A, residente multi-consorcio (un solo Usuario
# con UFs en las dos organizaciones) e invitación pendiente. No crea ni borra
# nada: son todos chequeos de lectura sobre datos del seed.
echo "3.8 Seed multi-caso (S4-10)"

# Caso 2: segundo gestor de Org A con AMBOS edificios asignados
req POST /api/auth/login '' '{"email":"gestor2@demo.com","password":"demo1234"}'
check "login gestor2 (segundo gestor de Org A) → 200" 200 "$STATUS"
GESTOR2_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")
GESTOR2_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")
check "gestor2 tiene los 2 edificios en los claims" 2 \
  "$(json_eval 'd.user.edificiosAsignados.length' <<< "$BODY")"

req GET /api/edificios "$GESTOR2_TOKEN"
check "gestor2 ve los 2 edificios del seed → 200" 200 "$STATUS"
check "gestor2 ve Torre Palermo y San Martín" 2 \
  "$(json_eval "d.filter(e => ['Torre Palermo','Edificio San Martín'].includes(e.nombre)).length" <<< "$BODY")"

# Caso 3: Org B con su propio org_admin, aislada de Org A
req POST /api/auth/login '' '{"email":"admin.sur@demo.com","password":"demo1234"}'
check "login admin de Org B → 200" 200 "$STATUS"
ORGB_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")
ORGB_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")

req GET /api/organizaciones/me "$ORGB_TOKEN"
check "la org activa del admin B es Administración Sur" "Administración Sur S.R.L." \
  "$(json_eval 'd.nombre' <<< "$BODY")"

req GET /api/edificios "$ORGB_TOKEN"
check "el admin B ve solo su edificio" 1 "$(json_eval 'd.length' <<< "$BODY")"
UNIDAD_ORGB=""
if [ "$(json_eval 'd.length' <<< "$BODY")" = "1" ]; then
  EDIFICIO_ORGB=$(json_eval 'd[0].id' <<< "$BODY")
  req GET "/api/edificios/$EDIFICIO_ORGB" "$ORGB_TOKEN"
  UNIDAD_ORGB=$(json_eval "(d.unidades.find(u => u.numero === '1A') || {}).id || ''" <<< "$BODY")
fi

req GET /api/organizaciones/me/usuarios "$ORGB_TOKEN"
check "GET staff de Org B → 200" 200 "$STATUS"
check "el staff de Org A no aparece en Org B" 0 \
  "$(json_eval "d.filter(m => ['admin@demo.com','gestor@demo.com','gestor2@demo.com'].includes(m.email)).length" <<< "$BODY")"
check "el staff de Org B es solo su org_admin" 1 "$(json_eval 'd.length' <<< "$BODY")"

req GET "/api/edificios/$EDIFICIO_ID" "$ORGB_TOKEN"
check "el admin B no accede a un edificio de Org A → 403" 403 "$STATUS"

# Caso 4: residente multi-consorcio — un solo Usuario, UFs en las dos orgs
req POST /api/auth/login '' '{"email":"multiconsorcio@demo.com","password":"demo1234"}'
check "login del residente multi-consorcio → 200" 200 "$STATUS"
check "es propietario" "propietario" "$(json_eval 'd.user.roles[0]' <<< "$BODY")"
# Residente puro: sin membresía staff no tiene organización activa (§5.5)
check "no tiene organización activa" null "$(json_eval 'String(d.user.organizacionId)' <<< "$BODY")"
check "no tiene membresías para el selector" 0 "$(json_eval 'd.user.organizaciones.length' <<< "$BODY")"
MULTI_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")

# Las UFs del seed con residentes están en Torre Palermo, que NO es
# necesariamente `$EDIFICIO_ID` (ese es el primero de la lista): se resuelve por
# nombre y su detalle se guarda una sola vez.
req GET /api/edificios "$ADMIN_TOKEN"
TORRE_ID=$(json_eval "(d.find(e => e.nombre === 'Torre Palermo') || {}).id || ''" <<< "$BODY")
TORRE_BODY=""
if [ -z "$TORRE_ID" ]; then
  fail "no se encontró Torre Palermo en la organización demo"
else
  req GET "/api/edificios/$TORRE_ID" "$ADMIN_TOKEN"
  TORRE_BODY="$BODY"
fi

# uf_de_torre <número> → id de esa UF de Torre Palermo ('' si no está)
uf_de_torre() {
  [ -z "$TORRE_BODY" ] && { echo ""; return; }
  json_eval "(d.unidades.find(u => u.numero === '$1') || {}).id || ''" <<< "$TORRE_BODY"
}

# Su UF en Org A la ve el admin de Org A; la de Org B, el admin de Org B.
UNIDAD_MULTI_A=$(uf_de_torre 2A)
if [ -z "$UNIDAD_MULTI_A" ]; then
  fail "no se encontró la UF 2A de Torre Palermo"
else
  req GET "/api/unidades/$UNIDAD_MULTI_A/residentes" "$ADMIN_TOKEN"
  check "el multi-consorcio figura en su UF de Org A" 1 \
    "$(json_eval "d.filter(v => v.usuario.email === 'multiconsorcio@demo.com' && v.vigente).length" <<< "$BODY")"
fi

if [ -z "$UNIDAD_ORGB" ] || [ -z "$UNIDAD_MULTI_A" ]; then
  fail "sin las dos UFs del multi-consorcio: se saltea el chequeo de identidad global"
else
  req GET "/api/unidades/$UNIDAD_ORGB/residentes" "$ORGB_TOKEN"
  check "el mismo email figura en su UF de Org B" 1 \
    "$(json_eval "d.filter(v => v.usuario.email === 'multiconsorcio@demo.com' && v.vigente).length" <<< "$BODY")"
  MULTI_ID_B=$(json_eval "(d.find(v => v.usuario.email === 'multiconsorcio@demo.com') || {usuario:{}}).usuario.id || ''" <<< "$BODY")

  # Identidad global: los dos vínculos apuntan al MISMO usuarioId
  req GET "/api/unidades/$UNIDAD_MULTI_A/residentes" "$ADMIN_TOKEN"
  MULTI_ID_A=$(json_eval "(d.find(v => v.usuario.email === 'multiconsorcio@demo.com') || {usuario:{}}).usuario.id || ''" <<< "$BODY")
  if [ -z "$MULTI_ID_A" ]; then
    fail "el multi-consorcio no tiene usuarioId en su UF de Org A"
  else
    check "las dos UFs apuntan al mismo Usuario global" "$MULTI_ID_A" "$MULTI_ID_B"
  fi
fi

# Caso 5: inquilino simple en una UF de Org A
UNIDAD_INQUILINO=$(uf_de_torre 1A)
if [ -n "$UNIDAD_INQUILINO" ]; then
  req GET "/api/unidades/$UNIDAD_INQUILINO/residentes" "$ADMIN_TOKEN"
  check "el inquilino del seed está vinculado como inquilino" 1 \
    "$(json_eval "d.filter(v => v.usuario.email === 'inquilino@demo.com' && v.esInquilino && v.vigente).length" <<< "$BODY")"
else
  fail "no se encontró la UF 1A de Torre Palermo"
fi

# Caso 6: propietario con 2 UFs en el mismo edificio
for UF in 3B 4B; do
  UNIDAD_P2=$(uf_de_torre "$UF")
  if [ -n "$UNIDAD_P2" ]; then
    req GET "/api/unidades/$UNIDAD_P2/residentes" "$ADMIN_TOKEN"
    check "propietario2 es propietario de la UF $UF" 1 \
      "$(json_eval "d.filter(v => v.usuario.email === 'propietario2@demo.com' && v.esPropietario && v.vigente).length" <<< "$BODY")"
  else
    fail "no se encontró la UF $UF de Torre Palermo"
  fi
done

# Caso 7: la invitación pendiente del seed sirve (no se acepta: es del demo)
req GET /api/invitaciones/seed-invitacion-pendiente
check "la invitación pendiente del seed → 200" 200 "$STATUS"
check "es una invitación de staff" STAFF "$(json_eval 'd.tipo' <<< "$BODY")"
check "apunta a la organización demo" "Administración Demo S.A." \
  "$(json_eval 'd.organizacion.nombre' <<< "$BODY")"

req POST /api/auth/login '' '{"email":"invitado@demo.com","password":"demo1234"}'
check "el invitado sin activar no puede loguear → 401" 401 "$STATUS"

# Residentes: sin membresía staff no entran a la nómina de la organización
req GET /api/organizaciones/me/usuarios "$ADMIN_TOKEN"
check "ningún residente del seed aparece como staff de Org A" 0 \
  "$(json_eval "d.filter(m => ['propietario1@demo.com','propietario2@demo.com','propietario3@demo.com','inquilino@demo.com','multiconsorcio@demo.com','encargado@demo.com'].includes(m.email)).length" <<< "$BODY")"

# Limpieza: se cierran las sesiones abiertas en esta sección
for r in "$GESTOR2_REFRESH" "$ORGB_REFRESH" "$MULTI_REFRESH"; do
  [ -n "$r" ] && req POST /api/auth/logout '' "{\"refreshToken\":\"$r\"}"
done

# --- Limpieza de seguridad -----------------------------------------------------
# Si algo falló antes del DELETE del slice S2, el edificio de prueba queda
# activo y rompería el chequeo "admin ve 2 edificios" de la próxima corrida.
if [ -n "${S2_ID:-}" ] && [ "$S2_BORRADO" = "0" ]; then
  req DELETE "/api/edificios/$S2_ID" "$ADMIN_TOKEN" >/dev/null 2>&1 || true
fi

# --- 4. Refresh (rotación) ------------------------------------------------------
echo "4. Refresh"
req POST /api/auth/refresh '' "{\"refreshToken\":\"$ADMIN_REFRESH\"}"
check "refresh → 200" 200 "$STATUS"
NUEVO_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")
NUEVO_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")

req POST /api/auth/refresh '' "{\"refreshToken\":\"$ADMIN_REFRESH\"}"
check "reuso del refresh viejo → 401" 401 "$STATUS"

req GET /api/edificios "$NUEVO_TOKEN"
check "GET /api/edificios con el nuevo access token → 200" 200 "$STATUS"

# --- 5. Logout ------------------------------------------------------------------
echo "5. Logout"
req POST /api/auth/logout '' "{\"refreshToken\":\"$NUEVO_REFRESH\"}"
check "logout → 204" 204 "$STATUS"

req POST /api/auth/refresh '' "{\"refreshToken\":\"$NUEVO_REFRESH\"}"
check "refresh después del logout → 401" 401 "$STATUS"

# Limpieza: la sesión del gestor también se cierra para no dejar tokens en Redis
req POST /api/auth/logout '' "{\"refreshToken\":\"$GESTOR_REFRESH\"}"
check "logout gestor → 204" 204 "$STATUS"

# --- Resultado ------------------------------------------------------------------
echo
if [ "$PASOS_FAIL" -gt 0 ]; then
  echo "SMOKE FALLÓ: $PASOS_FAIL paso(s) con error ($PASOS_OK OK)"
  exit 1
fi
echo "SMOKE OK: $PASOS_OK pasos en verde"
