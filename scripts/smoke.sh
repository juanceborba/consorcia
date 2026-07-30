#!/usr/bin/env bash
# scripts/smoke.sh — Smoke E2E de los slices S1+S2+S3+S4 contra el stack dockerizado
# Flujo: health → login (admin y gestor) → listados de edificios → detalle
# con unidades → slice S2 (alta de edificio, bulk de unidades con invariante
# de coeficientes, PATCH, DELETE soft delete) → slice S4 (invitaciones, staff,
# residentes, cambio de organización) → casos del seed multi-caso (S4-10:
# segundo gestor, Org B aislada, residente multi-consorcio, invitación
# pendiente) → dashboard de gastos (S3-15/S3-16: los dos alcances, la exclusión
# de los modos de período y los tres 403 distinguibles) → refresh (rotación) →
# logout.
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

echo "Smoke ConsorcIA (S1-14 + S2-12 + S3-17 + S4-02/03/04/05 + S4-10) contra $BASE_URL"
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
  # Carga incremental (#57): un lote que no cuadra se GUARDA e informa el delta
  # (antes era 422 COEFICIENTES_NO_CUADRAN — la invariante es informativa y su
  # gate duro se movió a la liquidación de S3).
  req POST "/api/edificios/$S2_ID/unidades" "$ADMIN_TOKEN" '[{"numero":"1A","tipo":"departamento","m2":80,"coeficiente":"0.500000"},{"numero":"1B","tipo":"departamento","m2":70,"coeficiente":"0.400000"}]'
  check "bulk que suma 0.900000 → 201 (guarda igual)" 201 "$STATUS"
  check "creó las 2 unidades del lote parcial" 2 "$(json_eval 'd.unidades.length' <<< "$BODY")"
  check "informa la suma parcial (0.900000)" "0.900000" "$(json_eval 'd.coeficientes.suma' <<< "$BODY")"
  check "informa el delta (0.100000)" "0.100000" "$(json_eval 'd.coeficientes.delta' <<< "$BODY")"
  check "informa que no cuadra" "false" "$(json_eval 'd.coeficientes.cuadra' <<< "$BODY")"

  # Segundo lote que completa la suma en 1.000000 → 201 y cuadra
  req POST "/api/edificios/$S2_ID/unidades" "$ADMIN_TOKEN" '[{"numero":"2A","tipo":"departamento","m2":65,"coeficiente":"0.060000"},{"numero":"2B","tipo":"departamento","m2":60,"coeficiente":"0.030000"},{"numero":"COCH","tipo":"cochera","m2":25,"coeficiente":"0.010000"}]'
  check "segundo lote → 201" 201 "$STATUS"
  check "creó las 3 unidades restantes" 3 "$(json_eval 'd.unidades.length' <<< "$BODY")"
  check "la suma llegó a 1.000000" "1.000000" "$(json_eval 'd.coeficientes.suma' <<< "$BODY")"
  check "informa que cuadra" "true" "$(json_eval 'd.coeficientes.cuadra' <<< "$BODY")"

  req GET "/api/edificios/$S2_ID/unidades?page=1&limit=100" "$ADMIN_TOKEN"
  check "GET unidades paginado → 200" 200 "$STATUS"
  check "la paginación reporta 5 unidades" 5 "$(json_eval 'd.pagination.total' <<< "$BODY")"
  check "el listado informa la suma de coeficientes" "1.000000" "$(json_eval 'd.coeficientes.suma' <<< "$BODY")"

  LISTADO_S2="$BODY"

  # DELETE de una UF descuadra el edificio: se elimina igual e informa (#57)
  UF_COCH=$(json_eval 'd.data.find(u => u.numero === "COCH").id' <<< "$LISTADO_S2")
  req DELETE "/api/unidades/$UF_COCH" "$ADMIN_TOKEN"
  check "DELETE de UF que descuadra → 200 (guarda igual)" 200 "$STATUS"
  check "el DELETE informa la suma resultante (0.990000)" "0.990000" "$(json_eval 'd.coeficientes.suma' <<< "$BODY")"

  # PATCH de coeficiente que vuelve a cuadrar el edificio
  UF_2B=$(json_eval 'd.data.find(u => u.numero === "2B").id' <<< "$LISTADO_S2")
  req PATCH "/api/unidades/$UF_2B" "$ADMIN_TOKEN" '{"coeficiente":"0.040000"}'
  check "PATCH de coeficiente → 200" 200 "$STATUS"
  check "el PATCH informa que la suma volvió a cuadrar" "true" "$(json_eval 'd.coeficientes.cuadra' <<< "$BODY")"

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
# Su org_admin + el staff multi-organización del caso 8 (S4-11)
check "el staff de Org B son sus 2 miembros" 2 "$(json_eval 'd.length' <<< "$BODY")"

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

