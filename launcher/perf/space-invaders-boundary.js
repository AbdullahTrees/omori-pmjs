// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AbdullahTrees. Part of OMORI (PMJS): https://github.com/AbdullahTrees/omori-pmjs
// Keep one Space Invaders boundary sprite instead of one per frame of the start animation
// (spaceInvadersBoundary item). Game files stay byte-identical.
//
// PMJS and NW.js: loaded like the other launcher/perf modules (PMJS: --patch, installed on
// afterPlugins; NW.js: installed on load). Disable with OMORI_PERF_DISABLE=spaceInvadersBoundary.
// Counters on `root.OmoriPerf.spaceInvadersBoundary`: `removed` (duplicate boundary sprites taken
// out of the scene), `installed`.
//
// Why: in "YIN - Minigame - SpaceInvaders.js" (Hobbeez arcade cabinet), Scene_SpaceInvader's
// updateTitle runs, on every frame of the "get into position" animation after the title,
//   this._pressKey = new Sprite(); this._pressKey.bitmap = ImageManager.loadPicture("INVADER-Boundary");
//   this.addChild(this._pressKey);
// and never removes the previous one. INVADER-Boundary is a full-screen 640x480 frame, so ~89
// copies stay in the scene and are all drawn every frame for the rest of the game: 27 million
// blended pixels per frame. On the RG40XX-H (Mali-G31) that draw alone takes ~115 ms of GPU time
// and the game runs at 16-22 fps (2026-11-17, evidence/minigames-20261117/); a desktop GPU hides it.
//
// What it does: after each updateTitle, if the scene holds a new boundary sprite, the previous
// boundary sprite is removed from its parent, so exactly one (the newest, topmost) remains. The
// game later removes `this._pressKey` (that same newest sprite) when it leaves, as before.
//
// Why it is pixel-identical: INVADER-Boundary's alpha is only 0 or 255 (92,160 and 215,040 pixels
// in the MN_Invader atlas region). Every copy draws the same opaque pixels with the same colour
// and nothing where it is transparent, and the kept copy is the topmost one, so it covers
// everything the removed copies covered, whatever was added between them. Nothing else refers to
// the earlier copies (the game overwrites `_pressKey`).
//
// Not pinned: the wrap is additive (updateTitle is called through) and refuses to install if
// Scene_SpaceInvader or its updateTitle is missing.
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
  if (disabled.spaceInvadersBoundary) return;
  var KEPT = '_omoriBoundarySprite';

  function install() {
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.spaceInvadersBoundary) return;
    var item = api.spaceInvadersBoundary = { installed: false, removed: 0 };
    var Scene = root.Scene_SpaceInvader;
    if (typeof Scene !== 'function' || !Scene.prototype || typeof Scene.prototype.updateTitle !== 'function') return;
    var updateTitle = Scene.prototype.updateTitle;
    Scene.prototype.updateTitle = function () {
      var result = updateTitle.apply(this, arguments);
      var sprite = this._pressKey;
      if (sprite && sprite !== this[KEPT] && root.ImageManager &&
          sprite.bitmap === ImageManager.loadPicture('INVADER-Boundary')) {
        var previous = this[KEPT];
        if (previous && previous.parent) {
          previous.parent.removeChild(previous);
          item.removed++;
        }
        this[KEPT] = sprite;
      }
      return result;
    };
    item.installed = true;
  }

  if (root.PMJS && root.PMJS.phases && typeof root.PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.perf.space-invaders-boundary', install);
  } else if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('load', install);
  }
  root.OmoriPerfSpaceInvadersBoundary = { installForTest: install };
})();
