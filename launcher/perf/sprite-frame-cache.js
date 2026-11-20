// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AbdullahTrees. Part of OMORI (PMJS): https://github.com/AbdullahTrees/omori-pmjs
// Runtime performance patch: dirty check on Sprite_Character.updateFrame (frameCache item).
// Game files stay byte-identical.
//
// PMJS loads it with `--patch launcher/perf/sprite-frame-cache.js`; NW.js would load it through
// launcher/compat.js. Disable with OMORI_PERF_DISABLE=frameCache; counters on
// `root.OmoriPerf.frameCache` (`fast` = skipped recomputes, `evaluated` = bodies run). Every
// method whose body the check skips through is pinned to the SHA-256 of Function.prototype.toString
// of the method as composed after all plugins load (LF-normalized; recorded below). If a pin does
// not match, the item installs nothing and logs `[omori-perf] frameCache refused: <method>`.
//
// Why it is behaviour-identical:
//
//   updateFrame recomputes the sprite's frame rectangle every frame for every sprite on the full
//   update path (~15 us each on the RG40XX-H, 1.5 ms of the 4.1 ms sprite main chain at the
//   map-92 save): pattern/block math through characterPatternX/Y and characterBlockX/Y, the bush
//   half-body sync in updateHalfBodySprites, and setFrame. The body is a pure function of the
//   sprite's bitmap (identity AND dimensions — a character sheet can finish loading between
//   frames), the tile id, the character's live characterIndex(), pattern() and direction(), the
//   character's Custom_Character_Rectangles custom-frame fields and EMF frame state, the bush
//   depth, Omori BASE's single-frame flag, the sprite's blend colour, colour tone and blendMode
//   (YEP_CoreEngine syncs it to the half-body sprites), and the map tile size. None of these are
//   written by the body itself, so when every one of them is unchanged since the last run,
//   re-running the body writes exactly the same frame it already set — the skip is
//   value-identical. When anything changed, the body runs exactly as vanilla.
//
//   The check compares LIVE reads (ch.pattern()/direction()/characterIndex()/isSingleFrame() go
//   through whatever composition the plugins installed) against stamps recorded on the last run —
//   so a slippery-tile or ExtraMovementFrames change of pattern(), a page refresh, a direction
//   turn, a bitmap swap or a tile-size event command all show up as a stamp miss and the body
//   reruns. The one-frame bush-depth lag vanilla has (updateOther writes this._bushDepth after
//   updateFrame has read it) is preserved because the stamp is the sprite's own field as read.
//   Blend colour and colour tone are compared by identity: setBlendColor/setColorTone replace the
//   arrays on every real change (and getBlendColor returns a clone, so no caller can reach the
//   internals).
//
//   Stamps live in one hidden holder per sprite (`_omoriFf`, non-enumerable, installed once
//   through putHidden; later misses rewrite its fields, so the hot path does no descriptor
//   lookups): saves keep vanilla's key set; a restored sprite simply misses once and recomputes.
//   The holder records its owner, so a holder reached through the prototype chain or copied onto
//   another object never produces a hit. With `perf.enabled` false the body runs uncached and writes no
//   stamps, so toggling back is seamless. The wrapped chain ABOVE updateFrame (Omori BASE's
//   update bobble/input-icon/shadow adds, Liquid_EventIcons, YEP_EventMiniLabel) is untouched and
//   keeps running every frame as in vanilla.
//
// Pins (sha256 over the LF-normalized Function.prototype.toString source). These are the
// COMPOSED runtime tops, not the file chain: YEP_CoreEngine (plugins.js index 7) wraps
// updateHalfBodySprites; Custom_Character_Rectangles (59) replaces the six pattern/block
// helpers (its patternWidth capture chains through ExtraMovementFrames (55) to vanilla);
// Omori BASE (111) wraps updateCharacterFrame. updateHalfBodySprites' digest is device-
// validated (2026-10-28 refusal line reproduced it exactly).
//
//   updateFrame            (rpg_sprites.js)                 f9fa3e9e43adcbeea4ed8a637aa167b3d9a6f19eb9b040005345dce9c8619f91
//   updateTileFrame        (rpg_sprites.js)                 37433297b83ed276333dc99a5aec8a20c950ad887a454d018a4cc8ac8140abdc
//   updateCharacterFrame   (Omori BASE.js:4759 wrap)        61f013f3e685102f24712e68f58e322320f9d8eeff9a2829c9f892eca7385b61
//   updateHalfBodySprites  (YEP_CoreEngine.js:2190 wrap)    dc65b8c8604adc6a5d1af43015c944195f69dfb3e24e39cb19ee2a766a15a9a4
//   createHalfBodySprites  (rpg_sprites.js)                 3f127fe97cf23fd85ffdb6cc7443ee9273c9b95789c0aea09aee45abc9c6ff71
//   characterBlockX        (Custom_Character_Rectangles.js) 46a829c6b4265898fc47a2077aa9ef5b91640ea111dc46c5877647085d547994
//   characterBlockY        (Custom_Character_Rectangles.js) c7a6a1180963924d85e5690fca7d4c3214723a1ba5745819d6ae8c1276a1a1f4
//   characterPatternX      (Custom_Character_Rectangles.js) 19ee1460e719357be72cf38ed13dceca5b29a4ba8dd9c42ffd05f7c503d37c09
//   characterPatternY      (Custom_Character_Rectangles.js) 6d975bc75b8541627c0d60f094d9dfb073b1451f1b715c16ecad858d69ff89c5
//   patternWidth           (Custom_Character_Rectangles.js) b1bfbf3b8cf68f9a0affbdebd062f1a2e0678aedc2928a33bbe05ed2d5fcda20
//   patternHeight          (Custom_Character_Rectangles.js) c7c648b4ac8f4b5099de26a264a516827ca8cc24ba409119c1592dcc0d3c3b67

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
  function checkPins(item, pins) {
    for (var i = 0; i < pins.length; i++) {
      if (pins[i].digests.length && pins[i].digests.indexOf(digest(pins[i].fn)) < 0) {
        item.refused = pins[i].name;
        console.log('[omori-perf] frameCache refused: ' + pins[i].name +
          ' digest ' + (digest(pins[i].fn) || '(missing)'));
        return false;
      }
    }
    return true;
  }

  function install() {
    if (typeof root.Sprite_Character !== 'function' || typeof root.$gameMap === 'undefined') return;
    // Counter entry created at install time, like screen-position-cache.js, so a module that
    // assigns root.OmoriPerf at file load cannot clobber it.
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.frameCache) return;
    api.frameCache = { installed: false, refused: null, fast: 0, evaluated: 0 };
    var item = api.frameCache;
    if (disabled.frameCache) {
      item.refused = 'disabled by OMORI_PERF_DISABLE';
      return;
    }

    var Sprite_Character = root.Sprite_Character;
    var p = Sprite_Character.prototype;
    if (!checkPins(item, [
      { name: 'updateFrame', fn: p.updateFrame,
        digests: ['f9fa3e9e43adcbeea4ed8a637aa167b3d9a6f19eb9b040005345dce9c8619f91'] },
      { name: 'updateTileFrame', fn: p.updateTileFrame,
        digests: ['37433297b83ed276333dc99a5aec8a20c950ad887a454d018a4cc8ac8140abdc'] },
      { name: 'updateCharacterFrame', fn: p.updateCharacterFrame,
        digests: ['61f013f3e685102f24712e68f58e322320f9d8eeff9a2829c9f892eca7385b61'] },
      { name: 'updateHalfBodySprites', fn: p.updateHalfBodySprites,
        digests: ['dc65b8c8604adc6a5d1af43015c944195f69dfb3e24e39cb19ee2a766a15a9a4'] },
      { name: 'createHalfBodySprites', fn: p.createHalfBodySprites,
        digests: ['3f127fe97cf23fd85ffdb6cc7443ee9273c9b95789c0aea09aee45abc9c6ff71'] },
      { name: 'characterBlockX', fn: p.characterBlockX,
        digests: ['46a829c6b4265898fc47a2077aa9ef5b91640ea111dc46c5877647085d547994'] },
      { name: 'characterBlockY', fn: p.characterBlockY,
        digests: ['c7a6a1180963924d85e5690fca7d4c3214723a1ba5745819d6ae8c1276a1a1f4'] },
      { name: 'characterPatternX', fn: p.characterPatternX,
        digests: ['19ee1460e719357be72cf38ed13dceca5b29a4ba8dd9c42ffd05f7c503d37c09'] },
      { name: 'characterPatternY', fn: p.characterPatternY,
        digests: ['6d975bc75b8541627c0d60f094d9dfb073b1451f1b715c16ecad858d69ff89c5'] },
      { name: 'patternWidth', fn: p.patternWidth,
        digests: ['b1bfbf3b8cf68f9a0affbdebd062f1a2e0678aedc2928a33bbe05ed2d5fcda20'] },
      { name: 'patternHeight', fn: p.patternHeight,
        digests: ['c7c648b4ac8f4b5099de26a264a516827ca8cc24ba409119c1592dcc0d3c3b67'] }
    ])) return;

    var originalUpdateFrame = p.updateFrame;

    // Hidden so JsonEx never sees them: saves keep vanilla's key set.
    function putHidden(obj, name, value) {
      var d = Object.getOwnPropertyDescriptor(obj, name);
      if (d && !d.enumerable && d.writable) obj[name] = value;
      else Object.defineProperty(obj, name, {
        value: value, writable: true, enumerable: false, configurable: true
      });
    }

    p.updateFrame = function () {
      if (api.enabled === false) {
        item.evaluated++;
        return originalUpdateFrame.call(this);
      }
      var ch = this._character;
      if (!ch) {
        item.evaluated++;
        return originalUpdateFrame.call(this);
      }
      // Live reads through whatever composition the plugins installed: a value change of any
      // kind (slippery pose, EMF state, custom frame, page refresh, turn) is a stamp miss, never
      // a stale hit.
      var pattern = ch.pattern(), direction = ch.direction(), single = ch.isSingleFrame();
      var charIndex = ch.characterIndex();
      var emf = ch.isEmfCharacter(), emfNum = emf ? ch.emfCharacterState().frameNum : -1;
      var bm = this.bitmap, bw = bm ? bm.width : -1, bh = bm ? bm.height : -1;
      // h.o === this guards against a holder reached through the prototype chain or copied
      // onto another object (Object.getOwnPropertyDescriptors-style clones): only the sprite's
      // own holder can produce a hit.
      var h = this._omoriFf;
      if (h !== undefined && h !== null && h.o === this &&
          h.bm === bm && h.bw === bw && h.bh === bh &&
          h.ib === this._isBigCharacter && h.t === this._tileId &&
          h.p === pattern && h.d === direction && h.s === single &&
          h.ci === charIndex &&
          h.fx === ch._customFrameX && h.fy === ch._customFrameY &&
          h.fw === ch._customFrameWidth && h.fh === ch._customFrameHeight &&
          h.e === emf && h.ef === emfNum &&
          h.bd === this._bushDepth && h.bl === this._blendColor &&
          h.ct === this._colorTone && h.bmo === this.blendMode &&
          h.tw === $gameMap.tileWidth() && h.th === $gameMap.tileHeight()) {
        item.fast++;
        return;
      }
      item.evaluated++;
      var result = originalUpdateFrame.call(this);
      // Stamped after the run: a body that threw leaves no stamps and reruns next time.
      // One hidden holder per sprite, installed through putHidden once; later misses only
      // rewrite its fields (no descriptor lookup per stamp).
      if (h === undefined || h === null || h.o !== this) {
        h = { o: this, bm: null, bw: 0, bh: 0, ib: false, t: 0, p: 0, d: 0, s: false, ci: 0,
          fx: undefined, fy: undefined, fw: undefined, fh: undefined, e: false, ef: 0, bd: 0,
          bl: null, ct: null, bmo: 0, tw: 0, th: 0 };
        putHidden(this, '_omoriFf', h);
      }
      h.bm = bm;
      h.bw = bw;
      h.bh = bh;
      h.ib = this._isBigCharacter;
      h.t = this._tileId;
      h.p = pattern;
      h.d = direction;
      h.s = single;
      h.ci = charIndex;
      h.fx = ch._customFrameX;
      h.fy = ch._customFrameY;
      h.fw = ch._customFrameWidth;
      h.fh = ch._customFrameHeight;
      h.e = emf;
      h.ef = emfNum;
      h.bd = this._bushDepth;
      h.bl = this._blendColor;
      h.ct = this._colorTone;
      h.bmo = this.blendMode;
      h.tw = $gameMap.tileWidth();
      h.th = $gameMap.tileHeight();
      return result;
    };

    item.installed = true;
  }

  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    PMJS.phases.on('afterPlugins', 'omori.perf.sprite-frame-cache', install);
  } else if (typeof window !== 'undefined') {
    // NW.js: plugins are loaded by the time the window load event fires.
    window.addEventListener('load', install);
  }
})();
