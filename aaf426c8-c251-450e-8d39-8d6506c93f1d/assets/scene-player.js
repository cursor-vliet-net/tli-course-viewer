/* tli scene player – JSON storyboard (not in data.js).
   Mount: <div class="tli-scene-player" data-scene="scenes/s001.json"></div>
   Scenes have a lines[] array; click a character to replay their line. */
(function (global) {
  'use strict';

  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
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
    var out = { audio: false, subtitlesEn: true, subtitlesKm: true, autoAdvance: true, playbackSpeed: 1 };
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

  function Player(root, data) {
    this.root = root;
    this.data = data;
    this.scenes = data.scenes || [];
    this.actors = data.actors || data.characters || {};
    this.index = 0;
    this.lineIndex = 0;
    this.playing = false;
    this.ended = false;
    this.timer = null;
    this.lineTimer = null;
    this.raf = null;
    this.sceneStartedAt = 0;
    this.pausedElapsed = 0; /* nominal ms into current scene */
    this.lastSpokenByActor = {}; /* actorId -> line object in current scene */
    this.audioEl = null;
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
        '<div class="tli-sp-progress-wrap"><input type="range" class="tli-sp-progress" min="0" max="1000" value="0" step="1" aria-label="Story progress"></div>' +
        '<span class="tli-sp-counter" aria-live="polite">1 / 1</span>' +
        '<button type="button" class="tli-sp-btn tli-sp-audio" aria-pressed="false" aria-label="Audio off" title="Audio"><i class="fa-solid fa-volume-xmark" aria-hidden="true"></i></button>' +
        '<button type="button" class="tli-sp-btn tli-sp-cc-en" aria-pressed="true" aria-label="English subtitles on" title="English subtitles">EN</button>' +
        '<button type="button" class="tli-sp-btn tli-sp-cc-km" aria-pressed="true" aria-label="Khmer subtitles on" title="Khmer subtitles">ខ្មែរ</button>' +
        '<button type="button" class="tli-sp-btn tli-sp-autoadv" aria-pressed="true" aria-label="Auto-advance on" title="Auto-advance">Auto</button>' +
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
    this.btnAudio = this.root.querySelector('.tli-sp-audio');
    this.btnEn = this.root.querySelector('.tli-sp-cc-en');
    this.btnKm = this.root.querySelector('.tli-sp-cc-km');
    this.btnAuto = this.root.querySelector('.tli-sp-autoadv');
    this.speedSel = this.root.querySelector('.tli-sp-speed');
    this.btnFs = this.root.querySelector('.tli-sp-fs');
    this.progress = this.root.querySelector('.tli-sp-progress');
    this.counter = this.root.querySelector('.tli-sp-counter');
    this._syncSettingButtons();
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
    var aa = s.autoAdvance !== false;
    this.btnAuto.setAttribute('aria-pressed', aa ? 'true' : 'false');
    this.btnAuto.setAttribute('aria-label', aa ? 'Auto-advance on' : 'Auto-advance off');
    this.btnAuto.title = aa ? 'Auto-advance on' : 'Auto-advance off';
    this.btnAuto.classList.toggle('is-on', aa);
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
      var next = !(settings().autoAdvance !== false);
      if (global.TLIReader && global.TLIReader.setAutoAdvance) global.TLIReader.setAutoAdvance(next);
      else self._localSet('autoAdvance', next);
      self._syncSettingButtons();
      if (self.playing) self._scheduleFromPaused();
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
  };

  Player.prototype._playAudioFor = function (ln) {
    this._stopAudio();
    if (!settings().audio || !ln || !ln.audio) return;
    var url = resolveUrl(ln.audio);
    if (!url) return;
    try {
      var a = new Audio(url);
      this.audioEl = a;
      try { a.playbackRate = this.speed(); } catch (e) { /* ignore */ }
      a.play().catch(function () {});
    } catch (e) { /* ignore */ }
  };

  Player.prototype._spriteUrl = function (actorId, spriteKey) {
    var actor = this.actors[actorId];
    if (!actor) return '';
    var sprites = actor.sprites || {};
    return resolveUrl(sprites[spriteKey || 'idle'] || sprites.idle || actor.image || '');
  };

  Player.prototype._currentLine = function () {
    var lines = this.linesOf(this.scenes[this.index]);
    return lines[this.lineIndex] || lines[0] || null;
  };

  Player.prototype._activeSpeaker = function () {
    var ln = this._currentLine();
    return ln && ln.speaker;
  };

  Player.prototype._renderPlacements = function (sc) {
    var self = this;
    var speaker = this._activeSpeaker();
    var bgPath = (sc && sc.background) || this.data.background || '';
    this.bg.style.backgroundImage = bgPath ? 'url("' + resolveUrl(bgPath).replace(/"/g, '\\"') + '")' : 'none';
    this.actorsEl.innerHTML = '';
    ((sc && sc.placements) || []).forEach(function (p) {
      var actor = self.actors[p.id];
      if (!actor) return;
      var wantSpeak = speaker === p.id;
      var sprite = p.sprite;
      if (wantSpeak) sprite = 'speak';
      else if (sprite === 'speak') sprite = 'idle';
      var url = self._spriteUrl(p.id, sprite || (wantSpeak ? 'speak' : 'idle'));
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tli-sp-actor' + (wantSpeak ? ' is-speaking' : '');
      btn.setAttribute('data-actor', p.id);
      btn.setAttribute('aria-label', (actor.name || p.id) + (wantSpeak ? ' (speaking — click to repeat)' : ''));
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
    var atStart = this.index === 0 && !this.pausedElapsed && this.lineIndex === 0;
    var show = !this.playing && (atStart || this.ended);
    this.bigPlay.hidden = !show;
    this.bigPlay.setAttribute('aria-label', this.ended ? 'Replay story' : 'Play story');
    this.root.classList.toggle('tli-sp-waiting', show);
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
    this._clearTimers();
    this._stopAudio();
    this.index = idx;
    this.lineIndex = 0;
    this.pausedElapsed = 0;
    this.sceneStartedAt = 0;
    this.ended = false;
    this.lastSpokenByActor = {};
    var sc = this.scenes[idx];
    this.counter.textContent = (this.index + 1) + ' / ' + Math.max(1, this.scenes.length);
    var lines = this.linesOf(sc);
    this._showLine(lines[0] || null);
    this._updateProgressUI();
    this._updateOverlay();
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

    if (settings().autoAdvance === false) return;
    var sceneLen = this.sceneDuration(sc) + this.delayOf(sc);
    var remain = sceneLen - elapsed;
    if (remain < 0) remain = 0;
    this.timer = setTimeout(function () {
      self.pausedElapsed = 0;
      if (self.index >= self.scenes.length - 1) {
        self.ended = true;
        self.pause();
        return;
      }
      self.goTo(self.index + 1, { play: true });
    }, remain / this.speed());
  };

  Player.prototype._clearTimers = function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.lineTimer) { clearTimeout(this.lineTimer); this.lineTimer = null; }
    if (this._lineHandles) {
      this._lineHandles.forEach(function (h) { clearTimeout(h); });
      this._lineHandles = [];
    }
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  };

  Player.prototype.play = function () {
    if (!this.scenes.length) return;
    if (this.ended) {
      this.ended = false;
      this.pausedElapsed = 0;
      this.goTo(0, { auto: false });
    }
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

  Player.prototype.prev = function () {
    var was = this.playing;
    this.ended = false;
    this.goTo(this.index - 1, { auto: false });
    if (was) this.play();
    else this._updateOverlay();
  };

  Player.prototype.next = function () {
    var was = this.playing;
    if (this.index >= this.scenes.length - 1) {
      this.ended = true;
      this.pause();
      return;
    }
    this.ended = false;
    this.goTo(this.index + 1, { auto: false });
    if (was) this.play();
    else this._updateOverlay();
  };

  Player.prototype.seekMs = function (ms) {
    var t = 0, i;
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
        else { this._updateProgressUI(); this._updateOverlay(); }
        return;
      }
      t += d;
    }
  };

  Player.prototype.repeatActor = function (actorId) {
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
    this._showLine(ln, { flash: true });
    this._playAudioFor(ln);
  };

  function mount(el) {
    if (!el || el.getAttribute('data-tli-sp') === '1') return;
    var rel = el.getAttribute('data-scene');
    if (!rel) return;
    el.setAttribute('data-tli-sp', '1');
    fetch(resolveUrl(rel)).then(function (r) {
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

  global.TLIScenePlayer = { mount: mount, mountAll: mountAll, settings: settings, speeds: SPEEDS.slice(), assetBase: function () { return ASSET_BASE; } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountAll(document); });
  } else {
    mountAll(document);
  }
})(typeof window !== 'undefined' ? window : this);
