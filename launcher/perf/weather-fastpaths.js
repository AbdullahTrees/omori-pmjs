// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AbdullahTrees. Part of OMORI (PMJS): https://github.com/AbdullahTrees/omori-pmjs
// Runtime performance patch: hide weather particles that are off screen (weatherCull item).
// Game files stay byte-identical.
//
// PMJS loads it with `--patch launcher/perf/weather-fastpaths.js` (the test launcher loads every
// perf/*.js). Disable with OMORI_PERF_DISABLE=weatherCull; counters on
// `root.OmoriPerf.weatherCull`: `passes`, `culled` (off-screen sprites summed over passes),
// `hidden`/`shown` (visibility flips), `skipped` (passes where the weather container's transform
// was not a plain scale+translate, so nothing was culled).
//
// Why it is needed: Aries003_WeatherControl keeps one `Sprite_Weather` per particle: 192 at rain 6
// (map 111), 282 at rain 9 (maps 378/379/507 and CE1000), 390 at storm 9 (maps 111/412), 300 at
// snow 9. It scatters them over x in [-200, W+300) and y in [-400, H+200) around the camera, about
// four times the screen. Every visible one is walked by PIXI's updateTransform, PMJS's
// prepareTransforms and its scene encoder each frame. On the RG40XX-H (map 87, 2026-11-13) that is
// +7.5 ms of scene build at rain 9, +7.8 at snow 9 and +9.2 at storm 9 over a 5.4 ms baseline; the
// cull takes 2.3-3.4 ms of it back (BENCHMARKS.md, "Weather").
//
// Why it is behaviour-identical (frozen-frame captures on the device, cull vs vanilla, at rain 9,
// storm 9 and snow 9: 0 pixels differ; omori-handover/evidence/weather-20261113/):
//
//   * Game state is untouched. The pass runs after the composed Spriteset_Map.prototype.update,
//     so every game-side write (positions, opacity, lifetime, rebirth and its Math.randomInt
//     draws) has happened. Only `visible` of Sprite_Weather children is written. Nothing in the
//     game or its plugins reads a weather sprite's `visible` (Aries never sets it; the sprites
//     are never saved).
//   * A sprite is hidden only when a circle of radius (frameW + frameH) * max|scale| around its
//     position, which contains its quad for any anchor in [0, 1] and any rotation, is outside the
//     screen by MARGIN pixels (rain is a 3x100 image at 5-13 degrees, anchor 0; snow, leaves,
//     embers and shine use anchor 0.5).
//   * The screen is mapped into the Weather container's space through its worldTransform from the
//     last render. That is one frame old, so the margin absorbs screen shake and zoom steps
//     between frames. A rotated/skewed chain or non-positive scale skips culling for the pass
//     and shows every sprite.
//   * A hidden sprite is re-shown in the same pass that brings it back in range, before the frame
//     is drawn; PIXI recomputes its worldTransform on that frame's updateTransform.
//   * Only sprites this module hid are re-shown (a mark per `_sprites` index in a side table, not
//     on the sprite: expando properties on PIXI nodes cost hidden-class transitions), so a sprite
//     hidden by anything else stays hidden.
//
// Not done here, on purpose: drawing all particles as one PIXI mesh was built and measured on
// 2026-11-13 and dropped. It cut scene commands from 92-114 to 15 per frame, but PMJS re-uploads a
// changed mesh through JS arrays every frame (build 9.1 ms vs 10.8 with the cull at rain 9, no fps
// gain), and baking per-particle opacity into an atlas was not pixel-identical (797-8,813 pixels
// differ per frame). Record in omori-handover/deliver.md, 2026-11-13.
//
// Pins (sha256 over the LF-normalized Function.prototype.toString source):
//
//   Weather.prototype._updateAllSprites (Aries003_WeatherControl.js:688; loads after
//   GTP_CoreUpdates.js:81, which it replaces)  63d181991d003a7c2947a7837e4985a70b444b4c7984f09ad2d10e9a053a9957
//
// The Spriteset_Map.prototype.update wrap is additive (call through, then the pass) and unpinned
// on purpose: its composition is a launcher-patch stack, and the wrap cannot change what the
// composed update does.

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

  var requireFn = typeof root.__pmjsBuiltinRequire === 'function'
    ? root.__pmjsBuiltinRequire
    : (typeof require === 'function' ? require : null);
  function digest(fn) {
    if (typeof fn !== 'function') return '';
    var src = Function.prototype.toString.call(fn).replace(/\r\n/g, '\n');
    return requireFn('crypto').createHash('sha256').update(src).digest('hex');
  }

  var PIN = '63d181991d003a7c2947a7837e4985a70b444b4c7984f09ad2d10e9a053a9957';
  // Cull slack in screen pixels: one frame of shake (Aries shake decays from a few tens of
  // pixels) or zoom movement between the transform snapshot and the draw.
  var MARGIN = 96;

  function install() {
    if (typeof root.Weather !== 'function' || !root.Weather.prototype ||
        typeof root.Spriteset_Map !== 'function') return;
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.weatherCull) return;
    var cull = api.weatherCull = {
      installed: false, refused: null, enabled: true,
      passes: 0, skipped: 0, culled: 0, hidden: 0, shown: 0
    };
    if (disabled.weatherCull) {
      cull.refused = 'disabled by OMORI_PERF_DISABLE';
      return;
    }
    var found = digest(root.Weather.prototype._updateAllSprites);
    if (found !== PIN) {
      cull.refused = 'Weather.prototype._updateAllSprites';
      console.log('[omori-perf] weatherCull refused: Weather.prototype._updateAllSprites digest ' +
        (found || '(missing)'));
      return;
    }

    // Cull marks: one byte per `_sprites` index, per Weather instance. Aries only pushes and pops
    // `_sprites`, so an index names the same sprite until it is popped; marks past the current
    // length are cleared.
    var tables = new WeakMap();
    function marksFor(weather, length) {
      var table = tables.get(weather);
      if (!table) {
        table = { marks: new Uint8Array(512), length: 0 };
        tables.set(weather, table);
      }
      if (table.marks.length < length) {
        var marks = new Uint8Array(length * 2);
        marks.set(table.marks);
        table.marks = marks;
      }
      for (var i = length; i < table.length; i++) table.marks[i] = 0;
      table.length = length;
      return table.marks;
    }
    function showAll(sprites, marks) {
      for (var i = 0; i < sprites.length; i++) {
        if (marks[i]) {
          marks[i] = 0;
          if (sprites[i]) sprites[i].visible = true;
          cull.shown++;
        }
      }
    }

    function pass(weather) {
      var sprites = weather && weather._sprites;
      if (!sprites) return;
      var marks = marksFor(weather, sprites.length);
      if (!sprites.length) return;
      if (api.enabled === false || cull.enabled === false) {
        showAll(sprites, marks);
        return;
      }
      cull.passes++;
      var m = weather.worldTransform;
      var graphics = root.Graphics;
      var width = graphics && graphics.width, height = graphics && graphics.height;
      if (!m || Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9 || !(m.a > 0) || !(m.d > 0) ||
          !(width > 0) || !(height > 0)) {
        cull.skipped++;
        showAll(sprites, marks);
        return;
      }
      // Screen rectangle (plus margin) in the Weather container's local coordinates.
      var left = (-MARGIN - m.tx) / m.a, right = (width + MARGIN - m.tx) / m.a;
      var top = (-MARGIN - m.ty) / m.d, bottom = (height + MARGIN - m.ty) / m.d;
      for (var i = 0; i < sprites.length; i++) {
        var sprite = sprites[i];
        if (!sprite) continue;
        var frame = sprite._frame, scale = sprite.scale;
        var fw = frame ? frame.width : 0, fh = frame ? frame.height : 0;
        var sx = scale ? Math.abs(scale.x) : 1, sy = scale ? Math.abs(scale.y) : 1;
        var radius = (fw + fh) * (sx > sy ? sx : sy);
        var x = sprite.x, y = sprite.y;
        // An unloaded bitmap (zero frame) or non-finite position is never culled.
        var off = radius > 0 && radius === radius && x === x && y === y &&
          (x + radius < left || x - radius > right || y + radius < top || y - radius > bottom);
        if (off) {
          cull.culled++;
          if (sprite.visible) {
            sprite.visible = false;
            marks[i] = 1;
            cull.hidden++;
          }
        } else if (marks[i]) {
          marks[i] = 0;
          sprite.visible = true;
          cull.shown++;
        }
      }
    }

    var spritesetUpdate = root.Spriteset_Map.prototype.update;
    root.Spriteset_Map.prototype.update = function () {
      var result = spritesetUpdate.apply(this, arguments);
      if (this._weather) pass(this._weather);
      return result;
    };
    // Re-applies the current enabled state to the live scene without a logic step (A/B captures).
    api.weatherSync = function () {
      var scene = root.SceneManager && root.SceneManager._scene;
      var weather = scene && scene._spriteset && scene._spriteset._weather;
      if (weather) pass(weather);
    };

    cull.installed = true;
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.perf.weather-fastpaths', install);
  } else if (typeof window !== 'undefined') {
    // NW.js: plugins are loaded by the time the window load event fires.
    window.addEventListener('load', install);
  }
})();
