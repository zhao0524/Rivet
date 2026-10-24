#!/usr/bin/env bash
# Local development in one command: loads env, then runs the API and the web app with
# labeled output. Ctrl-C (or any exit) stops every process it started.
#
#   bash scripts/dev.sh [all|api|web]       (pnpm dev | pnpm dev:api | pnpm dev:web)
#
# Env    scripts/load-env.sh: .env (.env.example while .env is encrypted or missing), then
#        .env.local; variables already set in your shell win. Only names are printed.
# Ports  RIVET_API_PORT (default 8000), RIVET_WEB_PORT (default 3000).
# API    `uv run` if uv is installed, else services/api/.venv/bin/python if it exists, else
#        python3. Live mode adds packages/engineering to PYTHONPATH when rivet_engine is not
#        installed. The openai vision provider needs OPENAI_API_KEY, RIVET_VISION_MODEL and
#        the openai package (the API's `live` extra); the script stops early without them.
# Web    `pnpm --filter web exec next dev`. NEXT_PUBLIC_RIVET_API_URL and
#        NEXT_PUBLIC_RIVET_USE_FIXTURES come from your env if set, else from RIVET_API_PORT
#        and RIVET_MODE. apps/web/.env.local is written only if it does not exist.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
API_DIR=$ROOT/services/api
WEB_ENV_FILE=$ROOT/apps/web/.env.local

say() { printf '[dev] %s\n' "$*" >&2 || true; }
die() {
  say "error: $*"
  exit 1
}
usage() { sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

target=${1:-all}
case $target in
  all | api | web) ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

cd "$ROOT"
# shellcheck source=scripts/load-env.sh
. "$ROOT/scripts/load-env.sh"

check_port() { # check_port NAME VALUE
  case $2 in "" | *[!0-9]*) die "$1 must be a port number" ;; esac
  if [ "${#2}" -gt 5 ] || [ "$2" -lt 1 ] || [ "$2" -gt 65535 ]; then
    die "$1 must be between 1 and 65535"
  fi
}
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

mode=${RIVET_MODE:-fixture}
case $mode in fixture | live) ;; *) die "RIVET_MODE must be fixture or live" ;; esac
api_port=${RIVET_API_PORT:-8000}
web_port=${RIVET_WEB_PORT:-3000}
check_port RIVET_API_PORT "$api_port"
check_port RIVET_WEB_PORT "$web_port"
if [ "$target" = all ] && [ "$api_port" = "$web_port" ]; then
  die "RIVET_API_PORT and RIVET_WEB_PORT must differ"
fi

# The web app's two settings: your env wins, else they follow the API port and the mode.
derived_api_url=http://localhost:$api_port
if [ "$mode" = fixture ]; then derived_fixtures=true; else derived_fixtures=false; fi
web_api_url=${NEXT_PUBLIC_RIVET_API_URL:-$derived_api_url}
web_fixtures=${NEXT_PUBLIC_RIVET_USE_FIXTURES:-$derived_fixtures}

# ---------------------------------------------------------------- preflight: API
py=()
py_name=""
engine_dir=""
py_ok() { (cd "$API_DIR" && "${py[@]}" -c "$1") >/dev/null 2>&1; }