# Caso 8 (S4-11 / QA-02): staff con membresía activa en las DOS organizaciones,
# que es la precondición del selector de organización del header.
req POST /api/auth/login '' '{"email":"multiorg@demo.com","password":"demo1234"}'
check "login del staff multi-organización → 200" 200 "$STATUS"
check "tiene 2 membresías para el selector" 2 "$(json_eval 'd.user.organizaciones.length' <<< "$BODY")"
check "arranca en la primera alfabética (Org A) como gestor" "gestor" \
  "$(json_eval 'd.user.roles[0]' <<< "$BODY")"
MULTIORG_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")
MULTIORG_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")
MULTIORG_ORGB=$(json_eval "(d.user.organizaciones.find(o => o.rol === 'org_admin') || {}).id || ''" <<< "$BODY")

req POST /api/auth/cambiar-organizacion "$MULTIORG_TOKEN" \
  "{\"organizacionId\":\"$MULTIORG_ORGB\",\"refreshToken\":\"$MULTIORG_REFRESH\"}"
check "cambia a su otra organización → 200" 200 "$STATUS"
check "en la otra org es org_admin" "org_admin" "$(json_eval 'd.user.roles[0]' <<< "$BODY")"
MULTIORG_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")
MULTIORG_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")

req GET /api/organizaciones/me "$MULTIORG_TOKEN"
check "y ve la organización elegida" "Administración Sur S.R.L." "$(json_eval 'd.nombre' <<< "$BODY")"

# Residentes: sin membresía staff no entran a la nómina de la organización
req GET /api/organizaciones/me/usuarios "$ADMIN_TOKEN"
check "ningún residente del seed aparece como staff de Org A" 0 \
  "$(json_eval "d.filter(m => ['propietario1@demo.com','propietario2@demo.com','propietario3@demo.com','inquilino@demo.com','multiconsorcio@demo.com','encargado@demo.com'].includes(m.email)).length" <<< "$BODY")"

# --- 3.9 Acceso de lectura del residente (S4-12, #58) --------------------------
# El residente puro no tiene organización activa: el backoffice le responde 403
# y su contexto sale de sus vínculos (GET /api/me/unidades).
echo "3.9 Slice S4-12 (acceso del residente)"

req POST /api/auth/login '' '{"email":"inquilino@demo.com","password":"demo1234"}'
check "login del residente puro → 200" 200 "$STATUS"
check "no trae organización activa" "null" "$(json_eval 'JSON.stringify(d.user.organizacionId)' <<< "$BODY")"
RESIDENTE_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")
RESIDENTE_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")

req GET /api/edificios "$RESIDENTE_TOKEN"
check "el backoffice le responde 403 → SIN_ORGANIZACION_ACTIVA" 403 "$STATUS"
check "con el código del contrato" "SIN_ORGANIZACION_ACTIVA" "$(json_eval 'd.error.code' <<< "$BODY")"

req GET /api/me/unidades "$RESIDENTE_TOKEN"
check "GET /api/me/unidades → 200" 200 "$STATUS"
check "ve su única UF vigente" 1 "$(json_eval 'd.length' <<< "$BODY")"
check "con el edificio donde es inquilino" "Torre Palermo" "$(json_eval 'd[0].edificio.nombre' <<< "$BODY")"
check "y la administración que lo administra" "Administración Demo S.A." \
  "$(json_eval 'd[0].organizacion.nombre' <<< "$BODY")"
