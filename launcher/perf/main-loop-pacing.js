// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AbdullahTrees. Part of OMORI (PMJS): https://github.com/AbdullahTrees/omori-pmjs
// Real-time logic pacing for OMORI's main loop. Game files stay byte-identical.
//
// Loaded like the other launcher/perf modules (PMJS: one --patch, installed on afterPlugins;
// NW.js: evaluated before main.js, installed on load). `OMORI_PERF_DISABLE=mainLoopPacing`
// turns it off; `OmoriPerf.mainLoopPacing.enabled = false` does it at runtime.
//
// GTP_OmoriFixes replaces RPG Maker's fixed-step accumulator with
//   smooth = 0.8 * smooth + 0.2 * min(delta, 2);  steps = round(smooth)
// where delta is the PIXI ticker's frame time in 60 Hz frames. That is exact at 60 fps and
// wrong everywhere below it:
//   40-60 fps -> 1 step per frame: the game runs in slow motion (50 fps = 0.83x speed);
//   30-40 fps -> 2 steps per frame: the game runs fast (35 fps = 70 steps/s = 1.17x speed).
// It is also bistable on a handheld: a frame slow enough to round to 2 steps doubles the logic
// in the next frames, which keeps them slow, so the game stays at ~30 fps in 2-step mode where
// ~1.5 steps per frame would have kept real time at a higher frame rate.
//
// This module keeps GTP's loop and replaces only the step count: the frame's time is added to
// a carry, the step count is the carry rounded to the nearest step, and the remainder stays in
// the carry. Over any run of frames the game does one step per 16.67 ms of real time. Rounding
// (not flooring) keeps a 60 fps display at exactly one step per frame despite frame-time jitter.
// Like GTP, a frame never runs more than 2 steps; time beyond that is dropped, not caught up,
// so below 30 fps the game slows down as before instead of spiralling.
(function () {
  'use strict';
  var root = typeof globalThis !== 'undefined' ? globalThis : window;

  var MAX_STEPS = 2;

  function env(name) {
    if (root.NativeHost && NativeHost.runtime && typeof NativeHost.runtime.env === 'function') {
      return NativeHost.runtime.env(name);
    }
    return typeof process !== 'undefined' && process.env ? process.env[name] : undefined;
  }

  var stats = { installed: false, enabled: true, disabled: false, refused: null,
    frames: 0, steps: 0, capped: 0, idle: 0 };
  root.OmoriPerf = root.OmoriPerf || {};
  root.OmoriPerf.mainLoopPacing = stats;

  var installed = false;

  function wasDisabled(id) {
    var list = String(env('OMORI_PERF_DISABLE') || '').split(',');
    for (var i = 0; i < list.length; i++) {
      if (list[i].trim() === id) return true;
    }
    return false;
  }

  function refuse(reason) {
    stats.refused = reason;
    console.log('[omori-perf] main loop pacing refused: ' + reason);
  }

  // The step count for one displayed frame. `carry` is the unspent real time, in 60 Hz steps,
  // always in [-0.5, 0.5) after a frame.
  function paceSteps(manager, deltaTime) {
    var delta = Number(deltaTime);
    if (!(delta > 0)) delta = 0;
    var carry = (manager._omoriStepCarry || 0) + Math.min(delta, MAX_STEPS + 1);
    var steps = Math.round(carry);
    if (steps > MAX_STEPS) {
      steps = MAX_STEPS;
      stats.capped++;
      carry = MAX_STEPS;
    }
    if (steps < 0) steps = 0;
    manager._omoriStepCarry = carry - steps;
    stats.frames++;
    stats.steps += steps;
    if (!steps) stats.idle++;
    return steps;
  }

  function install() {
    if (installed) return;
    if (wasDisabled('mainLoopPacing')) {
      stats.disabled = true;
      console.log('[omori-perf] main loop pacing disabled');
      return;
    }
    // Only GTP's loop: its update() asks determineRepeatNumber for the step count. Stock MV's
    // SceneManager has no such method and already uses a fixed-step accumulator.
    if (typeof SceneManager === 'undefined' ||
        typeof SceneManager.determineRepeatNumber !== 'function') {
      refuse('GTP determineRepeatNumber loop not found');
      return;
    }
    installed = true;
    var original = SceneManager.determineRepeatNumber;
    SceneManager.determineRepeatNumber = function (deltaTime) {
      if (!stats.enabled) return original.apply(this, arguments);
      return paceSteps(this, deltaTime);
    };
    stats.installed = true;
    console.log('[omori-perf] main loop pacing installed');
  }

  root.OmoriPerfMainLoopPacing = { stats: stats, installForTest: install, paceSteps: paceSteps };
  if (root.PMJS && PMJS.phases && typeof PMJS.phases.on === 'function') {
    root.PMJS.phases.on('afterPlugins', 'omori.main-loop-pacing', install);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('load', install);
  }
})();