prepare_api() {
  local live_hint
  if command -v uv >/dev/null 2>&1; then
    py=(uv run)
    if [ "${RIVET_VISION_PROVIDER:-mock}" = openai ]; then py+=(--extra live); fi
    py+=(python)
    py_name="uv run"
    live_hint="cd services/api && uv sync --extra live"
  elif [ -x "$API_DIR/.venv/bin/python" ]; then
    py=("$API_DIR/.venv/bin/python")
    py_name="services/api/.venv"
    live_hint="services/api/.venv/bin/pip install -e 'services/api[live]'"
  elif command -v python3 >/dev/null 2>&1; then
    py=(python3)
    py_name="python3"
    live_hint="pip install -e 'services/api[live]' (in the Python that runs the API)"
  else
    die "Python 3.11+ not found; install it (or uv)"
  fi
  say "checking the API's Python environment ($py_name)"
  py_ok 'import sys; sys.exit(sys.version_info < (3, 11))' ||
    die "the API needs Python 3.11+ ($py_name is older or does not run)"
  py_ok 'import fastapi, uvicorn' ||
    die "the API's dependencies are missing for $py_name; install them: python3 -m venv services/api/.venv && services/api/.venv/bin/pip install -e 'services/api[dev]' (or install uv)"

  if [ "$mode" = live ] && ! py_ok 'import rivet_engine'; then
    export PYTHONPATH="$ROOT/packages/engineering${PYTHONPATH:+:$PYTHONPATH}"
    if py_ok 'import rivet_engine'; then
      engine_dir=$ROOT/packages/engineering/rivet_engine
      say "live: rivet_engine is not installed; using packages/engineering through PYTHONPATH"
    else
      say "warning: rivet_engine cannot be imported; live generation will fall back to the saved fixture (labeled fallback)"
    fi
  fi

  case ${RIVET_VISION_PROVIDER:-mock} in
    openai)
      [ -n "${RIVET_VISION_MODEL:-}" ] ||
        die "RIVET_VISION_PROVIDER=openai needs RIVET_VISION_MODEL (for example gpt-4o); set it in .env.local"
      [ -n "${OPENAI_API_KEY:-}" ] ||
        die "RIVET_VISION_PROVIDER=openai needs OPENAI_API_KEY; put your key in .env.local at the repo root (gitignored), never in .env"
      py_ok 'import openai' ||
        die "RIVET_VISION_PROVIDER=openai needs the openai package (the API's live extra), which $py_name cannot import; install it: $live_hint"
      ;;
    backboard)
      say "warning: the backboard vision provider is unsupported for the demo (its image input is unverified); use openai"
      ;;
  esac

  if port_in_use "$api_port"; then
    die "port $api_port is already in use; stop that process or set RIVET_API_PORT"
  fi
}

# ---------------------------------------------------------------- preflight: web
write_web_env_file() {
  if [ -e "$WEB_ENV_FILE" ] || [ -L "$WEB_ENV_FILE" ]; then
    say "apps/web/.env.local exists; left unchanged"
    return 0
  fi
  if (
    set -o noclobber
    {
      echo "# Written by scripts/dev.sh because this file was missing; it never overwrites it."
      echo "# Next.js reads env files only from apps/web/. pnpm dev passes these two settings"
      echo "# itself, so this file matters when the web app runs on its own."
      echo "NEXT_PUBLIC_RIVET_API_URL=$web_api_url"
      echo "NEXT_PUBLIC_RIVET_USE_FIXTURES=$web_fixtures"
    } >"$WEB_ENV_FILE"
  ) 2>/dev/null; then
    say "wrote apps/web/.env.local (NEXT_PUBLIC_RIVET_API_URL, NEXT_PUBLIC_RIVET_USE_FIXTURES)"
  else
    say "warning: could not write apps/web/.env.local"
  fi
}

prepare_web() {
  local origin="derived from RIVET_API_PORT and RIVET_MODE"
  command -v pnpm >/dev/null 2>&1 || die "pnpm not found; install Node.js 20+ and run: corepack enable"
  [ -d "$ROOT/apps/web/node_modules" ] || die "the web app's dependencies are missing; run: pnpm install"
  if port_in_use "$web_port"; then
    die "port $web_port is already in use; stop that process or set RIVET_WEB_PORT"
  fi
  if [ -n "${NEXT_PUBLIC_RIVET_API_URL:-}${NEXT_PUBLIC_RIVET_USE_FIXTURES:-}" ]; then
    origin="taken from your env where set, else derived from RIVET_API_PORT and RIVET_MODE"
  fi
  say "web: NEXT_PUBLIC_RIVET_API_URL and NEXT_PUBLIC_RIVET_USE_FIXTURES $origin"
  if [ "$target" = all ] && [ "${web_api_url%/}" != "$derived_api_url" ] &&
    [ "${web_api_url%/}" != "http://127.0.0.1:$api_port" ]; then
    say "warning: NEXT_PUBLIC_RIVET_API_URL does not point at the API started here (port $api_port)"
  fi
  if [ "$mode" = live ] && [ "$web_fixtures" != false ]; then
    say "warning: NEXT_PUBLIC_RIVET_USE_FIXTURES keeps the studio on its built-in fixtures in live mode; switch to Live API in the studio header"
  fi
  write_web_env_file
}

# ---------------------------------------------------------------- process control
api_pid=""
web_pid=""
started_pid=""