check "el vínculo dice inquilino, no propietario" "true false" \
  "$(json_eval 'd[0].esInquilino + " " + d[0].esPropietario' <<< "$BODY")"

req GET /api/me/unidades
check "sin token → 401" 401 "$STATUS"

# Multi-consorcio: el endpoint agrega por usuarioId y cruza organizaciones
req POST /api/auth/login '' '{"email":"multiconsorcio@demo.com","password":"demo1234"}'
MULTI58_TOKEN=$(json_eval 'd.accessToken' <<< "$BODY")
MULTI58_REFRESH=$(json_eval 'd.refreshToken' <<< "$BODY")
req GET /api/me/unidades "$MULTI58_TOKEN"
check "el residente multi-consorcio ve sus 2 UFs" 2 "$(json_eval 'd.length' <<< "$BODY")"
check "de 2 organizaciones distintas" 2 \
  "$(json_eval 'new Set(d.map(v => v.organizacion.id)).size' <<< "$BODY")"

# Limpieza: se cierran las sesiones abiertas en esta sección
for r in "$GESTOR2_REFRESH" "$ORGB_REFRESH" "$MULTI_REFRESH" "${MULTIORG_REFRESH:-}" \
         "${RESIDENTE_REFRESH:-}" "${MULTI58_REFRESH:-}"; do
  [ -n "$r" ] && req POST /api/auth/logout '' "{\"refreshToken\":\"$r\"}"
done

# --- 3.10 Dashboard de gastos (S3-15/S3-16, PRD-04-02 §3.4) --------------------
# Los dos alcances del MISMO agregado: el del edificio (`gasto:read`, lo ve
# también el gestor de ese edificio) y el consolidado de la organización, que es
# de org_admin y Business+. Lo que se verifica acá y no en los tests unitarios es
# el contrato tal como lo consume el frontend: la reconciliación de los KPIs, la
# exclusión de los modos de período y los tres 403 distinguibles.
echo "3.10 Dashboard de gastos (S3-15/S3-16)"

req GET "/api/edificios/$EDIFICIO_ID/gastos/dashboard" "$ADMIN_TOKEN"
check "GET dashboard del edificio (admin) → 200" 200 "$STATUS"
check "sin params, el modo es todo el histórico" "todo" \
  "$(json_eval 'd.filtro.modo' <<< "$BODY")"
# Cero tolerancia, igual que en la liquidación: los subtotales de los KPIs suman
# el total al centavo (si no, la pantalla se contradice con su propia tabla).
check "total = ordinarias + extraordinarias (al centavo)" "true" \
  "$(json_eval '(Number(d.kpis.totalOrdinarias) + Number(d.kpis.totalExtraordinarias)).toFixed(2) === Number(d.kpis.total).toFixed(2)' <<< "$BODY")"
# En modo histórico la serie sale de los meses que tienen gasto; los 12 puntos
# fijos (incluidos los vacíos) son del modo período, que es el que grafica la
# ventana móvil del selector.
check "la evolución mensual es una serie" "true" \
  "$(json_eval 'Array.isArray(d.evolucionMensual)' <<< "$BODY")"
check "el alcance declara sus unidades" "true" \
  "$(json_eval 'd.filtro.unidades > 0' <<< "$BODY")"
# Decisión 6 de §3.4: el rollup a rubro raíz llega hecho del backend.
check "porRubro viene rolleado a rubro raíz con sus subrubros" "true" \
  "$(json_eval 'd.porRubro.every(r => Array.isArray(r.subrubros))' <<< "$BODY")"

req GET "/api/edificios/$EDIFICIO_ID/gastos/dashboard?todo=1" "$ADMIN_TOKEN"
check "?todo=1 → modo todo" "todo" "$(json_eval 'd.filtro.modo' <<< "$BODY")"

