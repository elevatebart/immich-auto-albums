#!/bin/sh
# preview and apply are the CLI, serve is the UI. Anything else runs verbatim.
set -e

if [ "${1:-preview}" = "serve" ] && [ ! -f server/build/index.js ]; then
	echo "this image has no UI: build the default target instead of --target cli." >&2
	exit 1
fi

if [ ! -f "$CONFIG" ]; then
	echo "no config at $CONFIG. Mount a /data holding config.toml, starting from config.example.toml." >&2
	[ "${1:-preview}" = "serve" ] || exit 1
fi

# /data/.env is the place for the key on a NAS, so the DSM task does not carry it.
ENVFILE="--env-file-if-exists=/data/.env"

case "${1:-preview}" in
	preview | apply) exec node "$ENVFILE" dist/cli.js "$1" ;;
	serve) exec node "$ENVFILE" server/build/index.js ;;
	*) exec "$@" ;;
esac
