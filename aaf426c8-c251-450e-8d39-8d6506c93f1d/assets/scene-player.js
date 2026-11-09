/* tli scene player – JSON storyboard (not in data.js).
   Mount: <div class="tli-scene-player" data-scene="scenes/s001.json"></div>
   Scenes have a lines[] array; click a character to replay their line. */
(function (global) {
  'use strict';

  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  /* Icon may fade in this long before a scene or line ends. The panel opens only at the end. */
  var PROF_LEAD_MS = 1200;
  var PROF_WINDOW_MS = 2800;
  var PROF_FADE_MS = 180;
  /* Wall-clock floor. Playback speed does not shorten it. */
  var PROF_MIN_VISIBLE_MS = 7000;
  var ASSET_BASE = (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      var m = /^(.*\/assets\/)scene-player\.js(?:\?|$)/i.exec(src);
      if (m) return m[1];
    }
    return 'assets/';
  })();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function settings() {
    var R = global.TLIReader;
    if (R && typeof R.playerSettings === 'function') return R.playerSettings();
    var out = { audio: true, subtitlesEn: true, subtitlesKm: true, autoAdvance: false, playbackSpeed: 1 };
    try {
      var raw = global.localStorage && global.localStorage.getItem('tli-reader:tli-english-cambodia:v1');
      if (raw) {
        var s = JSON.parse(raw).settings || {};
        if (typeof s.audio === 'boolean') out.audio = s.audio;
        if (typeof s.subtitlesEn === 'boolean') out.subtitlesEn = s.subtitlesEn;
        if (typeof s.subtitlesKm === 'boolean') out.subtitlesKm = s.subtitlesKm;
        if (typeof s.autoAdvance === 'boolean') out.autoAdvance = s.autoAdvance;
        if (typeof s.playbackSpeed === 'number' && s.playbackSpeed > 0) out.playbackSpeed = s.playbackSpeed;
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  function resolveUrl(rel) {
    if (!rel) return '';
    if (/^https?:\/\//i.test(rel) || rel.charAt(0) === '/') return rel;
    if (/^assets\//i.test(rel)) return rel;
    return ASSET_BASE + rel.replace(/^\.\//, '');
  }

  /* A runtime image path is a single relative file name, not a sentence or a design note. */
  function isRuntimeImagePath(rel) {
    if (typeof rel !== 'string') return false;
    var s = rel.trim();
    if (!s || s.length > 240) return false;
    if (/[\s{}*<>]/.test(s)) return false;
    if (/^(?:https?:|data:|blob:)/i.test(s)) return false;
    return /\.(?:png|apng|gif|webp|svg|jpe?g)$/i.test(s);
  }

  function collectFromStoryboard(data, out) {
    function walk(value) {
      if (typeof value === 'string') {
        if (isRuntimeImagePath(value)) out[value] = true;
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) walk(value[i]);
        return;
      }
      Object.keys(value).forEach(function (k) { walk(value[k]); });
    }
    walk(data);
  }

  function collectFromHtml(html, images, scenes) {
    if (typeof html !== 'string' || html.indexOf('<') < 0 && html.indexOf('url(') < 0 && html.indexOf('data-scene') < 0) return;
    var m;
    var imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
    while ((m = imgRe.exec(html))) if (isRuntimeImagePath(m[1])) images[m[1]] = true;
    var urlRe = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
    while ((m = urlRe.exec(html))) if (isRuntimeImagePath(m[1])) images[m[1]] = true;
    var sceneRe = /data-scene=["']([^"']+)["']/gi;
    while ((m = sceneRe.exec(html))) {
      if (/^scenes\/s\d+\.json$/.test(m[1])) scenes[m[1]] = true;
    }
  }

  function collectRuntimeRefs(course) {
    var images = {};
    var scenes = {};
    function walk(value) {
      if (typeof value === 'string') {
        if (isRuntimeImagePath(value)) images[value] = true;
        collectFromHtml(value, images, scenes);
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) walk(value[i]);
        return;
      }
      Object.keys(value).forEach(function (k) { walk(value[k]); });
    }
    if (course) walk(course);
    return { images: images, scenes: scenes };
  }

  /* Detached Image objects. Do not call decode() or createImageBitmap: that can pin an APNG on frame 1. */
  var imageCache = {};
  var storyboardLoads = {};

  function preloadUrl(url) {
    if (!url || imageCache[url]) return imageCache[url] || null;
    var im;
    try { im = new global.Image(); } catch (e) { return null; }
    im.onerror = function () { /* a missing file must not stop the player */ };
    try { im.src = url; } catch (e2) { return null; }
    imageCache[url] = im;
    return im;
  }

  function preloadPath(rel) {
    return preloadUrl(resolveUrl(rel));
  }

  function preloadStoryboard(rel) {
    if (!rel || storyboardLoads[rel]) return storyboardLoads[rel];
    if (typeof global.fetch !== 'function') {
      storyboardLoads[rel] = Promise.resolve();
      return storyboardLoads[rel];
    }
    storyboardLoads[rel] = global.fetch(resolveUrl(rel)).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json();
    }).then(function (data) {
      if (!data) return;
      var paths = {};
      collectFromStoryboard(data, paths);
      Object.keys(paths).forEach(preloadPath);
    }).catch(function () { /* one missing storyboard does not block the rest */ });
    return storyboardLoads[rel];
  }

  function preloadRuntime(data, rel) {
    if (data) {
      if (rel) storyboardLoads[rel] = Promise.resolve();
      var own = {};
      collectFromStoryboard(data, own);
      Object.keys(own).forEach(preloadPath);
    }
    var found = collectRuntimeRefs(global.TLI_DATA);
    Object.keys(found.images).forEach(preloadPath);
    var scenes = found.scenes;
    if (global.document && document.querySelectorAll) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-scene]'), function (el) {
        var sceneRel = el.getAttribute('data-scene');
        if (/^scenes\/s\d+\.json$/.test(sceneRel || '')) scenes[sceneRel] = true;
      });
    }
    Object.keys(scenes).forEach(function (sceneRel) {
      if (rel && sceneRel === rel) return;
      preloadStoryboard(sceneRel);
    });
  }

  function isNum(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function storyDefaultDur(data) {
    return data && isNum(data.defaultDurationMs) ? data.defaultDurationMs : 3500;
  }

  function lineDurationOf(ln, fallback) {
    if (ln && isNum(ln.durationMs) && ln.durationMs >= 0) return ln.durationMs;
    return fallback;
  }

  function lineAtOf(lines, i, fallback) {
    var ln = lines[i];
    if (!ln) return 0;
    if (isNum(ln.atMs) && ln.atMs >= 0) return ln.atMs;
    var t = 0, j;
    for (j = 0; j < i; j++) t += lineDurationOf(lines[j], fallback);
    return t;
  }

  function sceneDurationOf(sc, fallback) {
    if (!sc) return 0;
    if (isNum(sc.durationMs) && sc.durationMs >= 0) return sc.durationMs;
    var lines = (sc.lines && sc.lines.length) ? sc.lines : [];
    if (!lines.length) return fallback;
    var max = 0, i, end;
    for (i = 0; i < lines.length; i++) {
      end = lineAtOf(lines, i, fallback) + lineDurationOf(lines[i], fallback);
      if (end > max) max = end;
    }
    return max || fallback;
  }

  function resolvedLead(data, ex) {
    if (ex && isNum(ex.leadMs) && ex.leadMs >= 0) return ex.leadMs;
    var p = data && data.professor;
    if (p && isNum(p.leadMs) && p.leadMs >= 0) return p.leadMs;
    return PROF_LEAD_MS;
  }

  function resolvedWindow(data, ex) {
    if (ex && isNum(ex.windowMs) && ex.windowMs > 0) return ex.windowMs;
    var p = data && data.professor;
    if (p && isNum(p.windowMs) && p.windowMs > 0) return p.windowMs;
    return PROF_WINDOW_MS;
  }

  function scopeEndOf(data, sc, ex) {
    var fallback = storyDefaultDur(data);
    var lines = (sc && sc.lines) || [];
    if (!ex || ex.scope === 'scene') return sceneDurationOf(sc, fallback);
    if (ex.scope === 'line' && isNum(ex.line) && ex.line >= 0 && ex.line < lines.length && Math.floor(ex.line) === ex.line) {
      return lineAtOf(lines, ex.line, fallback) + lineDurationOf(lines[ex.line], fallback);
    }
    return null;
  }

  /* openAt is the icon. readyAt is the scope end: the words may be opened only after the scene or line has finished. */
  function availabilityOf(data, sc, ex) {
    var end = scopeEndOf(data, sc, ex);
    if (end == null) return null;
    var lead = resolvedLead(data, ex);
    var win = resolvedWindow(data, ex);
    return { scopeEnd: end, openAt: end - lead, readyAt: end, closeAt: end + win, leadMs: lead, windowMs: win };
  }

  function windowsOverlap(a, b) {
    return a.openAt < b.closeAt && b.openAt < a.closeAt;
  }

  /* Optional professor explanations. Missing professor/explanations is valid.
     The checker accepts a scope and a clock. It does not judge the sentences. */
  function validateStory(data) {
    var errors = [];
    if (!data || typeof data !== 'object' || !Array.isArray(data.scenes)) {
      errors.push('scenes must be an array');
      return errors;
    }
    var hasExplanations = data.scenes.some(function (sc) {
      return sc && sc.explanations != null && sc.explanations.length !== 0;
    });
    var prof = data.professor;
    if (hasExplanations && (prof == null || typeof prof !== 'object')) {
      errors.push('professor is required when a scene has explanations');
    }
    if (prof != null) {
      if (typeof prof !== 'object') errors.push('professor must be an object');
      else {
        if (!prof.id) errors.push('professor.id is required when professor is set');
        if (Object.prototype.hasOwnProperty.call(prof, 'cueMs')) {
          errors.push('professor.cueMs is not a window; set leadMs and windowMs');
        }
        if (prof.leadMs != null && !(isNum(prof.leadMs) && prof.leadMs >= 0)) {
          errors.push('professor.leadMs must be a number of milliseconds, zero or more');
        }
        if (prof.windowMs != null && !(isNum(prof.windowMs) && prof.windowMs > 0)) {
          errors.push('professor.windowMs must be a positive number of milliseconds');
        }
        if (prof.minVisibleMs != null && !(isNum(prof.minVisibleMs) && prof.minVisibleMs >= PROF_MIN_VISIBLE_MS)) {
          errors.push('professor.minVisibleMs must be at least ' + PROF_MIN_VISIBLE_MS + ' milliseconds of real time');
        }
        if (prof.icon != null && typeof prof.icon !== 'string') errors.push('professor.icon must be a path');
        if (prof.avatar != null && typeof prof.avatar !== 'string') errors.push('professor.avatar must be a path');
        if (prof.sprites != null && typeof prof.sprites !== 'object') errors.push('professor.sprites must be an object');
        else if (prof.sprites) {
          Object.keys(prof.sprites).forEach(function (key) {
            var path = prof.sprites[key];
            if (path != null && typeof path !== 'string') errors.push('professor.sprites.' + key + ' must be a path');
          });
        }
        if (prof.lipSync != null && prof.lipSync !== false) {
          errors.push('professor.lipSync cannot be true; the talking picture is not matched to the sound');
        }
        if (prof.gender != null && prof.gender !== 'female' && prof.gender !== 'male') {
          errors.push('professor.gender must be female or male');
        }
        if (hasExplanations) {
          if (typeof prof.icon !== 'string' || !prof.icon) {
            errors.push('professor.icon is required when a scene has explanations');
          }
          var idle = prof.sprites && prof.sprites.idle;
          if (!idle && !prof.avatar) {
            errors.push('professor.sprites.idle or professor.avatar is required when a scene has explanations');
          }
        }
      }
    }
    var actors = data.actors;
    if (actors != null && typeof actors === 'object') {
      Object.keys(actors).forEach(function (aid) {
        var actor = actors[aid];
        if (!actor || typeof actor !== 'object') return;
        if (actor.gender != null && actor.gender !== 'female' && actor.gender !== 'male'
            && actor.gender !== 'girl' && actor.gender !== 'boy') {
          errors.push('actor ' + aid + ' gender must be female, male, girl, or boy');
        }
      });
    }
    data.scenes.forEach(function (sc, si) {
      if (!sc || sc.explanations == null) return;
      var label = sc.id || si;
      if (!Array.isArray(sc.explanations)) {
        errors.push('scene ' + label + ' explanations must be an array');
        return;
      }
      var lines = sc.lines || [];
      var windows = [];
      var sceneEnd = sceneDurationOf(sc, storyDefaultDur(data));
      sc.explanations.forEach(function (ex) {
        var id = (ex && ex.id) || ('scene ' + label);
        if (!ex || !ex.id) errors.push(id + ' needs an id');
        if (!ex) return;
        if (!ex.text || typeof ex.text.en !== 'string' || !ex.text.en) errors.push(id + ' needs text.en');
        else if (ex.text.km != null && typeof ex.text.km !== 'string') errors.push(id + ' text.km must be a string');
        if (Object.prototype.hasOwnProperty.call(ex, 'cueMs')) {
          errors.push(id + ' cueMs is not a window; set leadMs and windowMs');
        }
        if (Object.prototype.hasOwnProperty.call(ex, 'atMs')) {
          errors.push(id + ' atMs is not the availability clock; set scope to scene or line');
        }
        if (ex.scope !== 'scene' && ex.scope !== 'line') errors.push(id + ' scope must be scene or line');
        else if (ex.scope === 'scene' && Object.prototype.hasOwnProperty.call(ex, 'line')) {
          errors.push(id + ' scene scope must not reference a line');
        } else if (ex.scope === 'line') {
          var lineOk = isNum(ex.line) && Math.floor(ex.line) === ex.line && ex.line >= 0 && ex.line < lines.length;
          if (!lineOk) errors.push(id + ' line scope needs a line index in this scene');
        }
        if (ex.leadMs != null && !(isNum(ex.leadMs) && ex.leadMs >= 0)) {
          errors.push(id + ' leadMs must be a number of milliseconds, zero or more');
        }
        if (ex.windowMs != null && !(isNum(ex.windowMs) && ex.windowMs > 0)) {
          errors.push(id + ' windowMs must be a positive number of milliseconds');
        }
        if (ex.durationMs != null && !(isNum(ex.durationMs) && ex.durationMs > 0)) {
          errors.push(id + ' durationMs must be a positive number');
        }
        if (ex.audio) {
          ['en', 'km'].forEach(function (code) {
            if (ex.audio[code] != null && typeof ex.audio[code] !== 'string') errors.push(id + ' audio.' + code + ' must be a path or null');
          });
        }
        if (ex.subtitles) {
          ['en', 'km'].forEach(function (code) {
            var cues = ex.subtitles[code];
            if (cues == null) return;
            if (!Array.isArray(cues)) { errors.push(id + ' subtitles.' + code + ' must be an array'); return; }
            cues.forEach(function (c, ci) {
              if (!c || typeof c.atMs !== 'number' || typeof c.text !== 'string') {
                errors.push(id + ' subtitles.' + code + '[' + ci + '] needs atMs and text');
              }
            });
          });
        }
        if (ex.scope === 'scene' || ex.scope === 'line') {
          var window = availabilityOf(data, sc, ex);
          if (!window) return;
          if (window.openAt < 0) errors.push(id + ' leadMs is longer than its ' + ex.scope);
          if (ex.scope === 'line' && window.scopeEnd > sceneEnd) errors.push(id + ' line ends after the scene');
          windows.forEach(function (prev) {
            if (windowsOverlap(prev.window, window)) errors.push(id + ' availability overlaps ' + prev.id);
          });
          windows.push({ id: id, window: window });
        }
      });
    });
    return errors;
  }

  function Player(root, data) {
    this.root = root;
    root._tliPlayer = this; /* test / debug hook */
    this.data = data;
    this.scenes = data.scenes || [];
    this.actors = data.actors || data.characters || {};
    this.index = 0;
    this.lineIndex = 0;
    this.playing = false;
    this.ended = false;
    this.awaitingStart = true; /* big-play overlay until first Play; not restored on mid-story pause */
    this.sceneComplete = false;
    this.timer = null;
    this.lineTimer = null;
    this.raf = null;
    this.sceneStartedAt = 0;
    this.pausedElapsed = 0; /* nominal ms into current scene */
    this.lastSpokenByActor = {}; /* actorId -> line object in current scene */
    this.audioEl = null;
    this.profLang = 'en';
    this.profElapsed = 0;
    this.profPlaying = false;
    this._profAvailHandles = [];
    this._profCueTimers = [];
    this._cueEpoch = 0;
    this._profArm = null;
    this._profHold = null;
    this._cueHideToken = 0;
    this._profOpening = false;
    this._profSyncing = false;
    this._cueShownAt = null; /* wall clock when the icon became visible */
    this._cueHeldEx = null; /* latest explanation the icon may still open */
    this._cueHeldReady = false;
    this._settingProgress = false;
    this._lineReplayActor = null; /* set only while a paused character replay is actually sounding */
    this._spriteCache = [];
    this._voiceChoice = {};
    this._profTick = null;
    this._build();
    this._bind();
    this._preloadSprites();
    this.goTo(0, { auto: false });
  }

  Player.prototype.defaultDur = function () {
    return typeof this.data.defaultDurationMs === 'number' ? this.data.defaultDurationMs : 3500;
  };

  Player.prototype.linesOf = function (sc) {
    if (!sc) return [];
    if (sc.lines && sc.lines.length) return sc.lines;
    /* legacy one-speaker scene (should not appear after v1.6.2 migrate) */
    if (sc.speaker || sc.text) {
      return [{ speaker: sc.speaker, text: sc.text, translations: sc.translations || (sc.textKm ? { km: sc.textKm } : {}), audio: sc.audio, durationMs: sc.durationMs, atMs: 0 }];
    }
    return [];
  };

  Player.prototype.lineDuration = function (ln) {
    if (ln && typeof ln.durationMs === 'number' && ln.durationMs >= 0) return ln.durationMs;
    return this.defaultDur();
  };

  Player.prototype.lineAt = function (lines, i) {
    var ln = lines[i];
    if (!ln) return 0;
    if (typeof ln.atMs === 'number' && ln.atMs >= 0) return ln.atMs;
    var t = 0, j;
    for (j = 0; j < i; j++) t += this.lineDuration(lines[j]);
    return t;
  };

  Player.prototype.sceneDuration = function (sc) {
    if (!sc) return 0;
    if (typeof sc.durationMs === 'number' && sc.durationMs >= 0) return sc.durationMs;
    var lines = this.linesOf(sc), max = 0, i, end;
    if (!lines.length) return this.defaultDur();
    for (i = 0; i < lines.length; i++) {
      end = this.lineAt(lines, i) + this.lineDuration(lines[i]);
      if (end > max) max = end;
    }
    return max || this.defaultDur();
  };

  Player.prototype.delayOf = function (sc) {
    return (sc && typeof sc.delayMs === 'number' && sc.delayMs > 0) ? sc.delayMs : 0;
  };

  Player.prototype.speed = function () {
    var sp = settings().playbackSpeed;
    return (typeof sp === 'number' && sp > 0) ? sp : 1;
  };

  Player.prototype.totalMs = function () {
    var t = 0, i;
    for (i = 0; i < this.scenes.length; i++) t += this.sceneDuration(this.scenes[i]) + this.delayOf(this.scenes[i]);
    return t || 1;
  };

  Player.prototype.offsetOf = function (idx) {
    var t = 0, i;
    for (i = 0; i < idx && i < this.scenes.length; i++) t += this.sceneDuration(this.scenes[i]) + this.delayOf(this.scenes[i]);
    return t;
  };

  Player.prototype._build = function () {
    var title = this.data.title || this.data.id || 'Story';
    var speedOpts = SPEEDS.map(function (s) {
      return '<option value="' + s + '"' + (s === 1 ? ' selected' : '') + '>' + (s === 1 ? '1x' : s + 'x') + '</option>';
    }).join('');
    this.root.classList.add('tli-sp');
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Story: ' + title);
    this.root.innerHTML =
      '<div class="tli-sp-stage-wrap">' +
        '<div class="tli-sp-stage" tabindex="0">' +
          '<div class="tli-sp-bg" aria-hidden="true"></div>' +
          '<div class="tli-sp-actors" aria-live="off"></div>' +
          '<button type="button" class="tli-sp-bigplay" aria-label="Play story">' +
            '<i class="fa-solid fa-play" aria-hidden="true"></i><span class="visually-hidden">Play</span>' +
          '</button>' +
          '<button type="button" class="tli-sp-prof-cue" hidden aria-label="Professor Mordechai can explain">' +
            '<img alt="" class="tli-sp-prof-cue-img" hidden>' +
            '<span class="tli-sp-prof-cue-fallback" aria-hidden="true">PM</span>' +
          '</button>' +
        '</div>' +
        '<div class="tli-sp-prof" hidden role="dialog" aria-label="Professor Mordechai">' +
          '<div class="tli-sp-prof-top">' +
            '<select class="tli-sp-prof-lang" hidden aria-label="Professor language">' +
              '<option value="en">EN</option>' +
              '<option value="km">KH</option>' +
            '</select>' +
            '<button type="button" class="tli-sp-btn tli-sp-prof-close" aria-label="Close professor"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
          '</div>' +
          '<div class="tli-sp-prof-face" aria-hidden="true">' +
            '<img alt="" class="tli-sp-prof-img" hidden>' +
            '<span class="tli-sp-prof-fallback">PM</span>' +
          '</div>' +
          '<p class="tli-sp-prof-name">Professor Mordechai</p>' +
          '<p class="visually-hidden tli-sp-prof-picture-note">The picture can move while he speaks. The movement is not matched to the sound.</p>' +
          '<p class="tli-sp-prof-text" lang="en"></p>' +
          '<p class="tli-sp-prof-status" role="status"></p>' +
          '<div class="tli-sp-prof-controls">' +
            '<button type="button" class="tli-sp-btn tli-sp-prof-prev" aria-label="Previous part" disabled><i class="fa-solid fa-backward-step" aria-hidden="true"></i></button>' +
            '<button type="button" class="tli-sp-btn tli-sp-prof-play" aria-label="Play explanation"><i class="fa-solid fa-play" aria-hidden="true"></i></button>' +
            '<button type="button" class="tli-sp-btn tli-sp-prof-next" aria-label="Next part"><i class="fa-solid fa-forward-step" aria-hidden="true"></i></button>' +
            '<span class="tli-sp-prof-count" aria-live="polite">1 / 1</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tli-sp-subs" hidden>' +
        '<div class="tli-sp-sub-en" lang="en"></div>' +
        '<div class="tli-sp-sub-km" lang="km"></div>' +
      '</div>' +
      '<div class="tli-sp-bar" role="toolbar" aria-label="Story controls">' +
        '<button type="button" class="tli-sp-btn tli-sp-prev" aria-label="Previous scene" title="Previous"><i class="fa-solid fa-backward-step" aria-hidden="true"></i></button>' +
        '<button type="button" class="tli-sp-btn tli-sp-play" aria-label="Play" title="Play"><i class="fa-solid fa-play" aria-hidden="true"></i></button>' +
        '<button type="button" class="tli-sp-btn tli-sp-next" aria-label="Next scene" title="Next"><i class="fa-solid fa-forward-step" aria-hidden="true"></i></button>' +
        '<button type="button" class="tli-sp-btn tli-sp-replay" aria-label="Replay scene" title="Replay scene"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i></button>' +
        '<button type="button" class="tli-sp-btn tli-sp-autoadv" aria-pressed="false" aria-label="Autoplay off" title="Autoplay"><i class="fa-solid fa-forward-fast" aria-hidden="true"></i></button>' +
        '<div class="tli-sp-progress-wrap"><input type="range" class="tli-sp-progress" min="0" max="1000" value="0" step="1" aria-label="Story progress"></div>' +
        '<span class="tli-sp-counter" aria-live="polite">1 / 1</span>' +
        '<button type="button" class="tli-sp-btn tli-sp-audio" aria-pressed="true" aria-label="Audio on" title="Audio"><i class="fa-solid fa-volume-high" aria-hidden="true"></i></button>' +
        '<button type="button" class="tli-sp-btn tli-sp-cc-en" aria-pressed="true" aria-label="English subtitles on" title="English subtitles">EN</button>' +
        '<button type="button" class="tli-sp-btn tli-sp-cc-km" aria-pressed="true" aria-label="Khmer subtitles on" title="Khmer subtitles">ខ្មែរ</button>' +
        '<label class="tli-sp-speed-wrap" title="Playback speed"><span class="visually-hidden">Speed</span>' +
          '<select class="tli-sp-speed" aria-label="Playback speed">' + speedOpts + '</select></label>' +
        '<button type="button" class="tli-sp-btn tli-sp-fs" aria-label="Fullscreen" title="Fullscreen"><i class="fa-solid fa-expand" aria-hidden="true"></i></button>' +
      '</div>';
    this.stage = this.root.querySelector('.tli-sp-stage');
    this.bg = this.root.querySelector('.tli-sp-bg');
    this.actorsEl = this.root.querySelector('.tli-sp-actors');
    this.bigPlay = this.root.querySelector('.tli-sp-bigplay');
    this.subs = this.root.querySelector('.tli-sp-subs');
    this.subEn = this.root.querySelector('.tli-sp-sub-en');
    this.subKm = this.root.querySelector('.tli-sp-sub-km');
    this.btnPlay = this.root.querySelector('.tli-sp-play');
    this.btnPrev = this.root.querySelector('.tli-sp-prev');
    this.btnNext = this.root.querySelector('.tli-sp-next');
    this.btnReplay = this.root.querySelector('.tli-sp-replay');
    this.btnAudio = this.root.querySelector('.tli-sp-audio');
    this.btnEn = this.root.querySelector('.tli-sp-cc-en');
    this.btnKm = this.root.querySelector('.tli-sp-cc-km');
    this.btnAuto = this.root.querySelector('.tli-sp-autoadv');
    this.speedSel = this.root.querySelector('.tli-sp-speed');
    this.btnFs = this.root.querySelector('.tli-sp-fs');
    this.progress = this.root.querySelector('.tli-sp-progress');
    this.counter = this.root.querySelector('.tli-sp-counter');
    this.cueBtn = this.root.querySelector('.tli-sp-prof-cue');
    this.cueImg = this.root.querySelector('.tli-sp-prof-cue-img');
    this.cueFallback = this.root.querySelector('.tli-sp-prof-cue-fallback');
    this.profPanel = this.root.querySelector('.tli-sp-prof');
    this.profImg = this.root.querySelector('.tli-sp-prof-img');
    this.profFallback = this.root.querySelector('.tli-sp-prof-fallback');
    this.profText = this.root.querySelector('.tli-sp-prof-text');
    this.profStatus = this.root.querySelector('.tli-sp-prof-status');
    this.profPlay = this.root.querySelector('.tli-sp-prof-play');
    this.profPrev = this.root.querySelector('.tli-sp-prof-prev');
    this.profNext = this.root.querySelector('.tli-sp-prof-next');
    this.profCount = this.root.querySelector('.tli-sp-prof-count');
    this.profLangSel = this.root.querySelector('.tli-sp-prof-lang');
    this.profClose = this.root.querySelector('.tli-sp-prof-close');
    this._syncSettingButtons();
    this._syncProfLang();
  };

  Player.prototype._syncSettingButtons = function () {
    var s = settings();
    this.btnAudio.setAttribute('aria-pressed', s.audio ? 'true' : 'false');
    this.btnAudio.setAttribute('aria-label', s.audio ? 'Audio on' : 'Audio off');
    this.btnAudio.title = s.audio ? 'Audio on' : 'Audio off (bypassed)';
    this.btnAudio.innerHTML = s.audio
      ? '<i class="fa-solid fa-volume-high" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-volume-xmark" aria-hidden="true"></i>';
    this.btnEn.setAttribute('aria-pressed', s.subtitlesEn ? 'true' : 'false');
    this.btnEn.classList.toggle('is-on', !!s.subtitlesEn);
    this.btnKm.setAttribute('aria-pressed', s.subtitlesKm ? 'true' : 'false');
    this.btnKm.classList.toggle('is-on', !!s.subtitlesKm);
    var aa = !!s.autoAdvance;
    this.btnAuto.setAttribute('aria-pressed', aa ? 'true' : 'false');
    this.btnAuto.setAttribute('aria-label', aa ? 'Autoplay on' : 'Autoplay off');
    this.btnAuto.title = aa ? 'Autoplay on' : 'Autoplay off';
    this.btnAuto.classList.toggle('is-on', aa);
    this.btnAuto.innerHTML = '<i class="fa-solid fa-forward-fast" aria-hidden="true"></i>';
    var sp = this.speed();
    if (String(this.speedSel.value) !== String(sp)) this.speedSel.value = String(sp);
  };

  Player.prototype._localSet = function (key, value) {
    try {
      var storeKey = 'tli-reader:tli-english-cambodia:v1';
      var raw = global.localStorage.getItem(storeKey);
      var st = raw ? JSON.parse(raw) : { edits: {}, removals: {}, comments: {}, settings: {} };
      st.settings = st.settings || {};
      st.settings[key] = value;
      global.localStorage.setItem(storeKey, JSON.stringify(st));
    } catch (e) { /* ignore */ }
  };

  Player.prototype._bind = function () {
    var self = this;
    this.btnPlay.addEventListener('click', function () { if (self.playing) self.pause(); else self.play(); });
    this.bigPlay.addEventListener('click', function () { self.play(); });
    this.btnPrev.addEventListener('click', function () { self.prev(); });
    this.btnNext.addEventListener('click', function () { self.next(); });
    this.btnReplay.addEventListener('click', function () { self.replayScene(); });
    this.btnAudio.addEventListener('click', function () {
      if (global.TLIReader && global.TLIReader.setAudio) global.TLIReader.setAudio(!settings().audio);
      else self._localSet('audio', !settings().audio);
      self._syncSettingButtons();
    });
    this.btnEn.addEventListener('click', function () {
      if (global.TLIReader && global.TLIReader.setSubtitlesEn) global.TLIReader.setSubtitlesEn(!settings().subtitlesEn);
      else self._localSet('subtitlesEn', !settings().subtitlesEn);
      self._syncSettingButtons(); self._showLine(self._currentLine());
    });
    this.btnKm.addEventListener('click', function () {
      if (global.TLIReader && global.TLIReader.setSubtitlesKm) global.TLIReader.setSubtitlesKm(!settings().subtitlesKm);
      else self._localSet('subtitlesKm', !settings().subtitlesKm);
      self._syncSettingButtons(); self._showLine(self._currentLine());
    });
    this.btnAuto.addEventListener('click', function () {
      var next = !settings().autoAdvance;
      if (global.TLIReader && global.TLIReader.setAutoAdvance) global.TLIReader.setAutoAdvance(next);
      else self._localSet('autoAdvance', next);
      self._syncSettingButtons();
      if (next && self.sceneComplete && self.index < self.scenes.length - 1 && !self.playing) {
        self.play(); /* continue into following scenes without stopping between them */
      } else if (self.playing) {
        self._scheduleFromPaused();
      }
    });
    this.speedSel.addEventListener('change', function () {
      var v = parseFloat(self.speedSel.value) || 1;
      if (global.TLIReader && global.TLIReader.setPlaybackSpeed) global.TLIReader.setPlaybackSpeed(v);
      else self._localSet('playbackSpeed', v);
      self._syncSettingButtons();
      if (self.playing) self._scheduleFromPaused();
    });
    this.btnFs.addEventListener('click', function () { self.toggleFullscreen(); });
    this.progress.addEventListener('input', function () {
      if (self._settingProgress) return; /* a scripted value must not count as a seek */
      self.seekMs(((+self.progress.value) / 1000) * self.totalMs());
    });
    window.addEventListener('resize', function () {
      Array.prototype.forEach.call(self.actorsEl.children, function (btn) { self._placeActor(btn); });
    });
    this.actorsEl.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-actor]');
      if (!btn) return;
      self.repeatActor(btn.getAttribute('data-actor'));
    });
    document.addEventListener('tli-player-settings', function () {
      self._syncSettingButtons();
      self._showLine(self._currentLine());
      if (!settings().audio) self._stopAudio();
      if (self.playing) self._scheduleFromPaused();
    });
    document.addEventListener('fullscreenchange', function () { self._syncFsButton(); });
    document.addEventListener('webkitfullscreenchange', function () { self._syncFsButton(); });
    this.cueBtn.addEventListener('click', function () { self.openProfessor(); });
    this.profPlay.addEventListener('click', function () {
      if (self.profPlaying) self._pauseProfessor();
      else self.playProfessor();
    });
    this.profPrev.addEventListener('click', function () { self._stepProfessor(-1); });
    this.profNext.addEventListener('click', function () { self._stepProfessor(1); });
    this.profClose.addEventListener('click', function () { self._closeProfessor(true, true); });
    this.profLangSel.addEventListener('change', function () { self.setProfessorLang(self.profLangSel.value); });
    this.profPanel.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); self._closeProfessor(true, true); }
    });
    this._onPageHide = function () {
      self._pauseProfessor();
      self._clearTimers();
    };
    window.addEventListener('pagehide', this._onPageHide);
  };

  Player.prototype._fsElement = function () {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  };
  Player.prototype._syncFsButton = function () {
    var on = this._fsElement() === this.root;
    this.root.classList.toggle('is-fullscreen', on);
    this.btnFs.innerHTML = on
      ? '<i class="fa-solid fa-compress" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-expand" aria-hidden="true"></i>';
    this.btnFs.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
  };
  Player.prototype.toggleFullscreen = function () {
    var el = this.root;
    try {
      if (this._fsElement() === el) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
      }
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) { /* ignore */ }
  };

  Player.prototype._stopAudio = function () {
    if (this.audioEl) {
      try { this.audioEl.pause(); this.audioEl.removeAttribute('src'); this.audioEl.load(); } catch (e) { /* ignore */ }
      this.audioEl = null;
    }
    this._utterance = null;
    if (global.speechSynthesis) {
      try { global.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }
  };

  /* Browser voices have no gender field. These names are the ones Windows, macOS, and Chrome label as female or male. A name that is not in this list stays unused for matching. */
  var FEMALE_VOICE = { zira: 1, aria: 1, jenny: 1, ana: 1, emma: 1, sonia: 1, libby: 1, michelle: 1, heather: 1, hazel: 1, samantha: 1, victoria: 1, karen: 1, moira: 1, kate: 1, serena: 1, fiona: 1, veena: 1, tessa: 1, allison: 1, ava: 1, susan: 1, linda: 1 };
  var MALE_VOICE = { david: 1, mark: 1, guy: 1, andrew: 1, brian: 1, ryan: 1, eric: 1, george: 1, james: 1, daniel: 1, alex: 1, fred: 1, tom: 1, rishi: 1, lee: 1 };

  function englishRank(voice) {
    var lang = String((voice && voice.lang) || '').replace(/_/g, '-').toLowerCase();
    if (lang === 'en-us') return 0;
    if (lang === 'en-gb') return 1;
    if (lang.indexOf('en-') === 0) return 2;
    if (lang === 'en') return 3;
    return 99;
  }

  function labeledGender(voice) {
    var name = String((voice && voice.name) || '');
    if (/\bgirl\b/i.test(name)) return 'girl';
    if (/\bboy\b/i.test(name)) return 'boy';
    if (/\bchild\b/i.test(name) && /\bfemale\b/i.test(name)) return 'girl';
    if (/\bchild\b/i.test(name) && /\bmale\b/i.test(name)) return 'boy';
    if (/\bfemale\b/i.test(name)) return 'female';
    if (/\bmale\b/i.test(name)) return 'male';
    var parts = name.split(/[^A-Za-z]+/);
    var i, token;
    for (i = 0; i < parts.length; i++) {
      token = parts[i].toLowerCase();
      if (FEMALE_VOICE[token]) return 'female';
      if (MALE_VOICE[token]) return 'male';
    }
    return '';
  }

  /* Pitch ladder when the chosen voice is not a matching gendered label (common on Android). */
  var MALE_FALLBACK_PITCH = 0.7;
  var FEMALE_FALLBACK_PITCH = 1.25;
  var BOY_PITCH = 1.6;
  var GIRL_PITCH = 1.9;
  /* CHILD_PITCH removed: boy/girl use distinct BOY_PITCH / GIRL_PITCH. */

  function adultHint(hint) {
    if (hint === 'boy') return 'male';
    if (hint === 'girl') return 'female';
    if (hint === 'male' || hint === 'female') return hint;
    return '';
  }

  function fallbackPitchForHint(hint) {
    if (hint === 'male') return MALE_FALLBACK_PITCH;
    if (hint === 'female') return FEMALE_FALLBACK_PITCH;
    if (hint === 'boy') return BOY_PITCH;
    if (hint === 'girl') return GIRL_PITCH;
    return 1;
  }

  /* Dedicated match keeps pitch 1; otherwise use the fallback ladder (Android unlabeled voices). */
  function pitchForVoiceHint(hint, voice) {
    if (!hint) return 1;
    if (voice && labeledGender(voice) === hint) return 1;
    return fallbackPitchForHint(hint);
  }

  function utteranceLangFor(voice) {
    if (voice && voice.lang) return String(voice.lang).replace(/_/g, '-');
    return 'en-US';
  }

  Player.prototype._ensureVoiceListener = function () {
    var synth = global.speechSynthesis;
    if (this._voiceListen || !synth) return;
    this._voiceListen = true;
    var self = this;
    var note = function () { self._voicesChanged = true; };
    if (synth.addEventListener) synth.addEventListener('voiceschanged', note);
    else synth.onvoiceschanged = note;
  };

  /* hint is female, male, girl, boy, or empty. Boy/girl prefer a child-labeled voice, else adult male/female. */
  Player.prototype._voiceForGender = function (hint, key) {
    this._ensureVoiceListener();
    if (!global.speechSynthesis || !global.speechSynthesis.getVoices) return null;
    var voices = global.speechSynthesis.getVoices() || [];
    var english = [];
    var i;
    for (i = 0; i < voices.length; i++) {
      if (englishRank(voices[i]) < 99) english.push(voices[i]);
    }
    if (!english.length) return null;
    english.sort(function (a, b) {
      var d = englishRank(a) - englishRank(b);
      if (d) return d;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    var child = hint === 'boy' || hint === 'girl' ? hint : '';
    var want = adultHint(hint);
    var cacheKey = key || hint || 'english';
    var cached = this._voiceChoice[cacheKey];
    if (cached) {
      for (i = 0; i < english.length; i++) {
        if (english[i].name === cached) return english[i];
      }
    }
    var pool = english;
    if (child) {
      var childMatched = [];
      for (i = 0; i < english.length; i++) {
        if (labeledGender(english[i]) === child) childMatched.push(english[i]);
      }
      if (childMatched.length) pool = childMatched;
      else if (want) {
        var adultMatched = [];
        for (i = 0; i < english.length; i++) {
          if (labeledGender(english[i]) === want) adultMatched.push(english[i]);
        }
        if (adultMatched.length) pool = adultMatched;
      }
    } else if (want) {
      var matched = [];
      for (i = 0; i < english.length; i++) {
        if (labeledGender(english[i]) === want) matched.push(english[i]);
      }
      if (matched.length) pool = matched;
    }
    var chosen = pool[0];
    if (chosen && chosen.name) this._voiceChoice[cacheKey] = chosen.name;
    return chosen || null;
  };

  Player.prototype._genderHintForSpeaker = function (speakerId) {
    var actor = speakerId && this.actors[speakerId];
    if (!actor) return '';
    var g = actor.gender;
    if (g === 'female' || g === 'male' || g === 'girl' || g === 'boy') return g;
    return '';
  };

  Player.prototype._voiceForSpeaker = function (speakerId) {
    var hint = this._genderHintForSpeaker(speakerId);
    return this._voiceForGender(hint, speakerId || 'line');
  };

  Player.prototype._applyVoiceToUtterance = function (u, hint, speakerId) {
    var voice = this._voiceForGender(hint, speakerId || hint || 'line');
    if (voice) u.voice = voice;
    u.lang = utteranceLangFor(voice);
    u.pitch = pitchForVoiceHint(hint, voice);
  };

  Player.prototype._pickEnglishVoice = function () {
    var prof = this.data && this.data.professor;
    var hint = prof && (prof.gender === 'female' || prof.gender === 'male') ? prof.gender : '';
    return this._voiceForGender(hint, (prof && prof.id) || 'professor');
  };

  /* Audio file wins when set; otherwise English TTS via speechSynthesis. Never TTS Khmer. */
  Player.prototype._playAudioFor = function (ln) {
    this._stopAudio();
    if (!settings().audio || !ln) return;
    if (ln.audio) {
      var url = resolveUrl(ln.audio);
      if (!url) return;
      try {
        var a = new Audio(url);
        this.audioEl = a;
        try { a.playbackRate = this.speed(); } catch (e) { /* ignore */ }
        a.play().catch(function () {});
      } catch (e) { /* ignore */ }
      return;
    }
    var text = ln.text ? String(ln.text).trim() : '';
    if (!text) return;
    if (!global.speechSynthesis || typeof global.SpeechSynthesisUtterance !== 'function') return;
    try {
      var u = new global.SpeechSynthesisUtterance(text);
      this._applyVoiceToUtterance(u, this._genderHintForSpeaker(ln.speaker), ln.speaker || 'line');
      var rate = this.speed();
      if (rate < 0.1) rate = 0.1;
      if (rate > 2) rate = 2;
      u.rate = rate;
      this._utterance = u;
      global.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  };

  Player.prototype._prefersReducedMotion = function () {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  };

  /* Animated speak sprites (GIF/WebP/APNG) fall back to a still .png when reduced motion is on. */
  Player.prototype._stillSpeakPath = function (path) {
    if (!path) return path;
    return String(path).replace(/\.(gif|webp|apng)$/i, '.png');
  };

  Player.prototype._spriteUrl = function (actorId, spriteKey) {
    var actor = this.actors[actorId];
    if (!actor) return '';
    var sprites = actor.sprites || {};
    var key = spriteKey || 'idle';
    var path = sprites[key] || sprites.idle || actor.image || '';
    if (key === 'speak' && path && this._prefersReducedMotion()) {
      var still = sprites.speakStill || this._stillSpeakPath(path);
      if (still) path = still;
    }
    return resolveUrl(path);
  };

  Player.prototype._currentLine = function () {
    var lines = this.linesOf(this.scenes[this.index]);
    return lines[this.lineIndex] || lines[0] || null;
  };

  Player.prototype._activeSpeaker = function () {
    var ln = this._currentLine();
    return ln && ln.speaker;
  };

  /* Talk picture only while this story is playing, or while that person's replay is sounding. */
  Player.prototype._animatedSpeakerId = function () {
    if (this._lineReplayActor) return this._lineReplayActor;
    if (!this.playing) return null;
    return this._activeSpeaker() || null;
  };

  Player.prototype._canReplayCharacters = function () {
    /* Pointer + click-to-replay only while paused, not while playing or waiting on the big play overlay. */
    return !this.playing && this.bigPlay && this.bigPlay.hidden;
  };

  Player.prototype._actorHasLine = function (sc, actorId) {
    var lines = this.linesOf(sc);
    var i;
    for (i = 0; i < lines.length; i++) {
      if (lines[i].speaker === actorId) return true;
    }
    return false;
  };

  Player.prototype._assignImg = function (img, url) {
    if (!img) return;
    if (!url) {
      img.removeAttribute('src');
      img.removeAttribute('data-src');
      return;
    }
    if (img.getAttribute('data-src') === url) return; /* same picture: do not restart an APNG */
    img.setAttribute('data-src', url);
    img.src = url;
  };

  /* Warm every runtime picture. The displayed <img> is a different node, so this cache does not restart a loop. */
  Player.prototype._preloadSprites = function () {
    var rel = this.root && this.root.getAttribute('data-scene');
    if (rel && !/^scenes\/s\d+\.json$/.test(rel)) rel = '';
    preloadRuntime(this.data, rel || '');
    this._spriteCache = imageCache;
  };

  Player.prototype._renderPlacements = function (sc) {
    var self = this;
    var speaker = this._animatedSpeakerId();
    var canReplay = this._canReplayCharacters();
    var bgPath = (sc && sc.background) || this.data.background || '';
    this.bg.style.backgroundImage = bgPath ? 'url("' + resolveUrl(bgPath).replace(/"/g, '\"') + '")' : 'none';
    var have = {};
    Array.prototype.forEach.call(this.actorsEl.children, function (btn) {
      have[btn.getAttribute('data-actor')] = btn;
    });
    var order = [];
    ((sc && sc.placements) || []).forEach(function (p) {
      var actor = self.actors[p.id];
      if (!actor) return;
      var wantSpeak = speaker === p.id;
      var hasLine = self._actorHasLine(sc, p.id);
      var clickable = canReplay && hasLine;
      var sprite = p.sprite;
      if (wantSpeak) sprite = 'speak';
      else if (sprite === 'speak') sprite = 'idle';
      var url = self._spriteUrl(p.id, sprite || (wantSpeak ? 'speak' : 'idle'));
      var btn = have[p.id];
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-actor', p.id);
      } else {
        delete have[p.id];
      }
      btn.className = 'tli-sp-actor' + (wantSpeak ? ' is-speaking' : '') + (clickable ? ' is-clickable' : '') + (p.facing === 'left' ? ' face-left' : '');
      btn.setAttribute('aria-disabled', clickable ? 'false' : 'true');
      btn.tabIndex = clickable ? 0 : -1;
      var label = actor.name || p.id;
      if (clickable) label += ' (click to replay line)';
      else if (wantSpeak) label += ' (speaking)';
      btn.setAttribute('aria-label', label);
      btn._placement = p;
      if (typeof p.scale === 'number') btn.style.setProperty('--sp-scale', String(p.scale));
      else btn.style.removeProperty('--sp-scale');
      var img = btn.querySelector('img');
      if (url) {
        if (!img) {
          img = document.createElement('img');
          img.alt = '';
          img.draggable = false;
          img.addEventListener('load', function () { self._placeActor(btn); });
          btn.textContent = '';
          btn.appendChild(img);
        }
        self._assignImg(img, url);
      } else if (!img) {
        btn.textContent = actor.name || p.id;
      }
      order.push(btn);
    });
    Object.keys(have).forEach(function (id) { have[id].remove(); });
    order.forEach(function (btn) { self.actorsEl.appendChild(btn); });
    order.forEach(function (btn) { self._placeActor(btn); });
  };

  /* Feet sit on the placement point. Pixel offsets, not a CSS transform, so the talking picture is not frozen. */
  Player.prototype._placeActor = function (btn) {
    var p = btn && btn._placement;
    if (!p || !btn.parentNode) return;
    var host = this.actorsEl;
    var pw = host.clientWidth;
    var ph = host.clientHeight;
    var w = btn.offsetWidth;
    var h = btn.offsetHeight;
    var xPct = typeof p.x === 'number' ? p.x : 50;
    var yPct = typeof p.y === 'number' ? p.y : 70;
    if (!pw || !ph || !w || !h) {
      btn.style.left = xPct + '%';
      btn.style.top = yPct + '%';
      return;
    }
    btn.style.left = Math.round((xPct / 100) * pw - w / 2) + 'px';
    btn.style.top = Math.round((yPct / 100) * ph - h) + 'px';
  };

  Player.prototype._translation = function (ln, code) {
    if (!ln) return '';
    var tr = ln.translations;
    if (tr && typeof tr === 'object' && tr[code] != null && String(tr[code]).length) return String(tr[code]);
    return '';
  };

  Player.prototype._showLine = function (ln, opts) {
    opts = opts || {};
    var s = settings();
    var en = this._translation(ln, 'en') || (ln && ln.text ? String(ln.text) : '');
    var km = this._translation(ln, 'km');
    var showEn = s.subtitlesEn && !!en;
    var showKm = s.subtitlesKm && !!km;
    this.subEn.textContent = en;
    this.subKm.textContent = km;
    this.subEn.hidden = !showEn;
    this.subKm.hidden = !showKm;
    this.subs.hidden = !(showEn || showKm);
    this.subs.classList.toggle('tli-sp-subs-both', !!(showEn && showKm));
    this.subs.classList.toggle('tli-sp-subs-one', !!(showEn !== showKm && (showEn || showKm)));
    if (opts.flash) {
      this.subs.classList.remove('tli-sp-flash');
      void this.subs.offsetWidth;
      this.subs.classList.add('tli-sp-flash');
    }
    if (ln && ln.speaker) this.lastSpokenByActor[ln.speaker] = ln;
    this._renderPlacements(this.scenes[this.index]);
  };

  Player.prototype._updateOverlay = function () {
    var show = !this.playing && (this.awaitingStart || this.ended);
    this.bigPlay.hidden = !show;
    this.bigPlay.setAttribute('aria-label', this.ended ? 'Replay story' : 'Play story');
    this.root.classList.toggle('tli-sp-waiting', show);
    if (this.scenes && this.scenes.length) this._renderPlacements(this.scenes[this.index]);
  };

  Player.prototype._sceneElapsed = function () {
    if (this.playing && this.sceneStartedAt) {
      var wall = (Date.now() - this.sceneStartedAt) * this.speed();
      return Math.min(this.sceneDuration(this.scenes[this.index]) + this.delayOf(this.scenes[this.index]), wall + this.pausedElapsed);
    }
    return this.pausedElapsed || 0;
  };

  Player.prototype._updateProgressUI = function () {
    var elapsed = this.offsetOf(this.index) + this._sceneElapsed();
    var total = this.totalMs();
    var v = Math.max(0, Math.min(1000, Math.round((elapsed / total) * 1000)));
    if (document.activeElement !== this.progress) {
      this._settingProgress = true;
      this.progress.value = String(v);
      this._settingProgress = false;
    }
  };

  Player.prototype._tickProgress = function () {
    var self = this;
    if (!this.playing) return;
    this._updateProgressUI();
    this.raf = requestAnimationFrame(function () { self._tickProgress(); });
  };

  Player.prototype._setPlayIcon = function (playing) {
    this.btnPlay.innerHTML = playing
      ? '<i class="fa-solid fa-pause" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    this.btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  };

  Player.prototype._lineIndexAtElapsed = function (sc, elapsed) {
    var lines = this.linesOf(sc), i, best = 0;
    for (i = 0; i < lines.length; i++) {
      if (this.lineAt(lines, i) <= elapsed) best = i;
    }
    return best;
  };

  Player.prototype.goTo = function (idx, opts) {
    opts = opts || {};
    if (!this.scenes.length) return;
    idx = Math.max(0, Math.min(this.scenes.length - 1, idx));
    this._cueEpoch += 1;
    if (!opts.keepCue) this._disposeProfCue();
    this._profHold = null;
    if (!(opts.keepProfessor && this.profPanel && !this.profPanel.hidden)) this._dismissProfessor();
    this._clearTimers();
    this._stopAudio();
    this.index = idx;
    this.lineIndex = 0;
    this.pausedElapsed = 0;
    this.sceneStartedAt = 0;
    this.ended = false;
    this.sceneComplete = false;
    this.lastSpokenByActor = {};
    var sc = this.scenes[idx];
    this.counter.textContent = (this.index + 1) + ' / ' + Math.max(1, this.scenes.length);
    var lines = this.linesOf(sc);
    this._showLine(lines[0] || null);
    this._updateProgressUI();
    this._updateOverlay();
    this._syncProfAvail({ immediate: true });
    if (opts.auto === false && !this.playing) {
      this._setPlayIcon(false);
      return;
    }
    if (this.playing || opts.play) this._scheduleFromPaused();
  };

  /* Schedule line changes and optional scene auto-advance from current pausedElapsed. */
  Player.prototype._scheduleFromPaused = function () {
    var self = this;
    var sc = this.scenes[this.index];
    if (!sc) { this.pause(); return; }
    this._clearTimers();
    this.sceneStartedAt = Date.now();
    var lines = this.linesOf(sc);
    var elapsed = this.pausedElapsed;
    this.lineIndex = this._lineIndexAtElapsed(sc, elapsed);
    var ln = lines[this.lineIndex];
    this._showLine(ln);
    this._playAudioFor(ln);
    this._tickProgress();

    /* Schedule each upcoming line start after elapsed. */
    var i;
    for (i = 0; i < lines.length; i++) {
      (function (li) {
        var start = self.lineAt(lines, li);
        if (start <= elapsed) return;
        var wait = (start - elapsed) / self.speed();
        var handle = setTimeout(function () {
          if (!self.playing || self.index !== self.scenes.indexOf(sc)) return;
          self.lineIndex = li;
          self._showLine(lines[li]);
          self._playAudioFor(lines[li]);
        }, wait);
        /* stash on array for clear — reuse lineTimer only for last; keep list */
        if (!self._lineHandles) self._lineHandles = [];
        self._lineHandles.push(handle);
      })(i);
    }

    /* Always schedule scene end: pause after this scene unless autoplay continues. */
    var sceneLen = this.sceneDuration(sc) + this.delayOf(sc);
    var remain = sceneLen - elapsed;
    if (remain < 0) remain = 0;
    this.timer = setTimeout(function () {
      self._onSceneFinished();
    }, remain / this.speed());
    /* A jump (play, replay) places the icon now. The fade is for the window closing in time. */
    this._syncProfAvail({ immediate: true });
  };

  Player.prototype._onSceneFinished = function () {
    this.sceneComplete = true;
    this.pausedElapsed = this.sceneDuration(this.scenes[this.index]) + this.delayOf(this.scenes[this.index]);
    this.playing = false;
    this._lineReplayActor = null;
    this._clearTimers();
    this._stopAudio();
    this._setPlayIcon(false);
    this._updateProgressUI();
    if (settings().autoAdvance) {
      if (this.index >= this.scenes.length - 1) {
        this._resetToStart();
        return;
      }
      /* Automatic advance is not a user navigation. The icon keeps its seven real seconds. */
      this.goTo(this.index + 1, { auto: false, keepCue: true, keepProfessor: true });
      this.play({ keepProfessor: true });
      return;
    }
    this._updateOverlay();
    this._syncProfAvail();
  };

  Player.prototype._resetToStart = function () {
    this.ended = true;
    this.awaitingStart = true;
    this.sceneComplete = false;
    this.pausedElapsed = 0;
    this.sceneStartedAt = 0;
    this.lineIndex = 0;
    this.lastSpokenByActor = {};
    this.playing = false;
    this._clearTimers();
    this._stopAudio();
    this.index = 0;
    this.counter.textContent = '1 / ' + Math.max(1, this.scenes.length);
    this._showLine(this.linesOf(this.scenes[0])[0] || null);
    this._disposeProfCue();
    this._profHold = null;
    this._dismissProfessor();
    this._setPlayIcon(false);
    this._updateProgressUI();
    this._updateOverlay();
    this._syncProfAvail({ immediate: true });
  };

  Player.prototype._clearTimers = function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.lineTimer) { clearTimeout(this.lineTimer); this.lineTimer = null; }
    if (this._charReplayTimer) { clearTimeout(this._charReplayTimer); this._charReplayTimer = null; }
    if (this._lineHandles) {
      this._lineHandles.forEach(function (h) { clearTimeout(h); });
      this._lineHandles = [];
    }
    if (this._profAvailHandles) {
      this._profAvailHandles.forEach(function (h) { clearTimeout(h); });
      this._profAvailHandles = [];
    }
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  };

  Player.prototype.play = function (opts) {
    opts = opts || {};
    if (!this.scenes.length) return;
    this._lineReplayActor = null;
    this._profHold = null;
    if (!opts.keepProfessor) this._pauseProfessor();
    this.awaitingStart = false;
    if (this.ended) {
      this.ended = false;
      this.sceneComplete = false;
      this.pausedElapsed = 0;
      this.goTo(0, { auto: false });
    } else if (this.sceneComplete) {
      if (this.index >= this.scenes.length - 1) {
        /* Last scene finished with autoplay off: Replay Scene or Prev; Play restarts this scene. */
        this.sceneComplete = false;
        this.pausedElapsed = 0;
        this.lineIndex = 0;
        this.lastSpokenByActor = {};
        this._showLine(this.linesOf(this.scenes[this.index])[0] || null);
      } else {
        this.sceneComplete = false;
        this.goTo(this.index + 1, { auto: false });
      }
    }
    this.sceneComplete = false;
    this.playing = true;
    this._setPlayIcon(true);
    this._updateOverlay();
    this._scheduleFromPaused();
  };

  Player.prototype.pause = function () {
    this._lineReplayActor = null;
    if (this.playing && this.sceneStartedAt) {
      var wall = (Date.now() - this.sceneStartedAt) * this.speed();
      this.pausedElapsed = Math.min(
        this.sceneDuration(this.scenes[this.index]) + this.delayOf(this.scenes[this.index]),
        wall + this.pausedElapsed
      );
    }
    this.playing = false;
    this._clearTimers();
    this._stopAudio();
    this._setPlayIcon(false);
    this._updateProgressUI();
    this._updateOverlay();
    this._syncProfAvail();
  };

  /* Restart the current scene from its first line and play it. */
  Player.prototype.replayScene = function () {
    if (!this.scenes.length) return;
    this._lineReplayActor = null;
    this._cueEpoch += 1;
    this._disposeProfCue();
    this._profHold = null;
    this._dismissProfessor();
    this.awaitingStart = false;
    this.ended = false;
    this.sceneComplete = false;
    this.pausedElapsed = 0;
    this.sceneStartedAt = 0;
    this.lineIndex = 0;
    this.lastSpokenByActor = {};
    this._clearTimers();
    this._stopAudio();
    var sc = this.scenes[this.index];
    this.counter.textContent = (this.index + 1) + ' / ' + Math.max(1, this.scenes.length);
    this._showLine(this.linesOf(sc)[0] || null);
    this._updateProgressUI();
    this.playing = true;
    this._setPlayIcon(true);
    this._updateOverlay();
    this._scheduleFromPaused();
  };

  Player.prototype.prev = function () {
    this.ended = false;
    this.sceneComplete = false;
    this._lineReplayActor = null;
    var resume = !!settings().autoAdvance;
    if (!resume) this.playing = false;
    this.goTo(Math.max(0, this.index - 1), { auto: false });
    if (resume) this.play();
    else { this._setPlayIcon(false); this._updateOverlay(); }
  };

  Player.prototype.next = function () {
    if (this.index >= this.scenes.length - 1) {
      this.sceneComplete = true;
      this.pause();
      return;
    }
    this.ended = false;
    this.sceneComplete = false;
    this._lineReplayActor = null;
    var resume = !!settings().autoAdvance;
    if (!resume) this.playing = false;
    this.goTo(this.index + 1, { auto: false });
    if (resume) this.play();
    else { this._setPlayIcon(false); this._updateOverlay(); }
  };

  Player.prototype.seekMs = function (ms) {
    var t = 0, i;
    this._lineReplayActor = null;
    this._disposeProfCue();
    this._profHold = null;
    this._dismissProfessor();
    this._pauseProfessor();
    ms = Math.max(0, Math.min(this.totalMs(), ms));
    for (i = 0; i < this.scenes.length; i++) {
      var d = this.sceneDuration(this.scenes[i]) + this.delayOf(this.scenes[i]);
      if (t + d > ms || i === this.scenes.length - 1) {
        var was = this.playing;
        this.playing = false;
        this._clearTimers();
        this.index = i;
        this.sceneComplete = false;
        this.pausedElapsed = Math.max(0, ms - t);
        this.sceneStartedAt = 0;
        this.ended = false;
        this.lastSpokenByActor = {};
        this.lineIndex = this._lineIndexAtElapsed(this.scenes[i], this.pausedElapsed);
        this.counter.textContent = (this.index + 1) + ' / ' + Math.max(1, this.scenes.length);
        this._showLine(this.linesOf(this.scenes[i])[this.lineIndex] || null);
        if (was) this.play();
        else { this._updateProgressUI(); this._updateOverlay(); this._syncProfAvail({ immediate: true }); }
        return;
      }
      t += d;
    }
  };

  Player.prototype.repeatActor = function (actorId) {
    if (!this._canReplayCharacters()) return; /* only while paused (not playing / not big-play waiting) */
    this._pauseProfessor();
    if (!this._actorHasLine(this.scenes[this.index], actorId)) return;
    var sc = this.scenes[this.index];
    var lines = this.linesOf(sc);
    var ln = this.lastSpokenByActor[actorId];
    if (!ln) {
      var i;
      for (i = lines.length - 1; i >= 0; i--) {
        if (lines[i].speaker === actorId) { ln = lines[i]; break; }
      }
    }
    if (!ln) return;
    var self = this;
    this._lineReplayActor = actorId;
    this._showLine(ln, { flash: true });
    this._playAudioFor(ln);
    if (this._charReplayTimer) { clearTimeout(this._charReplayTimer); this._charReplayTimer = null; }
    var wait = this.lineDuration(ln) / this.speed();
    this._charReplayTimer = setTimeout(function () {
      self._charReplayTimer = null;
      if (self._lineReplayActor === actorId) self._lineReplayActor = null;
      self._stopAudio();
      if (!self.playing) self._showLine(self._currentLine());
    }, wait);
  };

  Player.prototype._fadeMs = function () {
    return this._prefersReducedMotion() ? 0 : PROF_FADE_MS;
  };

  Player.prototype._sceneCap = function () {
    var sc = this.scenes[this.index];
    return this.sceneDuration(sc) + this.delayOf(sc);
  };

  Player.prototype._sceneClock = function () {
    var cap = this._sceneCap();
    var elapsed = this.pausedElapsed || 0;
    if (this.playing && this.sceneStartedAt) {
      elapsed = Math.min(cap, elapsed + (Date.now() - this.sceneStartedAt) * this.speed());
    }
    return elapsed;
  };

  /* After the scene clock stops, windowMs still runs, but only for this scene. */
  Player.prototype._availElapsed = function () {
    var clock = this._sceneClock();
    if (!this.playing && this._profHold && this._profHold.index === this.index) {
      var extra = this._now() - this._profHold.startedAt;
      if (extra < 0) extra = 0;
      if (extra > this._profHold.ms) extra = this._profHold.ms;
      return this._sceneCap() + extra;
    }
    return clock;
  };

  Player.prototype._explanationList = function () {
    var sc = this.scenes[this.index];
    return (sc && sc.explanations) || [];
  };

  Player.prototype._windowFor = function (ex) {
    return availabilityOf(this.data, this.scenes[this.index], ex);
  };

  Player.prototype._visibleExplanation = function (elapsed) {
    var list = this._explanationList();
    var found = null, i, w;
    for (i = 0; i < list.length; i++) {
      w = this._windowFor(list[i]);
      if (w && elapsed >= w.openAt && elapsed < w.closeAt) found = list[i];
    }
    return found;
  };

  Player.prototype._openableExplanation = function (elapsed) {
    var list = this._explanationList();
    var found = null, i, w;
    for (i = 0; i < list.length; i++) {
      w = this._windowFor(list[i]);
      if (w && elapsed >= w.readyAt && elapsed < w.closeAt) found = list[i];
    }
    return found;
  };

  Player.prototype._profDuration = function () {
    var ex = this._openExplanation;
    if (ex && typeof ex.durationMs === 'number' && ex.durationMs > 0) return ex.durationMs;
    return 8000;
  };

  Player.prototype._profNow = function () {
    if (this.profPlaying && this._profStartedAt) {
      return Math.min(this._profDuration(), this.profElapsed + (Date.now() - this._profStartedAt));
    }
    return this.profElapsed || 0;
  };

  Player.prototype._clearProfClock = function () {
    if (this._profTick) { clearInterval(this._profTick); this._profTick = null; }
    if (this._profCueTimers) {
      this._profCueTimers.forEach(function (h) { clearTimeout(h); });
      this._profCueTimers = [];
    }
  };

  Player.prototype._stopProfSound = function () {
    this._profSpeakGen = (this._profSpeakGen || 0) + 1;
    if (this.profAudio) {
      try { this.profAudio.pause(); this.profAudio.removeAttribute('src'); this.profAudio.load(); } catch (e) { /* ignore */ }
      this.profAudio = null;
    }
    this._profUtterance = null;
    if (global.speechSynthesis) {
      try { global.speechSynthesis.cancel(); } catch (e2) { /* ignore */ }
    }
  };

  Player.prototype._pauseProfessor = function () {
    if (this.profPlaying && this._profStartedAt) {
      this.profElapsed = this._profNow();
    }
    this.profPlaying = false;
    this._profStartedAt = 0;
    this._clearProfClock();
    this._stopProfSound();
    this._setProfPlayIcon(false);
    this._updateProfControls();
    if (this.profImg) this._renderProfFace(this.profImg, this.profFallback, false);
  };

  Player.prototype._now = function () { return Date.now(); };

  Player.prototype._minVisibleMs = function () {
    var p = this.data && this.data.professor;
    if (p && isNum(p.minVisibleMs) && p.minVisibleMs >= PROF_MIN_VISIBLE_MS) return p.minVisibleMs;
    return PROF_MIN_VISIBLE_MS;
  };

  /* Explicit navigation drops the icon. A window ending early does not. */
  Player.prototype._disposeProfCue = function () {
    this._cueShownAt = null;
    this._cueHeldEx = null;
    this._cueHeldReady = false;
    this._profArm = null;
  };

  Player.prototype._dismissProfessor = function () {
    this._pauseProfessor();
    this._openExplanation = null;
    if (this.profPanel) {
      this.profPanel.classList.remove('is-closing');
      this.profPanel.hidden = true;
    }
  };

  Player.prototype._closeProfessor = function (restoreFocus, animate) {
    var self = this;
    this._pauseProfessor();
    this._openExplanation = null;
    var panel = this.profPanel;
    var finish = function () {
      if (panel) {
        panel.classList.remove('is-closing');
        panel.hidden = true;
      }
      self._syncProfAvail();
      if (restoreFocus && self.cueBtn && !self.cueBtn.hidden) {
        try { self.cueBtn.focus(); } catch (e) { /* ignore */ }
      }
    };
    if (!panel || panel.hidden || !animate || this._fadeMs() === 0) { finish(); return; }
    panel.classList.add('is-closing');
    setTimeout(finish, this._fadeMs());
  };

  Player.prototype._setProfPlayIcon = function (playing) {
    if (!this.profPlay) return;
    this.profPlay.innerHTML = playing
      ? '<i class="fa-solid fa-pause" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    this.profPlay.setAttribute('aria-label', playing ? 'Pause explanation' : 'Play explanation');
  };

  /* Recorded Khmer is the only reason to offer KH. There is no Khmer browser voice. */
  Player.prototype._profKhmerFile = function (ex) {
    ex = ex || this._openExplanation;
    if (this._kmAudioFailed) return '';
    var path = ex && ex.audio && ex.audio.km;
    return path ? String(path) : '';
  };

  Player.prototype._syncProfLang = function () {
    if (!this._profKhmerFile()) this.profLang = 'en';
    if (!this.profLangSel) return;
    var allow = !!this._profKhmerFile();
    this.profLangSel.hidden = !allow;
    this.profLangSel.value = this.profLang === 'km' ? 'km' : 'en';
    this.profLangSel.setAttribute('aria-hidden', allow ? 'false' : 'true');
  };

  Player.prototype._profLines = function (ex, code) {
    var cues = ex && ex.subtitles && ex.subtitles[code];
    if (cues && cues.length) return cues.map(function (c) { return c.text || ''; }).filter(function (t) { return String(t).trim(); });
    var text = ex && ex.text && ex.text[code];
    return text ? [String(text)] : [];
  };

  Player.prototype._showProfLine = function (text, code) {
    if (!this.profText) return;
    this.profText.lang = code === 'km' ? 'km' : 'en';
    this.profText.textContent = text || '';
  };

  Player.prototype._finishProfessor = function () {
    if (!this.profPlaying) return;
    var line = this.profText ? this.profText.textContent : '';
    var lang = this.profText ? this.profText.lang : 'en';
    this.profElapsed = this._profDuration();
    this._pauseProfessor();
    this._showProfLine(line, lang);
    this._updateProfControls();
  };

  Player.prototype._pickKhmerVoice = function () {
    if (!global.speechSynthesis || !global.speechSynthesis.getVoices) return null;
    var voices = global.speechSynthesis.getVoices() || [];
    var i, v;
    for (i = 0; i < voices.length; i++) {
      v = voices[i];
      if (/^km(-|$)/i.test(v.lang || '')) return v;
    }
    return null;
  };

  Player.prototype._showCue = function (ex, elapsed, opts) {
    if (!this.cueBtn || !ex) return;
    opts = opts || {};
    var w = this._windowFor(ex);
    var who = (this.data.professor && this.data.professor.name) || 'Professor Mordechai';
    var openable = opts.forceOpenable != null ? !!opts.forceOpenable : !!(w && elapsed >= w.readyAt);
    this._cueHideToken += 1;
    this.cueBtn.hidden = false;
    this.cueBtn.classList.add('is-available');
    this.cueBtn.classList.toggle('is-lead', !openable);
    this.cueBtn.classList.toggle('is-openable', openable);
    this.cueBtn.dataset.explanation = ex.id;
    this.cueBtn.setAttribute('aria-label', openable ? (who + ' can explain') : (who + ' can explain when this finishes'));
    this._renderCueIcon();
  };

  Player.prototype._hideCue = function (immediate) {
    var btn = this.cueBtn;
    if (!btn) return;
    btn.classList.remove('is-available', 'is-lead', 'is-openable');
    var ms = immediate || this._fadeMs() === 0 ? 0 : this._fadeMs();
    if (ms === 0) { btn.hidden = true; return; }
    var self = this;
    var token = ++this._cueHideToken;
    setTimeout(function () {
      if (token !== self._cueHideToken) return;
      if (!btn.classList.contains('is-available')) btn.hidden = true;
    }, ms);
  };

  Player.prototype._renderCueIcon = function () {
    var prof = (this.data && this.data.professor) || {};
    var path = typeof prof.icon === 'string' ? prof.icon : '';
    var img = this.cueImg;
    var fallback = this.cueFallback;
    if (!img) return;
    img.hidden = !path;
    if (fallback) fallback.hidden = !!path;
    img.onerror = function () {
      img.hidden = true;
      if (fallback) fallback.hidden = false;
    };
    if (path) this._assignImg(img, resolveUrl(path));
    else this._assignImg(img, '');
  };

  /* Recompute from the scene clock. Seek, scene changes, and the end of a window all come through here.
     Once the icon is on screen it stays at least minVisibleMs of wall time, even if the story window ends sooner.
     A newer eligible explanation replaces the words without hiding the icon or restarting that clock. */
  Player.prototype._syncProfAvail = function (opts) {
    opts = opts || {};
    if (this._profSyncing) return;
    this._profSyncing = true;
    var self = this;
    if (this._profAvailHandles) this._profAvailHandles.forEach(function (h) { clearTimeout(h); });
    this._profAvailHandles = [];
    var sc = this.scenes[this.index];
    var list = this._explanationList();
    var cap = this._sceneCap();
    if (!this.playing && this.sceneComplete && sc && (!this._profHold || this._profHold.index !== this.index)) {
      var tail = 0;
      list.forEach(function (ex) {
        var w = self._windowFor(ex);
        if (w && w.closeAt > cap && w.openAt <= cap) tail = Math.max(tail, w.closeAt - cap);
      });
      if (tail > 0) this._profHold = { index: this.index, startedAt: this._now(), ms: tail };
    }
    var elapsed = this._availElapsed();
    var now = this._now();
    var panelOpen = !!(this.profPanel && !this.profPanel.hidden && !this.profPanel.classList.contains('is-closing'));
    var vis = this._visibleExplanation(elapsed);
    var minLeft = 0;
    if (vis) {
      if (this._cueShownAt == null) this._cueShownAt = now;
      this._cueHeldEx = vis;
      var heldWin = this._windowFor(vis);
      this._cueHeldReady = !!(heldWin && elapsed >= heldWin.readyAt);
      if (!panelOpen) this._showCue(vis, elapsed);
      else this._hideCue(true);
    } else if (this._cueShownAt != null && this._cueHeldEx && (now - this._cueShownAt) < this._minVisibleMs()) {
      minLeft = this._minVisibleMs() - (now - this._cueShownAt);
      if (!panelOpen) this._showCue(this._cueHeldEx, elapsed, { forceOpenable: !!this._cueHeldReady });
      else this._hideCue(true);
    } else {
      this._cueShownAt = null;
      this._cueHeldEx = null;
      this._hideCue(!!opts.immediate);
    }

    if (this._profArm && !this._profOpening) {
      var armed = null;
      list.forEach(function (ex) { if (ex.id === self._profArm) armed = ex; });
      var aw = armed && this._windowFor(armed);
      if (!aw || elapsed < aw.openAt || elapsed >= aw.closeAt) this._profArm = null;
      else if (elapsed >= aw.readyAt && !panelOpen) {
        this._profArm = null;
        this._profSyncing = false;
        this.openProfessor();
        return;
      }
    }

    if (this.playing && sc) {
      var next = null;
      list.forEach(function (ex) {
        var w = self._windowFor(ex);
        if (!w) return;
        [w.openAt, w.readyAt, w.closeAt].forEach(function (t) {
          if (t > elapsed + 0.5 && (next == null || t < next)) next = t;
        });
      });
      if (next != null) {
        this._profAvailHandles.push(setTimeout(function () {
          if (!self.playing || self.scenes[self.index] !== sc) return;
          self._syncProfAvail();
        }, (next - elapsed) / self.speed()));
      }
    }
    if (minLeft > 0) {
      this._profAvailHandles.push(setTimeout(function () {
        self._syncProfAvail();
      }, minLeft));
    } else if (!this.playing && this._profHold && this._profHold.index === this.index && !this._profHold.done) {
      var left = this._profHold.ms - (this._now() - this._profHold.startedAt);
      if (left > 0) {
        this._profAvailHandles.push(setTimeout(function () {
          if (self.playing || !self._profHold || self._profHold.index !== self.index) return;
          self._profHold.done = true;
          self._profHold.startedAt = self._now() - self._profHold.ms;
          self._syncProfAvail();
        }, left));
      } else {
        this._profHold.done = true;
      }
    }
    this._profSyncing = false;
  };

  Player.prototype._profFacePath = function (talking) {
    var prof = (this.data && this.data.professor) || {};
    var sprites = prof.sprites || {};
    if (talking && sprites.talk && !this._prefersReducedMotion()) return sprites.talk;
    if (talking && sprites.speakStill) return sprites.speakStill;
    return sprites.idle || prof.avatar || '';
  };

  Player.prototype._renderProfFace = function (img, fallback, talking) {
    var path = this._profFacePath(!!talking);
    if (!img) return;
    img.hidden = !path;
    if (fallback) fallback.hidden = !!path;
    img.onerror = function () {
      img.hidden = true;
      if (fallback) fallback.hidden = false;
    };
    if (path) this._assignImg(img, resolveUrl(path));
    else this._assignImg(img, '');
  };

  Player.prototype._subtitleAt = function (ex, code, elapsed) {
    if (!ex) return '';
    var cues = ex.subtitles && ex.subtitles[code];
    var i, start, dur, end;
    if (cues && cues.length) {
      for (i = 0; i < cues.length; i++) {
        start = cues[i].atMs || 0;
        dur = cues[i].durationMs;
        end = typeof dur === 'number' ? start + dur : Infinity;
        if (elapsed >= start && elapsed < end) return cues[i].text || '';
      }
      return '';
    }
    return (ex.text && ex.text[code]) || '';
  };

  Player.prototype._showProfSubtitle = function () {
    this._showProfSubtitleAt(this._profNow());
  };

  Player.prototype._showProfSubtitleAt = function (elapsed) {
    var ex = this._openExplanation;
    var code = this.profLang === 'km' ? 'km' : 'en';
    var text = this._subtitleAt(ex, code, elapsed);
    if (!this.profText) return;
    this.profText.lang = code;
    this.profText.textContent = text;
    if (code === 'km' && !text) this._setProfStatus(this._kmGap(ex));
  };

  Player.prototype._kmGap = function (ex) {
    var hasWords = !!(ex && ((ex.text && ex.text.km) || (ex.subtitles && ex.subtitles.km && ex.subtitles.km.length)));
    if (!hasWords) return 'Khmer words are not in this copy.';
    if (!(ex.audio && ex.audio.km) && !this._pickKhmerVoice()) {
      return 'Khmer speech is not in this copy. The Khmer line is a draft.';
    }
    return '';
  };

  Player.prototype._setProfStatus = function (msg) {
    if (!this.profStatus) return;
    this.profStatus.textContent = msg || '';
    this.profStatus.hidden = !msg;
  };

  Player.prototype._profCode = function () {
    var ex = this._openExplanation;
    if (this.profLang === 'km' && this._profKhmerFile(ex)) return 'km';
    return 'en';
  };

  Player.prototype._profSegments = function () {
    var ex = this._openExplanation;
    var code = this._profCode();
    var cues = ex && ex.subtitles && ex.subtitles[code];
    var out = [];
    if (cues && cues.length) {
      cues.forEach(function (c) {
        var text = c && c.text ? String(c.text).trim() : '';
        if (!text) return;
        out.push({ text: text, atMs: c.atMs || 0 });
      });
    }
    if (!out.length) {
      var whole = ex && ex.text && ex.text[code];
      if (whole && String(whole).trim()) out.push({ text: String(whole).trim(), atMs: 0 });
    }
    return out;
  };

  Player.prototype._updateProfControls = function () {
    var n = this._profSegments().length;
    var idx = this._profLineIndex || 0;
    if (n && idx >= n) idx = n - 1;
    if (idx < 0) idx = 0;
    this._profLineIndex = idx;
    if (this.profCount) this.profCount.textContent = n ? ((idx + 1) + ' / ' + n) : '';
    if (this.profPrev) this.profPrev.disabled = !n || idx <= 0;
    if (this.profNext) this.profNext.disabled = !n || idx >= n - 1;
  };

  Player.prototype._showCurrentSegment = function () {
    var segs = this._profSegments();
    this._updateProfControls();
    var seg = segs[this._profLineIndex];
    if (seg) this._showProfLine(seg.text, this._profCode());
  };

  Player.prototype._advanceProfSegment = function () {
    if (!this.profPlaying) return;
    var segs = this._profSegments();
    if (this._profLineIndex + 1 >= segs.length) {
      this._finishProfessor();
      return;
    }
    this._profLineIndex += 1;
    this._speakCurrentSegment();
  };

  Player.prototype._speakCurrentSegment = function () {
    var self = this;
    var segs = this._profSegments();
    this._showCurrentSegment();
    if (!this.profPlaying) return;
    var seg = segs[this._profLineIndex];
    if (!seg) { this._finishProfessor(); return; }
    var ex = this._openExplanation;
    var code = this._profCode();
    var filePath = ex && ex.audio && ex.audio[code];
    var gen = this._profSpeakGen;
    if (filePath) {
      var next = segs[this._profLineIndex + 1];
      var endAt = next ? next.atMs / 1000 : null;
      try {
        var file = new Audio(resolveUrl(filePath));
        this.profAudio = file;
        try { file.currentTime = (seg.atMs || 0) / 1000; } catch (e) { /* ignore */ }
        file.ontimeupdate = function () {
          if (self._profSpeakGen !== gen || self.profAudio !== file || !self.profPlaying) return;
          if (endAt == null) return;
          if (file.currentTime >= endAt - 0.03) {
            file.ontimeupdate = null;
            try { file.pause(); } catch (e2) { /* ignore */ }
            self._advanceProfSegment();
          }
        };
        file.onended = function () {
          if (self._profSpeakGen !== gen || self.profAudio !== file || !self.profPlaying) return;
          self._advanceProfSegment();
        };
        file.onerror = function () {
          if (self._profSpeakGen !== gen || self.profAudio !== file) return;
          self.profAudio = null;
          if (code === 'km') {
            self._kmAudioFailed = true;
            self.profLang = 'en';
            self._syncProfLang();
            self._speakCurrentSegment();
            return;
          }
          self._speakOneLine(seg.text, gen);
        };
        var played = file.play();
        if (played && typeof played.catch === 'function') played.catch(function () {});
      } catch (err) {
        if (code === 'km') {
          this._kmAudioFailed = true;
          this.profLang = 'en';
          this._syncProfLang();
          this._speakCurrentSegment();
          return;
        }
        this._speakOneLine(seg.text, gen);
      }
      return;
    }
    if (code === 'km') {
      this._kmAudioFailed = true;
      this.profLang = 'en';
      this._syncProfLang();
      this._speakCurrentSegment();
      return;
    }
    this._speakOneLine(seg.text, gen);
  };

  Player.prototype._speakOneLine = function (text, gen) {
    var self = this;
    text = text ? String(text).trim() : '';
    if (!this.profPlaying) return;
    if (!text) { this._advanceProfSegment(); return; }
    if (!global.speechSynthesis || typeof global.SpeechSynthesisUtterance !== 'function') return;
    try {
      var u = new global.SpeechSynthesisUtterance(text);
      var voice = this._pickEnglishVoice();
      if (voice) u.voice = voice;
      u.lang = utteranceLangFor(voice);
      /* Professor is male: natural pitch on a male-labeled voice; else MALE_FALLBACK_PITCH. */
      u.pitch = pitchForVoiceHint('male', voice);
      u.rate = 1;
      u.onend = function () {
        if (self._profSpeakGen !== gen || self._profUtterance !== u || !self.profPlaying) return;
        self._advanceProfSegment();
      };
      u.onerror = function () {
        if (self._profSpeakGen !== gen || self._profUtterance !== u || !self.profPlaying) return;
        self._advanceProfSegment();
      };
      this._profUtterance = u;
      global.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  };

  Player.prototype._stepProfessor = function (delta) {
    var segs = this._profSegments();
    var idx = (this._profLineIndex || 0) + delta;
    if (!segs.length || idx < 0 || idx >= segs.length) return;
    var was = this.profPlaying;
    this._stopProfSound();
    this.profPlaying = was;
    this._profLineIndex = idx;
    if (was) this._speakCurrentSegment();
    else {
      this._showCurrentSegment();
      if (this.profImg) this._renderProfFace(this.profImg, this.profFallback, false);
    }
  };

  Player.prototype.playProfessor = function () {
    var ex = this._openExplanation;
    if (!ex || !this.profPanel || this.profPanel.hidden) return;
    if (this.playing) this.pause();
    this._stopProfSound();
    this.profPlaying = true;
    this._setProfPlayIcon(true);
    if (this.profImg) this._renderProfFace(this.profImg, this.profFallback, true);
    this._setProfStatus('');
    this._speakCurrentSegment();
  };

  Player.prototype.seekProfessor = function (ms) {
    var segs = this._profSegments();
    var idx = 0;
    var i;
    for (i = 0; i < segs.length; i++) if ((segs[i].atMs || 0) <= ms) idx = i;
    var was = this.profPlaying;
    this._stopProfSound();
    this.profPlaying = false;
    this._profLineIndex = idx;
    this._showCurrentSegment();
    if (was) this.playProfessor();
  };

  Player.prototype.setProfessorLang = function (code) {
    var was = this.profPlaying;
    var wantKm = code === 'km' && !!this._profKhmerFile();
    this.profLang = wantKm ? 'km' : 'en';
    this._stopProfSound();
    this.profPlaying = false;
    this._profLineIndex = 0;
    this._syncProfLang();
    this._showCurrentSegment();
    this._setProfPlayIcon(false);
    this._setProfStatus('');
    if (was) this.playProfessor();
  };

  Player.prototype.openProfessor = function () {
    if (this._profOpening) return;
    var elapsed = this._availElapsed();
    var ex = this._openableExplanation(elapsed);
    if (!ex && this._cueHeldEx && this.cueBtn && !this.cueBtn.hidden) ex = this._cueHeldEx;
    if (!ex) return;
    var gate = this._windowFor(ex);
    if (gate && elapsed < gate.readyAt && !this._cueHeldReady) {
      this._profArm = ex.id;
      return;
    }
    this._profArm = null;
    this._profOpening = true;
    if (this.playing) this.pause();
    this._pauseProfessor();
    this._openExplanation = ex;
    this.profElapsed = 0;
    this._profLineIndex = 0;
    this._kmAudioFailed = false;
    if (this.profPanel) {
      this.profPanel.classList.remove('is-closing');
      this.profPanel.hidden = false;
    }
    if (this.profName) this.profName.textContent = (this.data.professor && this.data.professor.name) || 'Professor Mordechai';
    this._syncProfLang();
    this._showCurrentSegment();
    var prof = this.data.professor || {};
    var path = (prof.sprites && prof.sprites.idle) || prof.avatar;
    if (!path) this._setProfStatus('Picture file is not in this copy.');
    else this._setProfStatus('');
    this._hideCue(true);
    this._profOpening = false;
    if (this._profSegments().length) this.playProfessor();
    if (!path) this._setProfStatus('Picture file is not in this copy.');
    try { this.profPlay.focus(); } catch (e) { /* ignore */ }
  };

  function mount(el) {
    if (!el || el.getAttribute('data-tli-sp') === '1') return;
    var rel = el.getAttribute('data-scene');
    if (!rel) return;
    el.setAttribute('data-tli-sp', '1');
    var doFetch = global.fetch;
    if (typeof doFetch !== 'function') {
      el.classList.add('tli-sp', 'tli-sp-error');
      el.innerHTML = '<p class="tli-sp-err">Could not load storyboard <code>' + esc(rel) + '</code>.</p>';
      return;
    }
    doFetch(resolveUrl(rel)).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      new Player(el, data);
    }).catch(function (err) {
      el.classList.add('tli-sp', 'tli-sp-error');
      el.innerHTML = '<p class="tli-sp-err">Could not load storyboard <code>' + esc(rel) + '</code>.</p>';
      if (global.console && console.warn) console.warn('tli scene player', rel, err);
    });
  }

  function mountAll(root) {
    root = root || document;
    var nodes = root.querySelectorAll ? root.querySelectorAll('.tli-scene-player[data-scene]') : [];
    Array.prototype.forEach.call(nodes, mount);
  }

  global.TLIScenePlayer = {
    mount: mount,
    mountAll: mountAll,
    settings: settings,
    speeds: SPEEDS.slice(),
    assetBase: function () { return ASSET_BASE; },
    validateStory: validateStory,
    availability: availabilityOf,
    leadDefaultMs: PROF_LEAD_MS,
    windowDefaultMs: PROF_WINDOW_MS,
    minVisibleMs: PROF_MIN_VISIBLE_MS,
    fadeMs: PROF_FADE_MS,
    collectRuntimeRefs: collectRuntimeRefs,
    collectFromStoryboard: function (data) {
      var out = {};
      collectFromStoryboard(data, out);
      return Object.keys(out);
    },
    preloadRuntime: preloadRuntime,
    preloadPaths: function (paths) {
      (paths || []).forEach(preloadPath);
    },
    preloadedUrls: function () { return Object.keys(imageCache); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountAll(document); });
  } else {
    mountAll(document);
  }
})(typeof window !== 'undefined' ? window : this);
