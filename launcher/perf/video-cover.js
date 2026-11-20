// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AbdullahTrees. Part of OMORI (PMJS): https://github.com/AbdullahTrees/omori-pmjs
// Skip drawing (and some visual-only updating of) the map hidden behind a full-screen video.
// Game files stay byte-identical.
//
// Loaded like the other launcher/perf modules (PMJS: one --patch, installed on afterPlugins;
// NW.js: evaluated before main.js, installed on load). `OMORI_PERF_DISABLE=videoCover`
// turns it off; `OmoriPerf.videoCover.enabled = false` does it at runtime.
//
// OMORI plays its cutscene and credits videos with YSP_VideoPlayer: a PIXI sprite in the
// spriteset's _videosContainer, which YSP adds above the map (or battle) layers and below the
// pictures, timer and screen flash/fade. While a 640x480 video plays, the map under it is still
// updated and drawn every frame and then completely painted over; on the RG40XX-H that is
// ~10 ms of drawing and ~8 ms of spriteset updates per frame under the ending credits.
//
// A video COVERS only when everything below proves it paints every screen pixel opaquely:
//   - it is a sprite in the spriteset's own _videosContainer (YSP's layer);
//   - it and every ancestor up to the scene are visible with alpha 1, and neither it nor the
//     container has a mask or filter, and it uses the normal blend mode;
//   - its texture is loaded and its video element has a decoded frame;
//   - its movie file declares no alpha channel (WebM AlphaMode), checked once per file; a file
//     that cannot be read is treated as transparent;
//   - its on-screen rectangle, after all transforms, is axis-aligned and contains the whole
//     screen.
// A video drawn as an effect (smaller, moved, scaled down, faded, blended, masked, filtered or
// with alpha) never covers, so nothing changes for it.
//
// While a video covers:
//   1. Drawing: the spriteset children below _videosContainer are hidden for the duration of
//      the render call only, and restored immediately after it, so game code never sees the
//      change. Layers above the video (pictures, timer, screen fade) and the windows still draw.
//   2. Map updates (Spriteset_Map only, never battle): event sprites that are not busy (no
//      animation, balloon or event-con, settled mini label) take the same short path the
//      launcher's off-screen culling (omori-performance.js) uses: animation/balloon
//      bookkeeping, position and visibility, without pattern/tone/other refreshes; Tiled tile
//      animations pause. The player, followers and busy sprites update fully. Game logic
//      ($gameMap, events, interpreters, battle) is never skipped.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  var stats = { installed: false, enabled: true, disabled: false, refused: null,
    coveredFrames: 0, layersHidden: 0, spriteSkips: 0, tileAnimSkips: 0,
    covering: null, alphaFiles: {}, rejected: {}, errors: [] };
  root.OmoriPerf = root.OmoriPerf || {};
  root.OmoriPerf.videoCover = stats;

  var installed = false;
  var activeMapCover = null;   // the Spriteset_Map being updated while a video covers it
  var lastCoverSrc = null;

  function wasDisabled(id) {
    var list = String(env('OMORI_PERF_DISABLE') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === id) return true;
    }
    return false;
  }

  function refuse(reason) {
    stats.refused = reason;
    console.log('[omori-perf] video cover refused: ' + reason);
  }

  function error(where, e) {
    if (stats.errors.length < 20) stats.errors.push(where + ':' + String(e && e.message || e));
  }

  function reject(reason) {
    stats.rejected[reason] = (stats.rejected[reason] || 0) + 1;
    return false;
  }

  // ---------------------------------------------------------------------------------------
  // Movie alpha: WebM/Matroska Video > AlphaMode (ID 0x53C0) = 1 marks an alpha channel.

  var alphaCache = {};

  function videoUrl(source) {
    var url = source.currentSrc || source.src || '';
    if (!url && source.children && source.children.length) url = source.children[0].src || '';
    return String(url);
  }

  function moviePath(url) {
    var p = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').replace(/[?#].*$/, '');
    try { p = decodeURIComponent(p); } catch (e) { /* keep the raw path */ }
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);          // file:///C:/... on Windows
    var pathMod = require('path');
    if (pathMod.isAbsolute(p) && require('fs').existsSync(p)) return p;
    var base = '';
    try { base = pathMod.dirname(process.mainModule.filename); } catch (e) { base = ''; }
    var rel = p.replace(/^\/+/, '');
    var candidates = [base && pathMod.join(base, rel), rel].filter(Boolean);
    for (var i = 0; i < candidates.length; i++) {
      if (require('fs').existsSync(candidates[i])) return candidates[i];
    }
    return null;
  }

  function headerHasAlpha(bytes, length) {
    for (var i = 0; i + 3 < length; i++) {
      if (bytes[i] === 0x53 && bytes[i + 1] === 0xC0 && bytes[i + 2] === 0x81) {
        return bytes[i + 3] !== 0;
      }
    }
    return false;
  }

  var HEADER_BYTES = 65536;

  function settle(url, bytes, length, failure) {
    var result = false, note;
    if (failure) note = 'unreadable (' + failure + ')';
    // EBML magic: a real Matroska/WebM header, so an absent AlphaMode means opaque.
    else if (length < 4 || bytes[0] !== 0x1A || bytes[1] !== 0x45 || bytes[2] !== 0xDF || bytes[3] !== 0xA3) {
      note = 'not webm';
    } else if (headerHasAlpha(bytes, length)) note = 'alpha';
    else { result = true; note = 'opaque'; }
    alphaCache[url] = result;
    stats.alphaFiles[url] = note;
    console.log('[omori-perf] video cover: ' + url + ' is ' + note);
  }

  // Reads the movie header once: synchronously where fs has openSync/readSync (NW.js), else
  // through a ranged read stream (PMJS guest fs). Until the header is known the video does not
  // cover, so a pending or failed read only means the first frames draw as before.
  function readHeader(url) {
    var fs = require('fs'), file = moviePath(url);
    if (!file) { settle(url, null, 0, 'not found'); return; }
    if (typeof fs.openSync === 'function' && typeof fs.readSync === 'function') {
      var fd = fs.openSync(file, 'r'), bytes = new Uint8Array(HEADER_BYTES), length;
      try { length = fs.readSync(fd, bytes, 0, bytes.length, 0); } finally { fs.closeSync(fd); }
      settle(url, bytes, length, null);
      return;
    }
    var chunks = [], total = 0, done = false;
    var stream = fs.createReadStream(file, { start: 0, end: HEADER_BYTES - 1 });
    function finish(failure) {
      if (done) return;
      done = true;
      var bytes = new Uint8Array(total), offset = 0;
      for (var i = 0; i < chunks.length; i++) { bytes.set(chunks[i], offset); offset += chunks[i].length; }
      settle(url, bytes, total, failure);
    }
    stream.on('data', function (chunk) {
      var view = new Uint8Array(chunk.buffer || chunk, chunk.byteOffset || 0, chunk.length);
      chunks.push(view); total += view.length;
    });
    stream.on('end', function () { finish(null); });
    stream.on('error', function (e) { finish(String(e && e.message || e)); });
  }

  // true = proven opaque; false = alpha channel, unreadable, or not known yet.
  function movieOpaque(source) {
    var url = videoUrl(source);
    if (!url) return false;
    if (alphaCache.hasOwnProperty(url)) return alphaCache[url];
    alphaCache[url] = false;   // pending
    try { readHeader(url); } catch (e) {
      error('alpha', e);
      settle(url, null, 0, String(e && e.message || e));
    }
    return alphaCache[url];
  }

  // ---------------------------------------------------------------------------------------
  // Coverage.

  function hasFilters(node) {
    return !!(node.filters && node.filters.length) || !!node.mask;
  }

  function screenSize() {
    return { width: Graphics.width || Graphics.boxWidth, height: Graphics.height || Graphics.boxHeight };
  }

  function covers(sprite, spriteset) {
    if (!sprite || !sprite.visible || !sprite.renderable || !(sprite.alpha >= 1)) return reject('hidden');
    if (hasFilters(sprite)) return reject('filtered');
    if (sprite.blendMode !== undefined && sprite.blendMode !== 0) return reject('blend');
    var texture = sprite.texture, base = texture && texture.baseTexture;
    if (!base || !base.hasLoaded || texture.valid === false) return reject('unloaded');
    var source = base.source;
    if (!source || !(source.videoWidth > 0) || (source.readyState !== undefined && source.readyState < 2)) {
      return reject('no frame');
    }
    for (var node = sprite.parent; node; node = node.parent) {
      if (!node.visible || !(node.alpha >= 1)) return reject('ancestor hidden');
      if (node === spriteset) break;
    }
    for (node = spriteset.parent; node; node = node.parent) {
      if (!node.visible || !(node.alpha >= 1)) return reject('ancestor hidden');
    }
    var bounds = sprite.getBounds();
    var t = sprite.worldTransform;
    if (!t || Math.abs(t.b) > 1e-6 || Math.abs(t.c) > 1e-6) return reject('rotated');
    var screen = screenSize();
    if (!(bounds.x <= 0 && bounds.y <= 0 &&
          bounds.x + bounds.width >= screen.width && bounds.y + bounds.height >= screen.height)) {
      return reject('partial');
    }
    if (!movieOpaque(source)) return reject('alpha');
    return true;
  }

  // The covering video sprite of a spriteset, or null.
  function coveringVideo(spriteset) {
    var container = spriteset && spriteset._videosContainer;
    if (!container || !container.children || !container.children.length) return null;
    if (container.parent !== spriteset) return null;
    if (!container.visible || !(container.alpha >= 1) || hasFilters(container)) {
      reject('container');
      return null;
    }
    for (var i = container.children.length - 1; i >= 0; i--) {
      var sprite = container.children[i];
      if (covers(sprite, spriteset)) return sprite;
    }
    return null;
  }

  function noteCover(sprite) {
    var src = sprite ? videoUrl(sprite.texture.baseTexture.source) : null;
    if (src === lastCoverSrc) return;
    lastCoverSrc = src;
    stats.covering = src;
    console.log('[omori-perf] video cover ' + (src ? 'on: ' + src : 'off'));
  }

  // ---------------------------------------------------------------------------------------
  // 1. Drawing.

  function hideBelow(scene) {
    var spriteset = scene && scene._spriteset;
    if (!spriteset || !spriteset._videosContainer) { noteCover(null); return null; }
    var sprite = coveringVideo(spriteset);
    noteCover(sprite);
    if (!sprite) return null;
    var children = spriteset.children, hidden = [];
    for (var i = 0; i < children.length && children[i] !== spriteset._videosContainer; i++) {
      if (children[i].visible) { children[i].visible = false; hidden.push(children[i]); }
    }
    stats.coveredFrames++;
    stats.layersHidden += hidden.length;
    return hidden;
  }

  function wrapRender(renderScene) {
    return function () {
      var hidden = null;
      if (stats.enabled) {
        try { hidden = hideBelow(this._scene); } catch (e) { error('hide', e); hidden = null; }
      }
      try { return renderScene.apply(this, arguments); }
      finally {
        if (hidden) for (var i = 0; i < hidden.length; i++) hidden[i].visible = true;
      }
    };
  }

  // ---------------------------------------------------------------------------------------
  // 2. Map updates. The skip rule is omori-performance.js's off-screen rule.

  function busy(sprite, character) {
    return character.animationId() > 0 || character.balloonId() > 0 ||
      (typeof character.eventconId === 'function' && character.eventconId() > 0) ||
      sprite.isAnimationPlaying() || sprite.isBalloonPlaying() ||
      (typeof sprite.isEventconPlaying === 'function' && sprite.isEventconPlaying());
  }

  function labelAllowsSkip(sprite) {
    if (sprite._omoriMiniLabelAbsent) return true;
    var label = sprite._miniLabel;
    if (label) return !label.parent && label._text === '';
    if (sprite._labelDelay === undefined) return typeof sprite.setupMiniLabel !== 'function';
    return sprite._labelDelay > 0;
  }

  function skipEvent(sprite) {
    if (!sprite._miniLabel && sprite._labelDelay > 0) sprite._labelDelay--;
    sprite.updateAnimation();
    if (typeof sprite.updatePosition === 'function') sprite.updatePosition();
    if (typeof sprite.updateVisibility === 'function') sprite.updateVisibility();
  }

  function wrapSpritesetUpdate(update) {
    return function () {
      var outer = activeMapCover;
      var cover = null;
      if (stats.enabled) {
        try { cover = coveringVideo(this) ? this : null; } catch (e) { error('cover', e); cover = null; }
      }
      if (cover) patchTileAnimation(this._tilemap);
      activeMapCover = cover;
      try { return update.apply(this, arguments); }
      finally { activeMapCover = outer; }
    };
  }

  function wrapCharacterUpdate(update) {
    return function () {
      var character = this._character;
      if (activeMapCover && this._omoriCoverSeen && character instanceof Game_Event &&
          !busy(this, character) && labelAllowsSkip(this)) {
        skipEvent(this);
        stats.spriteSkips++;
        return;
      }
      this._omoriCoverSeen = true;
      return update.apply(this, arguments);
    };
  }

  var patchedTileProtos = [];
  function patchTileAnimation(tilemap) {
    if (!tilemap || typeof tilemap._updateAnim !== 'function') return;
    var proto = Object.getPrototypeOf(tilemap);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, '_updateAnim')) proto = Object.getPrototypeOf(proto);
    if (!proto || patchedTileProtos.indexOf(proto) >= 0) return;
    patchedTileProtos.push(proto);
    var updateAnim = proto._updateAnim;
    proto._updateAnim = function () {
      if (activeMapCover && activeMapCover._tilemap === this) { stats.tileAnimSkips++; return; }
      return updateAnim.apply(this, arguments);
    };
  }

  function install() {
    if (installed) return;
    if (wasDisabled('videoCover')) {
      stats.disabled = true;
      console.log('[omori-perf] video cover disabled');
      return;
    }
    if (typeof SceneManager === 'undefined' || typeof SceneManager.renderScene !== 'function' ||
        typeof Spriteset_Base !== 'function' ||
        typeof Spriteset_Base.prototype.createVideos !== 'function') {
      refuse('YSP video layer not found');
      return;
    }
    installed = true;
    SceneManager.renderScene = wrapRender(SceneManager.renderScene);
    if (typeof Spriteset_Map === 'function' && typeof Sprite_Character === 'function' &&
        typeof Game_Event === 'function') {
      Spriteset_Map.prototype.update = wrapSpritesetUpdate(Spriteset_Map.prototype.update);
      Sprite_Character.prototype.update = wrapCharacterUpdate(Sprite_Character.prototype.update);
    }
    stats.installed = true;
    console.log('[omori-perf] video cover installed');
  }

  root.OmoriPerfVideoCover = { stats: stats, installForTest: install, coveringVideo: coveringVideo,
    headerHasAlpha: headerHasAlpha };
  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.video-cover', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
