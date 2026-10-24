#!/usr/bin/env bash
# Usage: scripts/setup-env.sh [path/to/soon-git-crypt.key]
# Unlocks the git-crypt encrypted .env. With no key, falls back to .env.example.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
KEY="${1:-${GIT_CRYPT_KEY_FILE:-$HOME/.config/rivet/soon-git-crypt.key}}"

if ! command -v git-crypt >/dev/null; then
  if command -v brew >/dev/null; then brew install git-crypt
  elif command -v apt-get >/dev/null; then sudo apt-get install -y git-crypt
  else echo "Install git-crypt first: https://github.com/AGWA/git-crypt" >&2; exit 1; fi
fi

if head -c 9 .env 2>/dev/null | grep -q "GITCRYPT"; then
  [ -f "$KEY" ] || { echo "No key at $KEY. Ask a maintainer for it, or: cp .env.example .env" >&2; exit 1; }
  git-crypt unlock "$KEY"
  echo ".env unlocked."
elif [ -f .env ]; then
  echo ".env is already readable."
else
  cp .env.example .env
  echo "Created .env from .env.example; fill in your keys."
fi
