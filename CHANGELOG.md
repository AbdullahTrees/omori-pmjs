# Changelog

## v0.8.1

- Memory guard restored in the runtime (missing from v0.8.0): low-memory mode, safety net and memory log work again; fixes freezes after loading a save on 1 GB devices
- Critical memory cleanups that free little back off (doubling, up to 60 s) instead of repeating every 6 s
- Off-screen characters whose image changed no longer pop in late
- GAME INPUT TYPE defaults to GAMEPAD (controller button hints); a saved KEYBOARD choice is kept
- Runtime: local branch `release/v0.8.1` `73102a4` = `release/v0.8.0` + `pr/memory-guard` + cull back-off

## v0.8.0

- Maps faster: off-screen weather culling and new logic caches (map 92 41 -> 60 fps, Rain Town 31 -> 45, walking 39 -> 51)
- Real-time logic pacing: a steady 60 steps per second (`OMORI_PERF_DISABLE=mainLoopPacing` restores stock timing)
- Warm start 55-84 s -> about 9 s (catalog fixes, loading screen); template-map preload reads each map once
- No background blur on map transfers (DARK ROAD memory-door freeze gone); first menu open 2.4 s -> 0.3 s
- Credits video 15.6 -> 33 fps; Basil's greyscale phase 29.5 -> 40 fps; Space Invaders 18.5 -> 59.5 fps
- Low-memory mode and memory safety net for 1 GB devices
- Runtime: PMJS `integration` `2071ae3` (upstream `515ebe6`) + video fixes, local branch `release/v0.8.0` `5e776db`
- The port's own code is MIT-licensed

## 2026.11.06

- Runtime rebuilt from `integration` (`f1a2c94`) on upstream `398ed49`: includes the merged upstream fixes #8 and #10-#13 plus identity-filter elision, filter-target hysteresis, frame statistics and character-presentation deferral
- Dialog/textbox windows with stacked, colour and icon effects rise from 16-21 fps to about 52 fps (upstream canvas text-measurement cache); ordinary text windows gain 1-3 fps
- Battles, menus and measured maps unchanged within noise; same three surveyed `config.json` disables
- Known issue: warm startup about 84 s versus 72 s, because upstream's prepared-image catalog is not written when a game ships undecodable image placeholders and the images are revalidated every boot

## 2026.11.04

- Runtime rebuilt from `integration` (`d4b7b5c`) + `pr/filter-target-hysteresis` (`f29a883`): identity-filter elision restores battle fps, filter-target hysteresis removes target churn (~1 ms/frame)
- Release `config.json` disables `scene.constant-black-group`, `scene.plain-sprite-segment` and `tilemap.yed-indexed-paint-loops` (surveyed neutral/slower on OMORI; yed-paint screenshots identical)
- Loading screen uses the OMORI game font
- Start+Select quits reliably (GPTOKEYB2 unquoted)
- Verified the Steam converter on this ZIP: key from `appinfo.vdf`, 5,093 expected / 0 missing / 0 changed

## v0.7.2 - 2026-10-26

- First semantic-versioned release
- Fixed the 2026.10.25 launcher's Windows CRLF line endings, which prevented it from starting and writing a log
- The launcher logs before PortMaster, finds the port folder without it, restores executable bits, and keeps `log.prev.txt`
- Added a `gamedata/omori-key.txt` template and documented per-firmware install paths and log locations
- The converter finds the key and `appinfo.vdf` in `gamedata/` for both flat and nested Steam installs
- Verified the Steam converter against a real 1.0.8 install: 5,093 files expected, 0 missing, 0 changed
- Made menu prewarm opt-in to avoid a 20.6-second first-map stall


## 2026.10.25 - 2026-10-25

- Fixed the ArkOS/R36S presentation-canvas crash by asking SDL for the GL context instead of the linked EGL
- Added startup graphics and technology diagnostics
- Bundled all verified game-side fast paths and the native menu-background blur
- Updated to the new PMJS runtime


## 2026.10.24

- Initial public release of the OMORI port for ARM64 PortMaster handhelds.
- Key-free Steam converter that finds the player's own key.
- Standard PortMaster launcher, metadata, licenses, libatomic and gameplay screenshot.
- Character-frame and sprite-update optimizations with the opt-in fast paths.

The full notes for each release are in `docs/releases/` and on the GitHub Releases page.
