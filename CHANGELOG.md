# Changelog

## v0.7.2 - 2026-10-26

- First semantic-versioned release
- Fixed the 2026.10.25 launcher's Windows CRLF line endings, which prevented it from starting and writing a log
- The launcher logs before PortMaster, finds the port folder without it, restores executable bits, and keeps `log.prev.txt`
- Added a `gamedata/omori-key.txt` template and documented per-firmware install paths and log locations
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
