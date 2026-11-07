/* tli scene player – JSON storyboard (not in data.js).
   Mount: <div class="tli-scene-player" data-scene="scenes/s001.json"></div>
   Scenes have a lines[] array; click a character to replay their line. */
(function (global) {
  'use strict';

  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  var PROF_CUE_MS = 8000;
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
    return ASSET_BASE + rel.replace(/^\.\//, '');
  }

  /* Optional professor explanations. Missing professor/explanations is valid. */
  function validateStory(data) {
    var errors = [];
    if (!data || typeof data !== 'object' || !Array.isArray(data.scenes)) {
      errors.push('scenes must be an array');
      return errors;
    }
    var prof = data.professor;
    if (prof != null) {
      if (!prof.id) errors.push('professor.id is required when professor is set');
      if (prof.cueMs != null && !(typeof prof.cueMs === 'number' && prof.cueMs > 0)) {
        errors.push('professor.cueMs must be a positive number of milliseconds');
      }
      if (prof.avatar != null && typeof prof.avatar !== 'string') errors.push('professor.avatar must be a path');
      if (prof.sprites != null && typeof prof.sprites !== 'object') errors.push('professor.sprites must be an object');
    }
    data.scenes.forEach(function (sc, si) {
      if (!sc || sc.explanations == null) return;
      if (!Array.isArray(sc.explanations)) {
        errors.push('scene ' + (sc.id || si) + ' explanations must be an array');
        return;
      }
      sc.explanations.forEach(function (ex) {
        var id = (ex && ex.id) || ('scene ' + si);
        if (!ex || !ex.id) errors.push(id + ' needs an id');
        if (!ex || !ex.text || typeof ex.text.en !== 'string' || !ex.text.en) errors.push(id + ' needs text.en');
        if (ex && ex.text && ex.text.km != null && typeof ex.text.km !== 'string') errors.push(id + ' text.km must be a string');
        if (ex && ex.atMs != null && typeof ex.atMs !== 'number') errors.push(id + ' atMs must be a number');
        if (ex && ex.durationMs != null && (typeof ex.durationMs !== 'number' || ex.durationMs <= 0)) {
          errors.push(id + ' durationMs must be a positive number');
        }
        if (ex && ex.audio) {
          ['en', 'km'].forEach(function (code) {
            if (ex.audio[code] != null && typeof ex.audio[code] !== 'string') errors.push(id + ' audio.' + code + ' must be a path or null');
          });
        }
        if (ex && ex.subtitles) {
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
    this._build();
    this._bind();
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
          '<div class="tli-sp-prof-face" aria-hidden="true">' +
            '<img alt="" class="tli-sp-prof-img" hidden>' +
            '<span class="tli-sp-prof-fallback">PM</span>' +
          '</div>' +
          '<p class="tli-sp-prof-name">Professor Mordechai</p>' +
          '<p class="visually-hidden tli-sp-prof-picture-note">Still picture. A talking clip is not in this copy.</p>' +
          '<p class="tli-sp-prof-text" lang="en"></p>' +
          '<p class="tli-sp-prof-status" role="status"></p>' +
          '<div class="tli-sp-prof-controls">' +
            '<button type="button" class="tli-sp-btn tli-sp-prof-play" aria-label="Play explanation"><i class="fa-solid fa-play" aria-hidden="true"></i></button>' +
            '<div class="tli-sp-progress-wrap"><input type="range" class="tli-sp-prof-progress" min="0" max="1000" value="0" step="1" aria-label="Professor explanation progress"></div>' +
            '<div class="tli-sp-prof-lang" role="group" aria-label="Professor language">' +
              '<button type="button" class="tli-sp-btn tli-sp-prof-en" aria-pressed="true">EN</button>' +
              '<button type="button" class="tli-sp-btn tli-sp-prof-km" aria-pressed="false">KH</button>' +
            '</div>' +
            '<button type="button" class="tli-sp-btn tli-sp-prof-close" aria-label="Close professor"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
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
    this.profProgress = this.root.querySelector('.tli-sp-prof-progress');
    this.profEn = this.root.querySelector('.tli-sp-prof-en');
    this.profKm = this.root.querySelector('.tli-sp-prof-km');
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
      self.seekMs(((+self.progress.value) / 1000) * self.totalMs());
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
    this.cueBtn.addEventListener('mouseenter', function () { self._cueHover = true; });
    this.cueBtn.addEventListener('mouseleave', function () {
      self._cueHover = false;
      if (self._cueDeadline && Date.now() >= self._cueDeadline) self._restCueIfIdle();
    });
    this.cueBtn.addEventListener('focus', function () { self._cueFocus = true; });
    this.cueBtn.addEventListener('blur', function () {
      self._cueFocus = false;
      if (self._cueDeadline && Date.now() >= self._cueDeadline) self._restCueIfIdle();
    });
    this.profPlay.addEventListener('click', function () {
      if (self.profPlaying) self._pauseProfessor();
      else self.playProfessor();
    });
    this.profClose.addEventListener('click', function () { self._closeProfessor(true); });
    this.profEn.addEventListener('click', function () { self.setProfessorLang('en'); });
    this.profKm.addEventListener('click', function () { self.setProfessorLang('km'); });
    this.profProgress.addEventListener('input', function () {
      self.seekProfessor((+self.profProgress.value) / 1000 * self._profDuration());
    });
    this.profPanel.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); self._closeProfessor(true); }
    });
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

  Player.prototype._pickEnglishVoice = function () {
    if (!global.speechSynthesis || !global.speechSynthesis.getVoices) return null;
    var voices = global.speechSynthesis.getVoices() || [];
    var i, v, en = null;
    for (i = 0; i < voices.length; i++) {
      v = voices[i];
      if (/^en(-|_)/i.test(v.lang || '') || /^en$/i.test(v.lang || '')) {
        if (/US|GB|AU|en-US|en-GB/i.test(v.lang)) return v;
        if (!en) en = v;
      }
    }
    return en;
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
      u.lang = 'en-US';
      var voice = this._pickEnglishVoice();
      if (voice) u.voice = voice;
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

  Player.prototype._renderPlacements = function (sc) {
    var self = this;
    var speaker = this._activeSpeaker();
    var canReplay = this._canReplayCharacters();
    var bgPath = (sc && sc.background) || this.data.background || '';
    this.bg.style.backgroundImage = bgPath ? 'url("' + resolveUrl(bgPath).replace(/"/g, '\"') + '")' : 'none';
    this.actorsEl.innerHTML = '';
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
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tli-sp-actor' + (wantSpeak ? ' is-speaking' : '') + (clickable ? ' is-clickable' : '');
      btn.setAttribute('data-actor', p.id);
      btn.setAttribute('aria-disabled', clickable ? 'false' : 'true');
      btn.tabIndex = clickable ? 0 : -1;
      var label = actor.name || p.id;
      if (clickable) label += ' (click to replay line)';
      else if (wantSpeak) label += ' (speaking)';
      btn.setAttribute('aria-label', label);
      btn.style.left = (typeof p.x === 'number' ? p.x : 50) + '%';
      btn.style.top = (typeof p.y === 'number' ? p.y : 70) + '%';
      if (typeof p.scale === 'number') btn.style.setProperty('--sp-scale', String(p.scale));
      if (p.facing === 'left') btn.classList.add('face-left');
      if (url) {
        var img = document.createElement('img');
        img.src = url; img.alt = ''; img.draggable = false;
        btn.appendChild(img);
      } else btn.textContent = actor.name || p.id;
      self.actorsEl.appendChild(btn);
    });
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
    if (document.activeElement !== this.progress) this.progress.value = String(v);
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
    this._presentedId = null;
    this._closeProfessor(false);
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
    this._armProfAvail();
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
    this._armProfAvail();
  };

  Player.prototype._onSceneFinished = function () {
    this.sceneComplete = true;
    this.pausedElapsed = this.sceneDuration(this.scenes[this.index]) + this.delayOf(this.scenes[this.index]);
    this.playing = false;
    this._clearTimers();
    this._stopAudio();
    this._setPlayIcon(false);
    this._updateProgressUI();
    if (settings().autoAdvance) {
      if (this.index >= this.scenes.length - 1) {
        this._resetToStart();
        return;
      }
      this.goTo(this.index + 1, { auto: false });
      this.play();
      return;
    }
    this._updateOverlay();
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
    this._setPlayIcon(false);
    this._updateProgressUI();
    this._updateOverlay();
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

  Player.prototype.play = function () {
    if (!this.scenes.length) return;
    this._pauseProfessor();
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
  };

  /* Restart the current scene from its first line and play it. */
  Player.prototype.replayScene = function () {
    if (!this.scenes.length) return;
    this._cueEpoch += 1;
    this._presentedId = null;
    this._closeProfessor(false);
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
    this.goTo(Math.max(0, this.index - 1), { auto: false });
    if (settings().autoAdvance) this.play();
    else { this.playing = false; this._setPlayIcon(false); this._updateOverlay(); }
  };

  Player.prototype.next = function () {
    if (this.index >= this.scenes.length - 1) {
      this.sceneComplete = true;
      this.pause();
      return;
    }
    this.ended = false;
    this.sceneComplete = false;
    this.goTo(this.index + 1, { auto: false });
    if (settings().autoAdvance) this.play();
    else { this.playing = false; this._setPlayIcon(false); this._updateOverlay(); }
  };

  Player.prototype.seekMs = function (ms) {
    var t = 0, i;
    this._pauseProfessor();
    ms = Math.max(0, Math.min(this.totalMs(), ms));
    for (i = 0; i < this.scenes.length; i++) {
      var d = this.sceneDuration(this.scenes[i]) + this.delayOf(this.scenes[i]);
      if (t + d > ms || i === this.scenes.length - 1) {
        var was = this.playing;
        this.playing = false;
        this._clearTimers();
        this.index = i;
        this.pausedElapsed = Math.max(0, ms - t);
        this.sceneStartedAt = 0;
        this.ended = false;
        this.lastSpokenByActor = {};
        this.lineIndex = this._lineIndexAtElapsed(this.scenes[i], this.pausedElapsed);
        this.counter.textContent = (this.index + 1) + ' / ' + Math.max(1, this.scenes.length);
        this._showLine(this.linesOf(this.scenes[i])[this.lineIndex] || null);
        if (was) this.play();
        else { this._updateProgressUI(); this._updateOverlay(); this._armProfAvail(); }
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
    this._showLine(ln, { flash: true });
    this._playAudioFor(ln);
    if (this._charReplayTimer) { clearTimeout(this._charReplayTimer); this._charReplayTimer = null; }
    var wait = this.lineDuration(ln) / this.speed();
    this._charReplayTimer = setTimeout(function () {
      self._charReplayTimer = null;
      self._stopAudio();
      /* remain paused */
    }, wait);
  };

  Player.prototype._cueMs = function () {
    var p = this.data && this.data.professor;
    if (p && typeof p.cueMs === 'number' && p.cueMs > 0) return p.cueMs;
    return PROF_CUE_MS;
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

  Player.prototype._clearCueFade = function () {
    if (this._profFadeTimer) { clearTimeout(this._profFadeTimer); this._profFadeTimer = null; }
  };

  Player.prototype._clearProfClock = function () {
    if (this._profTick) { clearInterval(this._profTick); this._profTick = null; }
    if (this._profCueTimers) {
      this._profCueTimers.forEach(function (h) { clearTimeout(h); });
      this._profCueTimers = [];
    }
  };

  Player.prototype._stopProfSound = function () {
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
    this._updateProfProgress();
  };

  Player.prototype._closeProfessor = function (restoreFocus) {
    this._pauseProfessor();
    this._openExplanation = null;
    if (this.profPanel) this.profPanel.hidden = true;
    if (restoreFocus && this.cueBtn && !this.cueBtn.hidden) {
      try { this.cueBtn.focus(); } catch (e) { /* ignore */ }
    }
  };

  Player.prototype._setProfPlayIcon = function (playing) {
    if (!this.profPlay) return;
    this.profPlay.innerHTML = playing
      ? '<i class="fa-solid fa-pause" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    this.profPlay.setAttribute('aria-label', playing ? 'Pause explanation' : 'Play explanation');
  };

  Player.prototype._syncProfLang = function () {
    if (!this.profEn) return;
    var km = this.profLang === 'km';
    this.profEn.setAttribute('aria-pressed', km ? 'false' : 'true');
    this.profKm.setAttribute('aria-pressed', km ? 'true' : 'false');
    this.profEn.classList.toggle('is-on', !km);
    this.profKm.classList.toggle('is-on', km);
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

  Player.prototype._activeExplanation = function () {
    var sc = this.scenes[this.index];
    var list = (sc && sc.explanations) || [];
    var elapsed = this.pausedElapsed || 0;
    var active = null;
    var i, at;
    for (i = 0; i < list.length; i++) {
      at = typeof list[i].atMs === 'number' ? list[i].atMs : 0;
      if (at <= elapsed) active = list[i];
    }
    return active;
  };

  Player.prototype._armProfAvail = function () {
    var self = this;
    var sc = this.scenes[this.index];
    var list = (sc && sc.explanations) || [];
    var elapsed = this.pausedElapsed || 0;
    var active = null;
    if (this._profAvailHandles) {
      this._profAvailHandles.forEach(function (h) { clearTimeout(h); });
    }
    this._profAvailHandles = [];
    list.forEach(function (ex) {
      var at = typeof ex.atMs === 'number' ? ex.atMs : 0;
      if (at <= elapsed) active = ex;
      else if (self.playing && self.sceneStartedAt) {
        var handle = setTimeout(function () {
          if (!self.playing || self.scenes[self.index] !== sc) return;
          self._presentCue(ex);
        }, (at - elapsed) / self.speed());
        self._profAvailHandles.push(handle);
      }
    });
    if (active) this._presentCue(active);
    else this._hideCue();
  };

  Player.prototype._hideCue = function () {
    this._clearCueFade();
    this._presentedId = null;
    if (this.cueBtn) this.cueBtn.hidden = true;
    if (this.profPanel && !this.profPanel.hidden) this._closeProfessor(false);
  };

  Player.prototype._cueHeld = function () {
    return !!(this._cueHover || this._cueFocus || (this.cueBtn && document.activeElement === this.cueBtn));
  };

  Player.prototype._restCueIfIdle = function () {
    if (!this.cueBtn || this.cueBtn.hidden) return;
    if (this._cueHeld()) return;
    this.cueBtn.classList.remove('is-cue');
    this.cueBtn.classList.add('is-resting');
  };

  Player.prototype._startCueFade = function () {
    var self = this;
    this._clearCueFade();
    this._cueDeadline = Date.now() + this._cueMs();
    this._profFadeTimer = setTimeout(function () {
      self._profFadeTimer = null;
      self._restCueIfIdle();
    }, this._cueMs());
  };

  Player.prototype._presentCue = function (ex) {
    if (!this.cueBtn || !ex) return;
    var same = this._presentedId === ex.id && this._presentedEpoch === this._cueEpoch && !this.cueBtn.hidden;
    this._presentedId = ex.id;
    this._presentedEpoch = this._cueEpoch;
    this.cueBtn.hidden = false;
    var who = (this.data.professor && this.data.professor.name) || 'Professor Mordechai';
    this.cueBtn.setAttribute('aria-label', who + ' can explain');
    this._renderProfFace(this.cueImg, this.cueFallback);
    if (same) return;
    this.cueBtn.classList.remove('is-resting');
    this.cueBtn.classList.add('is-cue');
    this._startCueFade();
  };

  Player.prototype._renderProfFace = function (img, fallback) {
    var prof = (this.data && this.data.professor) || {};
    var sprites = prof.sprites || {};
    var path = sprites.idle || prof.avatar || '';
    if (!img) return;
    img.hidden = !path;
    if (fallback) fallback.hidden = !!path;
    img.onerror = function () {
      img.hidden = true;
      if (fallback) fallback.hidden = false;
    };
    if (path) img.src = resolveUrl(path);
    else img.removeAttribute('src');
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

  Player.prototype._updateProfProgress = function () {
    if (!this.profProgress) return;
    var dur = this._profDuration() || 1;
    var v = Math.max(0, Math.min(1000, Math.round((this._profNow() / dur) * 1000)));
    if (document.activeElement !== this.profProgress) this.profProgress.value = String(v);
  };

  Player.prototype._startProfOutput = function () {
    var ex = this._openExplanation;
    var code = this.profLang === 'km' ? 'km' : 'en';
    var elapsed = this._profNow();
    this._stopProfSound();
    if (!ex) return 'silent';
    if (ex.audio && ex.audio[code]) {
      var url = resolveUrl(ex.audio[code]);
      try {
        var file = new Audio(url);
        this.profAudio = file;
        try { file.currentTime = elapsed / 1000; } catch (e) { /* ignore */ }
        file.play().catch(function () {});
      } catch (e2) { /* ignore */ }
      this._setProfStatus('');
      return 'file';
    }
    if (code === 'km') {
      var gap = this._kmGap(ex);
      if (gap) { this._setProfStatus(gap); return 'unavailable'; }
      var voice = this._pickKhmerVoice();
      return this._speakProf(this._subtitleAt(ex, 'km', elapsed) || (ex.text && ex.text.km) || '', 'km', voice);
    }
    this._setProfStatus('');
    var en = this._subtitleAt(ex, 'en', elapsed) || (ex.text && ex.text.en) || '';
    return this._speakProf(en, 'en-US', this._pickEnglishVoice());
  };

  Player.prototype._speakProf = function (text, lang, voice) {
    text = text ? String(text).trim() : '';
    if (!text) return 'silent';
    if (!global.speechSynthesis || typeof global.SpeechSynthesisUtterance !== 'function') return 'silent';
    try {
      var u = new global.SpeechSynthesisUtterance(text);
      u.lang = lang;
      if (voice) u.voice = voice;
      u.rate = 1;
      this._profUtterance = u;
      global.speechSynthesis.speak(u);
    } catch (e) { return 'silent'; }
    return 'tts';
  };

  Player.prototype._scheduleProfSubtitles = function () {
    var self = this;
    var ex = this._openExplanation;
    var code = this.profLang === 'km' ? 'km' : 'en';
    var cues = (ex && ex.subtitles && ex.subtitles[code]) || [];
    var elapsed = this._profNow();
    var file = !!(ex && ex.audio && ex.audio[code]);
    this._profCueTimers.forEach(function (h) { clearTimeout(h); });
    this._profCueTimers = [];
    cues.forEach(function (cue) {
      var at = cue.atMs || 0;
      if (at <= elapsed) return;
      var handle = setTimeout(function () {
        if (!self.profPlaying) return;
        self.profElapsed = at;
        self._profStartedAt = Date.now();
        self._showProfSubtitleAt(at);
        if (!file && !(code === 'km' && !self._pickKhmerVoice() && !(ex.audio && ex.audio.km))) {
          if (code === 'km' && !self._pickKhmerVoice()) return;
          self._stopProfSound();
          if (code === 'km') self._speakProf(cue.text || '', 'km', self._pickKhmerVoice());
          else self._speakProf(cue.text || '', 'en-US', self._pickEnglishVoice());
        }
      }, at - elapsed);
      self._profCueTimers.push(handle);
    });
  };

  Player.prototype.playProfessor = function () {
    var ex = this._openExplanation;
    var self = this;
    if (!ex || !this.profPanel || this.profPanel.hidden) return;
    if (this.playing) this.pause();
    if (this.profElapsed >= this._profDuration()) this.profElapsed = 0;
    this._clearProfClock();
    this.profPlaying = true;
    this._profStartedAt = Date.now();
    this._setProfPlayIcon(true);
    this._showProfSubtitle();
    this._startProfOutput();
    this._scheduleProfSubtitles();
    this._profTick = setInterval(function () {
      if (!self.profPlaying) return;
      var now = self._profNow();
      self._showProfSubtitleAt(now);
      self._updateProfProgress();
      if (now >= self._profDuration()) {
        self.profElapsed = self._profDuration();
        self._pauseProfessor();
        self._showProfSubtitleAt(self.profElapsed);
      }
    }, 100);
  };

  Player.prototype.seekProfessor = function (ms) {
    var was = this.profPlaying;
    ms = Math.max(0, Math.min(this._profDuration(), ms));
    this._clearProfClock();
    this._stopProfSound();
    this.profElapsed = ms;
    this._profStartedAt = 0;
    this.profPlaying = false;
    this._showProfSubtitleAt(ms);
    this._updateProfProgress();
    if (was) this.playProfessor();
  };

  Player.prototype.setProfessorLang = function (code) {
    var was = this.profPlaying;
    this.profLang = code === 'km' ? 'km' : 'en';
    this.profElapsed = this._profNow();
    this._profStartedAt = 0;
    this.profPlaying = false;
    this._clearProfClock();
    this._stopProfSound();
    this._syncProfLang();
    this._showProfSubtitleAt(this.profElapsed);
    this._setProfPlayIcon(false);
    if (was) this.playProfessor();
    else this._setProfStatus(this.profLang === 'km' ? this._kmGap(this._openExplanation) : '');
  };

  Player.prototype.openProfessor = function () {
    var ex = this._activeExplanation();
    if (!ex) return;
    if (this.playing) this.pause();
    this._pauseProfessor();
    this._openExplanation = ex;
    this.profElapsed = 0;
    this.profPanel.hidden = false;
    if (this.profName) this.profName.textContent = (this.data.professor && this.data.professor.name) || 'Professor Mordechai';
    this._renderProfFace(this.profImg, this.profFallback);
    this._syncProfLang();
    this._showProfSubtitleAt(0);
    this._updateProfProgress();
    var prof = this.data.professor || {};
    var path = (prof.sprites && prof.sprites.idle) || prof.avatar;
    if (!path) this._setProfStatus('Picture file is not in this copy.');
    else this._setProfStatus(this.profLang === 'km' ? this._kmGap(ex) : '');
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
    cueDefaultMs: PROF_CUE_MS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountAll(document); });
  } else {
    mountAll(document);
  }
})(typeof window !== 'undefined' ? window : this);
