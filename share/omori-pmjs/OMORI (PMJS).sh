#!/bin/bash

# Resolve the port folder before PortMaster is sourced. A missing control.txt
# must not become a silent exit: without a log there is nothing to send back.
# ArkOS/darkOS/Knulli keep the .sh and omori-pmjs/ in the same ports folder;
# muOS keeps the .sh in ROMS/Ports and the folder in ports/.
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P) || SCRIPT_DIR=$(dirname -- "$0")
EARLY_LOG="$SCRIPT_DIR/OMORI-PMJS-launch.log"
if ! ( : >> "$EARLY_LOG" ) 2>/dev/null; then
  EARLY_LOG="/tmp/OMORI-PMJS-launch.log"
fi
# Never let a logging problem become another silent exit.
if ( : >> "$EARLY_LOG" ) 2>/dev/null; then
  exec >> "$EARLY_LOG" 2>&1
fi

echo "[launcher] start script=$0 version=@RELEASE_VERSION@"

XDG_DATA_HOME=${XDG_DATA_HOME:-$HOME/.local/share}

if [ -d "/opt/system/Tools/PortMaster/" ]; then
  controlfolder="/opt/system/Tools/PortMaster"
elif [ -d "/opt/tools/PortMaster/" ]; then
  controlfolder="/opt/tools/PortMaster"
elif [ -d "$XDG_DATA_HOME/PortMaster/" ]; then
  controlfolder="$XDG_DATA_HOME/PortMaster"
else
  controlfolder="/roms/ports/PortMaster"
fi

if [ -f "$controlfolder/control.txt" ]; then
  . "$controlfolder/control.txt"
  echo "[launcher] control=$controlfolder/control.txt"
else
  echo "[launcher] PortMaster control.txt not found at $controlfolder/control.txt"
  controlfolder=""
fi
if [ -n "$controlfolder" ] && [ -f "${controlfolder}/mod_${CFW_NAME:-}.txt" ]; then
  . "${controlfolder}/mod_${CFW_NAME:-}.txt"
fi
if command -v get_controls >/dev/null 2>&1; then
  get_controls
else
  echo "[launcher] get_controls unavailable; continuing without PortMaster controls"
fi

# PortMaster helpers are absent when the port is launched without PortMaster.
# Keep running and put the message in the log instead of dying with
# "command not found".
command -v pm_show_error >/dev/null 2>&1 || pm_show_error() { echo "[launcher] $*" >&2; }
command -v pm_message >/dev/null 2>&1 || pm_message() { echo "[launcher] message: $*" >&2; }
command -v pm_platform_helper >/dev/null 2>&1 || pm_platform_helper() { echo "[launcher] no platform helper for $*" >&2; }
command -v pm_finish >/dev/null 2>&1 || pm_finish() { :; }

GAMEDIR=""
if [ -n "${directory:-}" ] && [ -d "/$directory/ports/omori-pmjs" ]; then
  GAMEDIR="/$directory/ports/omori-pmjs"
fi
if [ -z "$GAMEDIR" ] && [ -d "$SCRIPT_DIR/omori-pmjs" ]; then
  GAMEDIR="$SCRIPT_DIR/omori-pmjs"
fi
# muOS: the launcher lives in /mnt/mmc/ROMS/Ports, the port in /mnt/mmc/ports.
if [ -z "$GAMEDIR" ] && [ -d "/mnt/mmc/ports/omori-pmjs" ]; then
  GAMEDIR="/mnt/mmc/ports/omori-pmjs"
fi
if [ -z "$GAMEDIR" ]; then
  if [ -n "${directory:-}" ]; then
    GAMEDIR="/$directory/ports/omori-pmjs"
  else
    GAMEDIR="$SCRIPT_DIR/omori-pmjs"
  fi
  echo "[launcher] port folder not found (expected $GAMEDIR)"
  pm_show_error "The omori-pmjs folder was not found. Extract the whole release ZIP, keeping OMORI (PMJS).sh and the omori-pmjs folder together, then launch again. Log: $EARLY_LOG" --title "OMORI files missing" --type error
  exit 1