prefix_lines() {
  trap '' INT TERM # outlive the service so its last lines still get printed
  awk -v p="[$1] " '{ print p $0; fflush() }'
}

run_labeled() { # run_labeled LABEL DIR CMD...
  local label=$1
  cd "$2"
  shift 2
  trap 'exit 143' TERM # leave quietly when stop_job signals the group
  exec 2>/dev/null     # keep bash's own job notices out of the output
  "$@" </dev/null 2>&1 | prefix_lines "$label"
}

# Starts CMD in DIR as its own process group (job control on), so stop_job can end the
# whole tree, including Next's and uvicorn's child processes.
start() { # start LABEL DIR CMD...
  set -m
  run_labeled "$@" &
  started_pid=$!
  set +m
}

descendants() {
  local child
  echo "$1"
  for child in $(pgrep -P "$1" 2>/dev/null); do descendants "$child"; done
}

any_alive() { # any_alive PGID [PID...]
  local p
  if kill -0 -- "-$1" 2>/dev/null; then return 0; fi
  for p in "${@:2}"; do
    if kill -0 "$p" 2>/dev/null; then return 0; fi
  done
  return 1
}

# TERM to the job's process group and to every descendant (in case one left the group),
# up to 10 s for a clean exit, then KILL whatever is left.
stop_job() { # stop_job PID LABEL
  local pid=$1 label=$2 pids i
  [ -n "$pid" ] || return 0
  read -r -a pids <<<"$(descendants "$pid" | tr '\n' ' ')"
  kill -TERM -- "-$pid" "${pids[@]}" 2>/dev/null
  for ((i = 0; i < 100; i++)); do
    any_alive "$pid" "${pids[@]}" || break
    sleep 0.1
  done
  if any_alive "$pid" "${pids[@]}"; then
    say "$label did not stop within 10 s; killing it"
    kill -KILL -- "-$pid" "${pids[@]}" 2>/dev/null
    sleep 0.2
  fi
  wait "$pid" 2>/dev/null
  return 0
}

cleanup() {
  local status=$?
  trap - EXIT
  trap 'say "still stopping"' INT TERM HUP
  trap '' PIPE
  set +e
  if [ -n "$api_pid$web_pid" ]; then
    say "stopping"
    stop_job "$web_pid" web
    stop_job "$api_pid" api
    say "stopped"
  fi
  exit "$status"
}

exit_if_gone() { # exit_if_gone PID LABEL
  local status
  if [ -n "$1" ] && ! kill -0 "$1" 2>/dev/null; then
    if wait "$1"; then status=0; else status=$?; fi
    say "$2 exited (status $status); stopping the rest"
    if [ "$status" -eq 0 ]; then status=1; fi
    exit "$status"
  fi
}

# ---------------------------------------------------------------- main
if [ "$target" != web ]; then prepare_api; fi
if [ "$target" != api ]; then prepare_web; fi

trap cleanup EXIT
trap 'exit 0' INT TERM HUP # a requested stop is a normal end; a service that dies exits non-zero

if [ "$target" != web ]; then
  api_cmd=(env PYTHONUNBUFFERED=1 "${py[@]}" -m uvicorn rivet_api.main:app
    --port "$api_port" --reload --reload-dir "$API_DIR/rivet_api")
  if [ -n "$engine_dir" ]; then api_cmd+=(--reload-dir "$engine_dir"); fi
  start api "$API_DIR" "${api_cmd[@]}"
  api_pid=$started_pid
  say "API     http://localhost:$api_port/api/health   (RIVET_MODE=$mode, $py_name)"
fi
if [ "$target" != api ]; then
  web_cmd=(env)
  for key in $rivet_env_server_only_keys; do web_cmd+=(-u "$key"); done
  web_cmd+=("NEXT_PUBLIC_RIVET_API_URL=$web_api_url" "NEXT_PUBLIC_RIVET_USE_FIXTURES=$web_fixtures"
    pnpm --filter web exec next dev --port "$web_port")
  start web "$ROOT" "${web_cmd[@]}"
  web_pid=$started_pid
  say "studio  http://localhost:$web_port/studio"
fi
say "Ctrl-C stops everything"

while :; do
  exit_if_gone "$api_pid" api
  exit_if_gone "$web_pid" web
  sleep 1
done
