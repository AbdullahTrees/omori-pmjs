## Notes

Thanks to [OMOCAT](https://www.omori-game.com/) for OMORI, a hand-drawn psychological horror RPG whose dream world and turn-based battles carry a story about memory and grief, and to [bbbreaddd](https://github.com/bbbreaddd/pmjs) for PMJS, the lightweight native RPG Maker MV runtime this port runs on.

OMORI is a commercial game. This package does not include its game files. Copy your Steam OMORI install (v1.0.8) into `ports/omori-pmjs/gamedata/` before the first launch. The launcher converts your files and prepares a device cache; allow about 25 minutes and 5.5 GB of free space. After that, launches take about a minute to the title screen. Saves are kept in `ports/omori-pmjs/saves/`.

The Steam release is encrypted and this package contains no key. The launcher looks for the key in a `.bat`, `.sh` or `.cmd` launch script next to the game, in `gamedata/appinfo.vdf`, in the `OMORI_KEY` environment variable, or in `gamedata/omori-key.txt`. If your install has no launch script, copy Steam's `appcache/appinfo.vdf` (on Windows, `C:\Program Files (x86)\Steam\appcache\appinfo.vdf`) into `gamedata/` before the first launch. A copy of the game that is already decrypted needs no key.

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

The runtime is PMJS for Linux ARM64. This release was built from the port's [source repository](https://github.com/AbdullahTrees/omori-pmjs), using PMJS upstream `bbbreaddd/pmjs` at `d551972` plus the port's performance, preparation and compatibility commits. The exact runtime and port commits are recorded in `manifest.json`.

### Runtime

Use a 64-bit Linux build host. The build needs Python 3, CMake, Ninja, Clang/LLVM 20 and the development packages listed in PMJS's build guide.

```bash
git clone https://github.com/bbbreaddd/pmjs.git
cd pmjs
git checkout d551972
python3 tools/dependencies.py --jobs 4
./build.sh --target arm64 --jobs 12
```

The runtime is written to `dist/pmjs-arm64`. It bundles Node, FFmpeg and Skia; SDL2, EGL and GLES come from the firmware.

### Game-side patches

`patches/omori-performance.js`, `patches/character-frames.js`, `patches/omori-fps-log.js` and the modules in `perf/` are plain JavaScript loaded by PMJS with `--patch` at launch. They ship as source in this package; there is no compilation step.
