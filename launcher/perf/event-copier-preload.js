// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AbdullahTrees. Part of OMORI (PMJS): https://github.com/AbdullahTrees/omori-pmjs
// Read each EventCopier template map once at boot instead of once per template (eventCopierPreload
// item). Game files stay byte-identical.
//
// PMJS only: registers on PMJS.phases 'beforePlugins' and acts while YEP_EventCopier.js is being
// loaded. Under NW.js nothing changes. Disable with OMORI_PERF_DISABLE=eventCopierPreload.
// Counters on `root.OmoriPerf.eventCopierPreload`: `reads` (map files read), `dropped` (repeat
// requests for a file already requested), `installed`.
//
// Why: YEP_EventCopier.js (OMORI's edited copy) preloads template maps when it is evaluated:
// Yanfly.SetupParameters() calls Yanfly.loadMapData(mapId) for each of 237 template names and 18
// template maps. loadMapData sets Yanfly.PreloadedMaps[mapId] = null and starts
// fs.readFile(..., (err, data) => { Yanfly.PreloadedMaps[mapId] = JSON.parse(data.toString()) }).
// Its "already loaded" check is `if (Yanfly.PreloadedMaps[mapId]) return;`, and null is falsy, so
// every call made before the reads complete (all of them: the loop is synchronous) reads and
// parses the map again: 255 reads and JSON.parse calls of 23 maps, 87 MB of JSON instead of 7.2 MB
// (Map003 94 times, Map002 116 times). On the RG40XX-H that is the ~4.8 s frame in Scene_Boot on
// every launch (CPU profile 2026-11-17, evidence/profiles-20261117/); ~1.8x longer on an R36S.
//
// What it does: while PluginManager.loadScript('YEP_EventCopier') runs, fs.readFile passes the
// first request for each path through and drops later requests for the same path (their callback
// is never called). PMJS evaluates plugin scripts synchronously, so fs.readFile is restored
// before anything else runs.
//
// Why it is behaviour-identical:
//   * Every dropped callback would only have assigned Yanfly.PreloadedMaps[mapId] another parse of
//     the same, unchanged file. The kept callback assigns the same content, so the final
//     PreloadedMaps state is equal (one object per map instead of the last of several identical
//     ones; nothing holds the earlier ones: they are overwritten before any event is copied).
//   * Until the read completes the entry is null in both cases, so code that runs early sees the
//     same thing.
//   * Only reads issued during this plugin's load are affected; other plugins and later reads
//     (e.g. a map loaded on demand) are untouched. A failing read fails once instead of N times.
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
  if (disabled.eventCopierPreload) return;
  var PLUGIN = 'yep_eventcopier';

  function install() {
    var api = root.OmoriPerf = root.OmoriPerf || {};
    if (api.eventCopierPreload) return;
    var item = api.eventCopierPreload = { installed: false, reads: 0, dropped: 0 };
    var PM = root.PluginManager;
    if (!PM || typeof PM.loadScript !== 'function') return;
    var load = PM.loadScript;
    PM.loadScript = function (name) {
      if (String(name).replace(/\.js$/i, '').toLowerCase() !== PLUGIN) return load.apply(this, arguments);
      var fs = typeof require === 'function' ? require('fs') : null;
      if (!fs || typeof fs.readFile !== 'function') return load.apply(this, arguments);
      var readFile = fs.readFile;
      var requested = Object.create(null);
      fs.readFile = function (path) {
        var key = String(path);
        if (requested[key]) { item.dropped++; return undefined; }
        requested[key] = true;
        item.reads++;
        return readFile.apply(this, arguments);
      };
      try { return load.apply(this, arguments); }
      finally {
        fs.readFile = readFile;
        console.log('[omori-perf] eventCopierPreload: ' + item.reads + ' map reads, ' + item.dropped +
          ' repeat requests dropped');
      }
    };
    item.installed = true;
    console.log('[omori-perf] eventCopierPreload installed');
  }

  if (root.PMJS && root.PMJS.phases && typeof root.PMJS.phases.on === 'function') {
    root.PMJS.phases.on('beforePlugins', 'omori.perf.event-copier-preload', install);
  }
  root.OmoriPerfEventCopierPreload = { installForTest: install };
})();
