#!/bin/sh
# Optional reminder before Muse Code edits a file (off by default). Muse runs this before EVERY tool call (native
# plugin hooks have no tool filter), so the "off" path is one file test in sh: no Node start, no output, exit 0.
# It turns on only when the file "remind-before-edit" exists in this plugin's data folder; then the Node script reads
# the tool name and path and may print one reminder. It never blocks, changes or reads the edit itself.
dir="${MUSE_PLUGIN_DATA_DIR:-${PLUGIN_DATA:-}}"
[ -n "$dir" ] && [ -f "$dir/remind-before-edit" ] || exit 0
here="$(dirname "$0")"
exec node "$here/remind-before-edit.mjs"
