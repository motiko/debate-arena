#!/usr/bin/env bash
# Submits a speech file as a Custom Debater Turn, refusing one over the word limit (the platform would cut it).
# Usage: speak.sh <debate-id> <slot> <max-words> <speech-file>
# Run from the debate-arena repo root. The token is read from the Keychain at the moment of use and never printed.
set -euo pipefail
id=$1 slot=$2 max=$3 file=$4
words=$(wc -w < "$file" | tr -d ' ')
if [ "$words" -gt "$max" ]; then
  echo "REFUSED: $words words, the limit is $max. Shorten the speech and run again." >&2
  exit 1
fi
if [ -z "${DEBATE_ARENA_TOKEN:-}" ]; then
  DEBATE_ARENA_TOKEN="$(security find-generic-password -s debate-arena-token -w)"
  export DEBATE_ARENA_TOKEN
fi
node packages/cli/src/main.ts speak "$id" --slot "$slot" < "$file"
