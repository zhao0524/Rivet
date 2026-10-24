#!/usr/bin/env bash
# Loads the repo's env files for local development. Prints variable NAMES, never values.
#
#   . scripts/load-env.sh                    from bash: load into the current shell (exported)
#   bash scripts/load-env.sh [--web] CMD...  load, then run CMD (the root package.json does this)
#   bash scripts/load-env.sh                 only report what would be loaded
#
# Order: .env (shared, committed encrypted with git-crypt), then .env.local (personal,
# gitignored). A later file wins, and a variable already set in your environment wins over
# both. While .env is still encrypted (no key unlocked) or missing, .env.example is loaded
# in its place. --web leaves out the server-only keys (the web app never needs them).
#
# Lines are read as data, never executed: KEY=value with optional `export`, '...' or "..."
# quotes and a trailing ` # comment`. A value the shell would expand or split ($, `, \,
# unquoted spaces or ;&|<>(), several lines) is skipped with a warning that names the key.

rivet_env_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
rivet_env_server_only_keys="OPENAI_API_KEY BACKBOARD_API_KEY"

_rivet_env_say() { printf '[env] %s\n' "$*" >&2 || true; }

# git-crypt writes encrypted files with a "\0GITCRYPT\0" header (scripts/setup-env.sh checks the same).
_rivet_env_is_encrypted() {
  [ "$(head -c 10 "$1" 2>/dev/null | LC_ALL=C tr -d '\000')" = "GITCRYPT" ]
}

# Parses the text after "=" into _rivet_env_val; returns 1 if the shell would expand it or
# continue it on the next line.
_rivet_env_parse() {
  local raw=$1 rest
  case $raw in
    "'"*)
      rest=${raw#?}
      case $rest in *"'"*) ;; *) return 1 ;; esac
      _rivet_env_val=${rest%%"'"*}
      rest=${rest#*"'"}
      ;;
    '"'*)
      rest=${raw#?}
      case $rest in *'"'*) ;; *) return 1 ;; esac
      _rivet_env_val=${rest%%'"'*}
      rest=${rest#*'"'}
      case $_rivet_env_val in *[\\\$\`]*) return 1 ;; esac
      ;;
    *)
      _rivet_env_val=${raw%%[[:space:]]*}
      rest=${raw#"$_rivet_env_val"}
      case $_rivet_env_val in *[\"\'\`\$\\\;\&\|\<\>\(\)]*) return 1 ;; esac
      case $_rivet_env_val in "~" | "~/"*) _rivet_env_val=$HOME${_rivet_env_val#"~"} ;; esac
      ;;
  esac
  rest=${rest#"${rest%%[![:space:]]*}"}
  case $rest in "" | "#"*) return 0 ;; *) return 1 ;; esac
}

# Loads one file (path relative to the repo root) and reports the names it set.
_rivet_env_load_file() {
  local file=$1 line name lineno=0 loaded="" kept=""
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    line=${line%$'\r'}
    line=${line#"${line%%[![:space:]]*}"}
    case $line in "" | "#"*) continue ;; esac
    case $line in export[[:space:]]*)
      line=${line#export}
      line=${line#"${line%%[![:space:]]*}"}
      ;;
    esac
    name=${line%%=*}
    case $name in
      "$line" | "" | [0-9]* | *[!A-Za-z0-9_]*)
        _rivet_env_say "$file:$lineno: not a KEY=value line; skipped"
        continue
        ;;
    esac
    if ! _rivet_env_parse "${line#*=}"; then
      _rivet_env_say "$file:$lineno: skipped $name (unsupported value syntax; single-quote a literal value)"
      continue
    fi
    case $_rivet_env_keep in *" $name "*)
      case " $kept " in *" $name "*) ;; *) kept="$kept $name" ;; esac
      continue
      ;;
    esac
    if ! export "$name=$_rivet_env_val" 2>/dev/null; then
      _rivet_env_say "$file:$lineno: could not set $name; skipped"
      continue
    fi
    case " $loaded " in *" $name "*) ;; *) loaded="$loaded $name" ;; esac
  done <"$rivet_env_root/$file"
  _rivet_env_say "$file:${loaded:- (no variables)}"
  if [ -n "$kept" ]; then
    _rivet_env_say "  already set in your environment, kept:$kept"
  fi
  return 0
}

rivet_load_env() {
  local n base=.env
  # Non-empty variables set before loading win over every file.
  _rivet_env_keep=" "
  for n in $(compgen -e); do
    if [ -n "${!n:-}" ]; then _rivet_env_keep="$_rivet_env_keep$n "; fi
  done

  if [ ! -e "$rivet_env_root/.env" ]; then
    _rivet_env_say "no .env; using .env.example defaults"
    base=.env.example
  elif [ ! -r "$rivet_env_root/.env" ]; then
    _rivet_env_say ".env is not readable; using .env.example defaults"
    base=.env.example
  elif _rivet_env_is_encrypted "$rivet_env_root/.env"; then
    _rivet_env_say ".env is still git-crypt encrypted; using .env.example defaults (unlock it with scripts/setup-env.sh)"
    base=.env.example
  fi
  if [ -f "$rivet_env_root/$base" ]; then
    _rivet_env_load_file "$base"
  else
    _rivet_env_say "$base not found; nothing loaded from it"
  fi

  if [ ! -f "$rivet_env_root/.env.local" ]; then
    _rivet_env_say "no .env.local (personal keys and overrides go there; it is gitignored)"
  elif [ ! -r "$rivet_env_root/.env.local" ]; then
    _rivet_env_say ".env.local is not readable; skipped"
  elif _rivet_env_is_encrypted "$rivet_env_root/.env.local"; then
    _rivet_env_say ".env.local is git-crypt encrypted; skipped"
  else
    _rivet_env_load_file .env.local
  fi
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  rivet_load_env
  if [ "${1:-}" = "--web" ]; then
    shift
    for _rivet_env_key in $rivet_env_server_only_keys; do unset "$_rivet_env_key"; done
  fi
  if [ "$#" -gt 0 ]; then exec "$@"; fi
else
  rivet_load_env
fi
