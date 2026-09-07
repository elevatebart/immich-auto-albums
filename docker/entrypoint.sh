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

case "${1:-preview}" in
	preview | apply) exec node dist/cli.js "$1" ;;
	serve) exec node server/build/index.js ;;
	*) exec "$@" ;;
esac
