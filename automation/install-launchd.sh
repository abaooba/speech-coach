#!/bin/bash
# Install (or reinstall) the 23:00 nightly job. Uninstall: launchctl unload ~/Library/LaunchAgents/com.speechcoach.night.plist
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)/com.speechcoach.night.plist"
DST="$HOME/Library/LaunchAgents/com.speechcoach.night.plist"
mkdir -p "$HOME/Library/LaunchAgents"
launchctl unload "$DST" 2>/dev/null || true
cp "$SRC" "$DST"
launchctl load "$DST"
launchctl list | grep com.speechcoach.night && echo "installed: runs daily at 00:30"
