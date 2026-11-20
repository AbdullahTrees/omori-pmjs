// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AbdullahTrees. Part of OMORI (PMJS): https://github.com/AbdullahTrees/omori-pmjs
// Defer the scene-background blur until something reads the background (snapBlurDefer item).
// Game files stay byte-identical.
//
// PMJS and NW.js: loaded like the other launcher/perf modules (PMJS: --patch, installed on
// afterPlugins; NW.js: installed on load). Disable with OMORI_PERF_DISABLE=snapBlurDefer;
// `OmoriPerf.snapBlurDefer.enabled = false` turns it off at runtime (later snapshots blur at
// once again). Counters on `root.OmoriPerf.snapBlurDefer`: `deferred` (snapshot blurs put off),
// `performed` (deferred blurs done when the background was read), `skipped` (deferred blurs
// dropped because a newer snapshot replaced the bitmap unread), `blurMs` / `blurMaxMs`.
//
// Why: every time a map scene ends (map transfer, menu, battle with a battleback...) MV's
// Scene_Map.terminate calls SceneManager.snapForBackground(), and GTP_OmoriFixes' version blurs
// the snapshot unless the next scene is the pause menu. On a map-to-map transfer the next scene
// is another Scene_Map, which never shows that bitmap, so the blur is pure cost. Usually that is
// PMJS's native blur, but when the snapshot holds additive-blend pixels over transparency
// ("over-alpha", e.g. the memory doors on DARK ROAD PATH, map 379) PMJS refuses the native path
// and runs MV's stock Canvas blur: one ~2.1 s frame per door on the RG40XX-H (user playthrough
// 2026-11-13, evidence/playthrough-20261113/).
//
// What it does: while SceneManager.snapForBackground runs, the bitmap SceneManager.snap returns
// gets an own `blur` that only records a pending blur. SceneManager.backgroundBitmap() -- the
// only way any scene reads the background (Scene_MenuBase, Spriteset_Battle, OMORI's menus,
// Map_Character_Tag) -- performs the pending blur(s) with Bitmap.prototype.blur before handing
// the bitmap out. A snapshot replaced before anyone reads it is never blurred.
//
// Why it is behaviour-identical:
//   * The snapshot bitmap is private to SceneManager until backgroundBitmap() returns it, so
//     nothing can draw on it in between: the blur sees the same pixels whenever it runs, and
//     every reader gets the same blurred bitmap it would have got.
//   * A battle without battlebacks reads the snapshot left by the previous scene change; that
//     read also goes through backgroundBitmap(), so it is blurred exactly as before.
//   * Only the time of the blur moves: from the map's terminate into the first reader's create,
//     which for the pause menu and battles is the same scene-change frame.
//
// Not pinned: the wrap is additive (snap, snapForBackground and backgroundBitmap are called
// through) and refuses to install if any of them is missing.

(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && root.NativeHost.runtime && typeof root.NativeHost.runtime.env === 'function') {
      return root.NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }
  if (env('OMORI_PERF') === '0') return;

  var disabled = {};
  String(env('OMORI_PERF_DISABLE') || '').split(',').forEach(function (name) {
    if (name) disabled[name.trim()] = true;
  });

  var PENDING = '_omoriSnapBlurPending';

  function install() {
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.snapBlurDefer) return;
    var item = api.snapBlurDefer = {
      installed: false, refused: null, enabled: true,
      deferred: 0, performed: 0, skipped: 0, blurMs: 0, blurMaxMs: 0, errors: []
    };
    if (disabled.snapBlurDefer) { item.refused = 'disabled by OMORI_PERF_DISABLE'; return; }
    var SM = root.SceneManager;
    var missing =
      !SM ? 'SceneManager' :
      typeof SM.snap !== 'function' ? 'SceneManager.snap' :
      typeof SM.snapForBackground !== 'function' ? 'SceneManager.snapForBackground' :
      typeof SM.backgroundBitmap !== 'function' ? 'SceneManager.backgroundBitmap' :
      !(root.Bitmap && typeof root.Bitmap.prototype.blur === 'function') ? 'Bitmap.prototype.blur' : null;
    if (missing) {
      item.refused = missing;
      console.log('[omori-perf] snapBlurDefer refused: ' + missing + ' missing');
      return;
    }

    var depth = 0;
    var marked = [];

    function deferredBlur() {
      this[PENDING] = (this[PENDING] || 0) + 1;
      item.deferred++;
    }

    function runPending(bitmap) {
      var count = bitmap[PENDING];
      bitmap[PENDING] = 0;
      var started = performance.now();
      for (var i = 0; i < count; i++) root.Bitmap.prototype.blur.call(bitmap);
      var elapsed = performance.now() - started;
      item.performed += count;
      item.blurMs += elapsed;
      if (elapsed > item.blurMaxMs) item.blurMaxMs = elapsed;
    }

    var snap = SM.snap;
    SM.snap = function () {
      var bitmap = snap.apply(this, arguments);
      if (depth > 0 && bitmap && typeof bitmap === 'object' && api.enabled !== false && item.enabled) {
        bitmap.blur = deferredBlur;
        marked.push(bitmap);
      }
      return bitmap;
    };

    var snapForBackground = SM.snapForBackground;
    SM.snapForBackground = function () {
      var previous = this._backgroundBitmap;
      depth++;
      try {
        return snapForBackground.apply(this, arguments);
      } finally {
        depth--;
        if (depth === 0) {
          for (var i = 0; i < marked.length; i++) {
            if (Object.prototype.hasOwnProperty.call(marked[i], 'blur')) delete marked[i].blur;
          }
          marked.length = 0;
          // The previous snapshot was replaced without being read: its blur is never needed.
          if (previous && previous !== this._backgroundBitmap && previous[PENDING]) {
            item.skipped += previous[PENDING];
            previous[PENDING] = 0;
          }
        }
      }
    };

    var backgroundBitmap = SM.backgroundBitmap;
    SM.backgroundBitmap = function () {
      var bitmap = backgroundBitmap.apply(this, arguments);
      if (bitmap && bitmap[PENDING]) {
        try { runPending(bitmap); } catch (error) {
          if (item.errors.length < 8) item.errors.push('blur: ' + String(error && error.message || error));
        }
      }
      return bitmap;
    };
    item.installed = true;
  }

  if (root.PMJS && root.PMJS.phases && typeof root.PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.perf.snap-blur-defer', install);
  } else if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('load', install);
  }
  root.OmoriPerfSnapBlurDefer = { installForTest: install };
})();