fi

RUNTIME="$GAMEDIR/runtime"
# PMJS runs on its bundled Node interpreter; the kill target is that process name.
BINARY=node
GAME="$GAMEDIR/www"

cd "$GAMEDIR" || {
  echo "[launcher] cannot enter $GAMEDIR"
  pm_show_error "Cannot open the omori-pmjs folder at $GAMEDIR. See $EARLY_LOG." --title "OMORI files missing" --type error
  exit 1
}

# ZIP extraction from Windows can lose the executable bits even when the
# package itself is correct. Restore them before PMJS tries to run.
[ -x "$RUNTIME/bin/pmjs" ] || chmod +x "$RUNTIME/bin/pmjs" 2>/dev/null || true
[ -x "$RUNTIME/bin/node" ] || chmod +x "$RUNTIME/bin/node" 2>/dev/null || true
if [ ! -f "$RUNTIME/bin/pmjs" ] || [ ! -f "$RUNTIME/bin/node" ]; then
  echo "[launcher] runtime incomplete: pmjs or node missing under $RUNTIME/bin"
  pm_show_error "The omori-pmjs folder is incomplete (runtime missing). Reinstall the release ZIP. Log: $EARLY_LOG" --title "OMORI files missing" --type error
  exit 1
fi
if [ ! -x "$RUNTIME/bin/pmjs" ] || [ ! -x "$RUNTIME/bin/node" ]; then
  echo "[launcher] runtime is not executable"
  pm_show_error "The omori-pmjs runtime is not executable. Copy the release ZIP with a Linux-aware extractor, or run chmod +x omori-pmjs/runtime/bin/*. Log: $EARLY_LOG" --title "OMORI files missing" --type error
  exit 1
fi

# Keep the previous log: the run that failed is usually the one worth reading.
LOG="$GAMEDIR/log.txt"
[ -f "$LOG" ] && mv -f "$LOG" "$LOG.prev" 2>/dev/null
cp "$EARLY_LOG" "$LOG" 2>/dev/null || true
if command -v tee >/dev/null 2>&1; then
  exec > >(tee -a "$LOG") 2>&1
else
  exec >> "$LOG" 2>&1
fi

echo "[launcher] version=@RELEASE_VERSION@ game=$GAME runtime=$RUNTIME"
echo "[launcher] script_dir=$SCRIPT_DIR controlfolder=${controlfolder:-<none>} directory=${directory:-<unset>} log=$LOG"

# PMJS ships its private libraries in runtime/lib.
export LD_LIBRARY_PATH="$RUNTIME/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export SDL_GAMECONTROLLERCONFIG="${sdl_controllerconfig:-}"
# PMJS's own Start+Select quit would race PortMaster's kill switch.
export PMJS_EXIT_HOTKEY=none
# PMJS keeps its prepared bootstrap and state under XDG_CACHE_HOME; keep them in the port folder.
export XDG_CACHE_HOME="$GAMEDIR/.cache"

mkdir -p "$GAMEDIR/saves" "$GAMEDIR/.cache"

# Startup inventory: the first thing to read when a device fails before the first frame.
export PMJS_GRAPHICS_DIAGNOSTICS="${PMJS_GRAPHICS_DIAGNOSTICS:-1}"
{
  echo "[tech] kernel=$(uname -r) arch=$(uname -m) model=$(tr -d '\0' < /sys/firmware/devicetree/base/model 2>/dev/null)"
  echo "[tech] libc=$(getconf GNU_LIBC_VERSION 2>/dev/null)"
  for lib in libSDL2-2.0.so.0 libEGL.so.1 libGLESv2.so.2; do
    for dir in /usr/lib /usr/lib64 /lib /lib64; do
      if [ -e "$dir/$lib" ]; then
        echo "[tech] $lib=$dir/$lib -> $(readlink -f "$dir/$lib" 2>/dev/null || echo "$dir/$lib")"
        break
      fi
    done
  done
  echo "[tech] SDL_VIDEO_EGL_DRIVER=${SDL_VIDEO_EGL_DRIVER:-<unset>} SDL_VIDEO_GL_DRIVER=${SDL_VIDEO_GL_DRIVER:-<unset>}"
} 2>/dev/null

