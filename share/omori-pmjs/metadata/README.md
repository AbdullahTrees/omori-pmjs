## Notes

Thanks to [OMOCAT](https://www.omori-game.com/) for OMORI, a hand-drawn psychological horror RPG whose dream world and turn-based battles carry a story about memory and grief, and to [bbbreaddd](https://github.com/bbbreaddd/pmjs) for PMJS, the lightweight native RPG Maker MV runtime this port runs on.

OMORI is a commercial game. This package does not include its game files. Copy the contents of your Steam OMORI install (v1.0.8, the folder containing `www/`) into `ports/omori-pmjs/gamedata/` before the first launch, so that `gamedata/www/index.html` exists. Copying the `OMORI` folder itself also works (`gamedata/OMORI/www/index.html`); keep the key or `appinfo.vdf` in `gamedata/` either way. The launcher converts your files and prepares a device cache; allow about 25 minutes and 5.5 GB of free space. After that, launches take about a minute to the title screen. Saves are kept in `ports/omori-pmjs/saves/`.

The Steam release is encrypted and this package contains no key. The launcher looks for the key in `gamedata/omori-key.txt` (a template is included; replace its whole contents), in `gamedata/appinfo.vdf`, in a `.bat`, `.sh` or `.cmd` launch script next to the game, or in the `OMORI_KEY` environment variable. If your install has no launch script, copy Steam's `appcache/appinfo.vdf` (on Windows, `C:\Program Files (x86)\Steam\appcache\appinfo.vdf`) into `gamedata/` before the first launch. A copy of the game that is already decrypted needs no key.

If it does not start, read `ports/omori-pmjs/log.txt`; `log.prev.txt` keeps the previous run. If neither exists, the launcher did not find the `omori-pmjs/` folder: keep it together with `OMORI (PMJS).sh` (on muOS the `.sh` goes in `/mnt/mmc/ROMS/Ports/` and the folder in `/mnt/mmc/ports/`; on ArkOS/dArkOS both go in `/roms/ports/`). The launcher then writes `OMORI-PMJS-launch.log` next to the `.sh`. When reporting a failure, include `log.txt`, `log.prev.txt` and the newest file in `logs/`.

On 1 GB devices (less than 700 MB available at launch) the launcher turns on low-memory mode: unused cached images are freed earlier and a per-second memory log is written to `ports/omori-pmjs/logs/`. An empty `low-memory-mode` or `normal-memory-mode` file in `ports/omori-pmjs/` forces it on or off. Button hints show controller buttons by default (OPTIONS > GENERAL > GAME INPUT TYPE).

## Controls

| Button | Action |
|--|--|
| D-Pad / Left Stick | Move / navigate menus |
| A | Confirm / interact |
| B | Cancel / open menu |
| X | Dash (hold) |
| Y | Menu |
| L1 | Page up (menus) |
| R1 | Page down (menus) |
| Start + Select | Quit the game |

## Compile

The runtime is PMJS for Linux ARM64: upstream `bbbreaddd/pmjs` at `515ebe6` plus the port's own runtime branches (performance, preparation cache, video, memory guard). The exact runtime commit and payload hashes are recorded in `manifest.json`.

### Runtime

Use a 64-bit Linux build host. The build needs Python 3, CMake, Ninja, Clang/LLVM 20 and the development packages listed in PMJS's build guide. An upstream runtime builds with:

```bash
git clone https://github.com/bbbreaddd/pmjs.git
cd pmjs
git checkout 515ebe6
python3 tools/dependencies.py --jobs 4
./build.sh --target arm64 --jobs 12
```

The runtime is written to `dist/pmjs-arm64`. It bundles Node, FFmpeg and Skia; SDL2, EGL and GLES come from the firmware. Some firmware SDL builds make the GL context current through a different EGL provider than the runtime's linked libEGL (ArkOS on the R36S is one); the runtime asks SDL for the current context and logs both views at startup so a split provider is visible.

### Game-side patches

`patches/omori-performance.js`, `patches/character-frames.js`, `patches/omori-fps-log.js`, `patches/port-defaults.js` and the modules in `perf/` are plain JavaScript loaded by PMJS with `--patch` at launch. They ship as source in this package; there is no compilation step.
