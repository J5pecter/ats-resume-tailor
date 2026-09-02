#!/usr/bin/env bash
# Starts the Python web app inside a Codespace.
#
# This is the only way GitHub itself runs this app. Pages serves static files
# and Actions runs jobs; a Codespace is a real machine with a real port, which
# is what a web app needs. It is a development environment rather than a host —
# it stops when you close it and its URL changes each time — so treat it as
# "GitHub can run this for me right now", not as somewhere to send a link.
set -euo pipefail

cd "$(dirname "$0")/.."

# A Codespace has no .env, and a key that changes on restart would log you out
# every time the container resumes. Generated once and kept in the workspace,
# which persists across stops.
if [ ! -f webapp/.env ]; then
  echo "First run — writing webapp/.env"
  {
    echo "SECRET_KEY=$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
    echo ""
    echo "# Paste a free key from https://console.groq.com/keys, then restart:"
    echo "#   bash .devcontainer/start.sh"
    echo "OPENAI_COMPATIBLE_API_KEY=${OPENAI_COMPATIBLE_API_KEY:-}"
    echo "OPENAI_COMPATIBLE_MODEL=openai/gpt-oss-120b"
    echo "LLM_FALLBACKS=smaller"
    echo "LLM_SMALLER_MODEL=openai/gpt-oss-20b"
  } > webapp/.env
fi

if ! grep -q '^OPENAI_COMPATIBLE_API_KEY=.\+' webapp/.env; then
  echo ""
  echo "  No model key yet. Everything except tailoring will work."
  echo "  Add one to webapp/.env, or set it as a Codespaces secret so it is"
  echo "  picked up automatically next time:"
  echo "    https://github.com/settings/codespaces"
  echo ""
fi

# Bound to 0.0.0.0 so the forwarded port reaches it; 127.0.0.1 would be visible
# only inside the container.
exec python -m uvicorn app.main:app --app-dir webapp --host 0.0.0.0 --port 8000 --reload
