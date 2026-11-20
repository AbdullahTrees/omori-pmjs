// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AbdullahTrees. Part of OMORI (PMJS): https://github.com/AbdullahTrees/omori-pmjs
// Warm the party's menu face sheets on the GPU while the map is still black (menuFaceWarm item).
// Game files stay byte-identical.
//
// PMJS only: loaded with `--patch launcher/perf/menu-face-warm.js` (the test launcher loads every
// perf/*.js) and installed on afterPlugins. Disable with OMORI_PERF_DISABLE=menuFaceWarm;
// `OmoriPerf.menuFaceWarm.enabled = false` turns it off at runtime. Counters on
// `root.OmoriPerf.menuFaceWarm`: `warmed` (sheets uploaded), `warmMs` / `warmMaxMs`, `notBlack`
// (map starts where the screen was visible, so nothing was done), `notReady` (sheet still loading,
// left for the next black map start), `errors`.
//
// Why it is needed: the first pause-menu open of a session is one ~580 ms frame on the RG40XX-H.
// 296-309 ms of it is the native draw, and the per-frame trace (BENCHMARKS "Menus",
// evidence/menu-open-20261113/) shows exactly one image realised in that frame:
// `faces/01_OMORI_BATTLE.png`, 318x1590, +3.2 MB of GPU memory. The menu's party status draws each
// member's face (Sprite_OmoMenuStatusFace -> ImageManager.loadFace(menuStatusFaceName() ||
// battleStatusFaceName())) and PMJS creates and uploads that sheet's texture lazily, inside the
// first draw that uses it. Later opens find it resident (native draw 2.4 ms). A four-member party
// pays one sheet per member.
//
// What it does: after the composed Scene_Map.prototype.start has run, and only when the screen is
// fully black at that moment (the scene's fade sprite at opacity 255, as on a fade-in after a
// transfer or a load, or $gameScreen brightness 0), it draws one face cell of each party member's
// menu face sheet into a private 128x128 offscreen canvas through PMJS's own offscreen path
// (PMJS.pixi4.renderStageToCanvas, the path Bitmap.snap uses). That realises the same texture the
// menu would realise, while the player sees black. A sheet is warmed at most once per session; a
// sheet still loading is retried on the next black map start.
//
// Why it is behaviour-identical:
//   * Nothing in the game state changes: no game object, switch, variable or interpreter is
//     touched. The faces are requested through ImageManager.loadFace exactly as the menu requests
//     them, so the image cache only gets entries the menu would create on its first open.
//   * Nothing on screen changes: the draw goes to a private canvas that is never shown, through a
//     throwaway PIXI.Container that never joins the live scene tree. It runs inside the map's
//     start tick while the fade sprite is opaque, so the frame shown is black either way.
//   * The only visible effect is time: the black screen at that map start lasts as long as the
//     uploads (about 300 ms per sheet on the RG40XX-H, once per session), and the first menu open
//     is that much shorter.
//
// Not pinned: the wrap is additive (call the composed start, then warm) and reads only public
// getters (Game_Actor menuStatusFaceName/battleStatusFaceName from Omori BASE, Bitmap.isReady,
// Sprite.setFrame). If any of them is missing the item refuses to install.

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

  var CANVAS_SIZE = 128;

  function install() {
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.menuFaceWarm) return;
    var item = api.menuFaceWarm = {
      installed: false, refused: null, enabled: true,
      warmed: 0, warmMs: 0, warmMaxMs: 0, notBlack: 0, notReady: 0, errors: []
    };
    if (disabled.menuFaceWarm) {
      item.refused = 'disabled by OMORI_PERF_DISABLE';
      return;
    }
    var PMJS = root.PMJS, PIXI = root.PIXI;
    var missing =
      !(PMJS && PMJS.pixi4 && typeof PMJS.pixi4.renderStageToCanvas === 'function') ? 'PMJS.pixi4.renderStageToCanvas' :
      !(PIXI && typeof PIXI.Container === 'function') ? 'PIXI.Container' :
      typeof root.Scene_Map !== 'function' ? 'Scene_Map' :
      typeof root.Sprite !== 'function' ? 'Sprite' :
      typeof root.Bitmap !== 'function' ? 'Bitmap' :
      !(root.ImageManager && typeof root.ImageManager.loadFace === 'function') ? 'ImageManager.loadFace' :
      !(root.Game_Actor && typeof root.Game_Actor.prototype.menuStatusFaceName === 'function' &&
        typeof root.Game_Actor.prototype.battleStatusFaceName === 'function') ? 'Game_Actor face names' : null;
    if (missing) {
      item.refused = missing;
      console.log('[omori-perf] menuFaceWarm refused: ' + missing + ' missing');
      return;
    }

    var warmed = Object.create(null);
    var target = null;

    function screenIsBlack(scene) {
      var fade = scene && scene._fadeSprite;
      if (fade && fade.visible !== false && fade.opacity >= 255 &&
          (!fade._red && !fade._green && !fade._blue)) return true;
      var screen = root.$gameScreen;
      return !!(screen && typeof screen.brightness === 'function' && screen.brightness() <= 0);
    }

    function faceNames() {
      var party = root.$gameParty;
      var members = party && typeof party.members === 'function' ? party.members() : [];
      var names = [];
      for (var i = 0; i < members.length; i++) {
        var actor = members[i];
        if (!actor) continue;
        var name = actor.menuStatusFaceName() || actor.battleStatusFaceName();
        if (name && names.indexOf(name) < 0) names.push(name);
      }
      return names;
    }

    function warm(scene) {
      if (api.enabled === false || item.enabled === false) return;
      var names = faceNames().filter(function (name) { return !warmed[name]; });
      if (!names.length) return;
      if (!screenIsBlack(scene)) { item.notBlack++; return; }
      var stage = null;
      for (var i = 0; i < names.length; i++) {
        var bitmap = root.ImageManager.loadFace(names[i]);
        if (!bitmap || typeof bitmap.isReady !== 'function' || !bitmap.isReady()) { item.notReady++; continue; }
        if (!(bitmap.width > 0 && bitmap.height > 0)) { warmed[names[i]] = true; continue; }
        var started = performance.now();
        try {
          if (!target) target = new root.Bitmap(CANVAS_SIZE, CANVAS_SIZE);
          stage = new PIXI.Container();
          var sprite = new root.Sprite(bitmap);
          sprite.setFrame(0, 0, Math.min(bitmap.width, CANVAS_SIZE), Math.min(bitmap.height, CANVAS_SIZE));
          stage.addChild(sprite);
          var renderer = root.Graphics && root.Graphics._renderer;
          PMJS.pixi4.renderStageToCanvas(stage, target._canvas, renderer && renderer.roundPixels, renderer);
          stage.removeChild(sprite);
          warmed[names[i]] = true;
          item.warmed++;
        } catch (error) {
          warmed[names[i]] = true; // never retry a sheet that throws
          if (item.errors.length < 8) item.errors.push(names[i] + ': ' + String(error && error.message || error));
        }
        var elapsed = performance.now() - started;
        item.warmMs += elapsed;
        if (elapsed > item.warmMaxMs) item.warmMaxMs = elapsed;
      }
    }

    var start = root.Scene_Map.prototype.start;
    root.Scene_Map.prototype.start = function () {
      var result = start.apply(this, arguments);
      try { warm(this); } catch (error) {
        if (item.errors.length < 8) item.errors.push('start: ' + String(error && error.message || error));
      }
      return result;
    };
    item.installed = true;
  }

  if (root.PMJS && root.PMJS.phases && typeof root.PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.perf.menu-face-warm', install);
  }
})();