PERIODO_HOY=$(node -e 'console.log(new Date().toISOString().slice(0,7))')
req GET "/api/edificios/$EDIFICIO_ID/gastos/dashboard?periodo=$PERIODO_HOY" "$ADMIN_TOKEN"
check "?periodo=$PERIODO_HOY → modo periodo" "periodo" "$(json_eval 'd.filtro.modo' <<< "$BODY")"
check "en modo período la evolución trae los 12 meses de la ventana" 12 \
  "$(json_eval 'd.evolucionMensual.length' <<< "$BODY")"

# Precisión 2 de §3.4: los tres modos son excluyentes. El frontend lo garantiza
# en `useFiltrosGastos`; el contrato lo rechaza igual.
req GET "/api/edificios/$EDIFICIO_ID/gastos/dashboard?periodo=$PERIODO_HOY&todo=1" "$ADMIN_TOKEN"
check "período + todo=1 → 422" 422 "$STATUS"
check "con el código del contrato" "VALIDACION_FALLIDA" "$(json_eval 'd.error.code' <<< "$BODY")"

req GET "/api/edificios/$EDIFICIO_ID/gastos/dashboard?periodo=$PERIODO_HOY&desde=2026-01-01" "$ADMIN_TOKEN"
check "período + rango → 422" 422 "$STATUS"

req GET "/api/edificios/$EDIFICIO_ID/gastos/dashboard"
check "dashboard sin token → 401" 401 "$STATUS"

# El gestor lee el dashboard de SU edificio (mismo permiso que la lista): el id
# sale de SU listado, que es el único edificio que tiene asignado.
req GET /api/edificios "$GESTOR_TOKEN"
EDIFICIO_GESTOR=$(json_eval 'd[0].id' <<< "$BODY")
req GET "/api/edificios/$EDIFICIO_GESTOR/gastos/dashboard" "$GESTOR_TOKEN"
check "dashboard del edificio asignado (gestor) → 200" 200 "$STATUS"

# Consolidado: Org A está en plan business (el seed lo deja así a propósito).
req GET "/api/organizaciones/me/gastos/dashboard" "$ADMIN_TOKEN"
check "GET consolidado de la organización (admin, business) → 200" 200 "$STATUS"
check "abarca los 2 edificios activos de la org" 2 \
  "$(json_eval 'd.filtro.edificios.length' <<< "$BODY")"
check "y sus KPIs también reconcilian" "true" \
  "$(json_eval '(Number(d.kpis.totalOrdinarias) + Number(d.kpis.totalExtraordinarias)).toFixed(2) === Number(d.kpis.total).toFixed(2)' <<< "$BODY")"

# …pero NO el consolidado: "todos los edificios" es la vista del administrador
# (decisión 2 de la ruta). Cerbos responde antes que el gate de plan.
req GET "/api/organizaciones/me/gastos/dashboard" "$GESTOR_TOKEN"
check "consolidado (gestor) → 403" 403 "$STATUS"
check "por rol, no por plan" "ACCESO_DENEGADO" "$(json_eval 'd.error.code' <<< "$BODY")"

# Org B es starter: el consolidado es Business+ y el error dice qué falta.
req GET "/api/organizaciones/me/gastos/dashboard" "$ORGB_TOKEN"
check "consolidado (org_admin de Org B, starter) → 403" 403 "$STATUS"
check "por plan insuficiente" "PLAN_INSUFICIENTE" "$(json_eval 'd.error.code' <<< "$BODY")"
check "y el error trae los dos planes para el copy" "starter business" \
  "$(json_eval 'd.error.planActual + " " + d.error.planRequerido' <<< "$BODY")"

# El tenant sale del JWT: el id del path es una aserción que se verifica.
req GET "/api/organizaciones/00000000-0000-0000-0000-000000000000/gastos/dashboard" "$ADMIN_TOKEN"
check "consolidado de otra organización → 403" 403 "$STATUS"
check "con FUERA_DE_ORGANIZACION" "FUERA_DE_ORGANIZACION" "$(json_eval 'd.error.code' <<< "$BODY")"

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
