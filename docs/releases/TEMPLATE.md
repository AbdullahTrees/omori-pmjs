## Changes

@CHANGES@

## Requirements

- OMORI 1.0.8 from Steam, or an already-decrypted copy.
- An ARM64 device running PortMaster, with SDL2, EGL and OpenGL ES 3.0, and glibc 2.28 or newer.
- About 5.5 GB free on the SD card for the first launch.

## Install

1. Copy `OMORI (PMJS).sh` to the firmware's Ports folder (`/mnt/mmc/ROMS/Ports/` on muOS, `/roms/ports/` elsewhere).
2. Copy the `omori-pmjs/` folder to the firmware's ports storage (`/mnt/mmc/ports/` on muOS).
3. Copy your Steam OMORI install into `omori-pmjs/gamedata/`, so that `omori-pmjs/gamedata/www/index.html` exists.
4. Put the game's 32-character decryption key in `omori-pmjs/gamedata/key.txt`.
5. Launch OMORI (PMJS) from the Ports menu.

The first launch converts the files and prepares a cache. It takes about 25 minutes and about 5.5 GB of free space. Later launches take about a minute to the title screen.

## Decryption key

The game files alone do not contain the key; Steam supplies it in its launch configuration. On Windows, the key is the `--` argument after `OMORI.exe` in `C:\Program Files (x86)\Steam\appcache\appinfo.vdf`: open it with a text or hex editor, search for `OMORI.exe`, and copy the 32 characters after `--`. Save them as `omori-pmjs/gamedata/key.txt`.

Alternatively, copy `appinfo.vdf` itself into `gamedata/` and the converter reads it automatically. A launch script next to `OMORI.exe`, the `OMORI_KEY` environment variable, and `--key` also work. A copy of the game that is already decrypted needs no key.

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

## Credits

OMORI is created and published by OMOCAT, LLC. This is an unofficial fan port, not affiliated with or endorsed by OMOCAT. You must own the game. PMJS is by bbbreaddd and is MIT licensed; its bundled third-party components and licenses are in the release ZIP.
