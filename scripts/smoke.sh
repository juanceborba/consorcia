#!/usr/bin/env bash
# scripts/smoke.sh — Smoke E2E del slice S1 contra el stack dockerizado (S1-14)
# Flujo: health → login (admin y gestor) → listados de edificios → detalle
# con unidades → refresh (rotación) → logout. Cada paso imprime ✓/✗ y el
# script sale con 1 si algo falla.
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

echo "Smoke ConsorcIA (S1-14) contra $BASE_URL"
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
