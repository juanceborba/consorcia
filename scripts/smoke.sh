#!/usr/bin/env bash
# scripts/smoke.sh — Smoke E2E de los slices S1+S2+S4 contra el stack dockerizado
# Flujo: health → login (admin y gestor) → listados de edificios → detalle
# con unidades → slice S2 (alta de edificio, bulk de unidades con invariante
# de coeficientes, PATCH, DELETE soft delete) → refresh (rotación) → logout.
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

echo "Smoke ConsorcIA (S1-14 + S2-12 + S4-02) contra $BASE_URL"
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
      const m = await p.organizacionUsuario.findFirst({ where: { usuarioId: admin.id } });
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