# First launch: convert the player's own OMORI install in gamedata/ to www/.
if [ ! -f "$GAME/index.html" ]; then
  SOURCE=""
  for candidate in "$GAMEDIR/gamedata" "$GAMEDIR"/gamedata/*/; do
    if [ -f "${candidate%/}/index.html" ] || [ -f "${candidate%/}/www/index.html" ]; then
      SOURCE="${candidate%/}"
      break
    fi
  done
  if [ -z "$SOURCE" ]; then
    pm_show_error "Copy your OMORI install (the Steam release, the folder containing www/) into ports/omori-pmjs/gamedata/ and launch again." --title "Game files missing" --type warning
    exit 1
  fi
  AVAIL_KB=$(df -Pk "$GAMEDIR" | awk 'NR==2 {print $4}')
  if [ "${AVAIL_KB:-0}" -lt 5767168 ]; then
    pm_show_error "The first launch needs about 5.5 GB free on the SD card. Free some space and launch again." --title "Not enough space" --type warning
    exit 1
  fi
  pm_message "Converting your OMORI files, this can take several minutes..." --title "Please wait"
  rm -rf "$GAMEDIR/www.partial"
  if ! "$RUNTIME/bin/$BINARY" "$GAMEDIR/tools/extract.js" "$SOURCE" "$GAMEDIR/www.partial"; then
    rm -rf "$GAMEDIR/www.partial"
    pm_show_error "Could not convert the OMORI files. For the Steam release, copy Steam's appcache/appinfo.vdf into gamedata/ or put your key in gamedata/omori-key.txt. See log.txt for details." --title "Conversion failed" --type error
    exit 1
  fi
  rm -rf "$GAMEDIR/www"
  mv "$GAMEDIR/www.partial" "$GAMEDIR/www"
  if [ ! -f "$GAME/index.html" ]; then
    pm_show_error "The conversion did not produce a runnable game. Check log.txt, then launch again." --title "Conversion failed" --type error
    exit 1
  fi
fi

# Sprite-update culling and character-frame composition; PMJS_PERF=0 disables both.
PATCHES=()
[ "${PMJS_PERF:-1}" = 0 ] || PATCHES+=(--patch "$GAMEDIR/patches/omori-performance.js" --patch "$GAMEDIR/patches/character-frames.js")
# Game-side fast paths; the release build sets the default.
if [ "${PMJS_PERF_EXTRA:-@PERF_EXTRA_DEFAULT@}" = 1 ]; then
  for module in "$GAMEDIR"/perf/*.js; do
    [ -f "$module" ] && PATCHES+=(--patch "$module")
  done
fi
# Per-room fps log in fps/; PMJS_FPS=0 disables it.
if [ "${PMJS_FPS:-1}" != 0 ]; then
  export OMORI_FPS_DIR="$GAMEDIR/fps"
  PATCHES+=(--patch "$GAMEDIR/patches/omori-fps-log.js")
fi

# 1 GB devices: fail inside Node instead of a device-wide OOM.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=480}"

if [ -n "${GPTOKEYB2:-}" ]; then
  "$GPTOKEYB2" "$BINARY" > /dev/null 2>&1 &
else
  echo "[launcher] GPTOKEYB2 unavailable; controls depend on PortMaster"
fi
pm_platform_helper "$RUNTIME/bin/$BINARY"

"$RUNTIME/bin/pmjs" "$GAME" --save-root "$GAMEDIR/saves" --asset-cache-root "$GAMEDIR/.cache" "${PATCHES[@]}" --config "$GAMEDIR/config.json"

pm_finish
