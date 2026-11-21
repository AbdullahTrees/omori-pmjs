// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AbdullahTrees. Part of OMORI (PMJS): https://github.com/AbdullahTrees/omori-pmjs
// Port defaults for handhelds. Game files stay byte-identical.
//
// PMJS loads it with `--patch launcher/port-defaults.js` (the release launcher always does; it
// is a settings default, not a performance patch, so PMJS_PERF switches leave it alone).
//
// gamepadTips -- OPTIONS > GENERAL > GAME INPUT TYPE picks the button icons in hints
//   (KEYBOARD/GAMEPAD). OMORI BASE defaults it to KEYBOARD (`ConfigManager.gamepadTips = false`,
//   Omori BASE.js:623) in three places: the static default, applyData (`config.gamepadTips ||
//   false`, which cannot tell "never chosen" from "chose KEYBOARD") and restoreDefaultConfig.
//   Every device this port runs on is played with a gamepad, so the default becomes GAMEPAD:
//     * static default: true;
//     * applyData: a config without the key (first launch, or a config written before the key
//       existed) gets true; a saved false (the player chose KEYBOARD) is kept;
//     * restoreDefaultConfig: after the game's own restore, true (and the title screen's
//       command hints are redrawn, as the options menu does when the setting changes).
//   Saving is unchanged: makeData writes whatever the player has. OMORI_PORT_DEFAULTS=0 disables.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }
  if (env('OMORI_PORT_DEFAULTS') === '0') return;

  var stats = root.OmoriPortDefaults = { installed: false, gamepadTips: { defaulted: 0, kept: 0, restored: 0 } };

  function install() {
    var config = root.ConfigManager;
    if (stats.installed || !config || typeof config.applyData !== 'function' ||
        typeof config.restoreDefaultConfig !== 'function' || !('gamepadTips' in config)) {
      if (!stats.installed) console.log('[omori-port] gamepadTips default unavailable: OMORI BASE config not found');
      return;
    }
    stats.installed = true;
    config.gamepadTips = true;

    var applyData = config.applyData;
    config.applyData = function (data) {
      var result = applyData.apply(this, arguments);
      if (data && data !== this && data.gamepadTips === undefined) {
        this.gamepadTips = true;
        stats.gamepadTips.defaulted++;
      } else {
        stats.gamepadTips.kept++;
      }
      return result;
    };

    var restore = config.restoreDefaultConfig;
    config.restoreDefaultConfig = function () {
      var result = restore.apply(this, arguments);
      this.gamepadTips = true;
      stats.gamepadTips.restored++;
      var scene = root.SceneManager && SceneManager._scene;
      if (scene && typeof scene.refreshCommandHints === 'function') scene.refreshCommandHints();
      return result;
    };
    console.log('[omori-port] gamepadTips default: GAMEPAD');
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.port-defaults', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
