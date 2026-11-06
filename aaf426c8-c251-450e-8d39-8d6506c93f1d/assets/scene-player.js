/* tli scene player – JSON-driven storyboard (not compiled into data.js).
   Mount: <div class="tli-scene-player" data-scene="scenes/s001.json"></div>
   Settings (audio, EN/KM subtitles) come from TLIReader or localStorage. */
(function (global) {
  'use strict';

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
    var audio = false, en = true, km = true;
    try {
      var raw = global.localStorage && global.localStorage.getItem('tli-reader:tli-english-cambodia:v1');
      if (raw) {
        var s = JSON.parse(raw).settings || {};
        if (typeof s.audio === 'boolean') audio = s.audio;
        if (typeof s.subtitlesEn === 'boolean') en = s.subtitlesEn;
        if (typeof s.subtitlesKm === 'boolean') km = s.subtitlesKm;
      }
    } catch (e) { /* ignore */ }
    return { audio: audio, subtitlesEn: en, subtitlesKm: km };
  }

  function resolveUrl(rel) {
    if (!rel) return '';
    if (/^https?:\/\//i.test(rel) || rel.charAt(0) === '/') return rel;
    return ASSET_BASE + rel.replace(/^\.\//, '');
  }

  function Player(root, data, sceneUrl) {
    this.root = root;
    this.data = data;
    this.sceneUrl = sceneUrl;
    this.scenes = data.scenes || [];
    this.actors = data.actors || data.characters || {};
    this.index = 0;
    this.playing = false;
    this.timer = null;
    this.raf = null;
    this.sceneStartedAt = 0;
    this.pausedElapsed = 0; /* ms into current scene when paused */
    this.audioEl = null;
    this._build();
    this._bind();
    this.goTo(0, { auto: false });
    /* Auto-play when mounted (student / preview). */
    var self = this;
    setTimeout(function () { self.play(); }, 80);
  }

  Player.prototype.durationOf = function (sc) {
    if (!sc) return 0;
    if (typeof sc.durationMs === 'number' && sc.durationMs >= 0) return sc.durationMs;
    return typeof this.data.defaultDurationMs === 'number' ? this.data.defaultDurationMs : 3500;
  };

  Player.prototype.delayOf = function (sc) {
    return (sc && typeof sc.delayMs === 'number' && sc.delayMs > 0) ? sc.delayMs : 0;
  };

  Player.prototype.totalMs = function () {
    var t = 0, i;
    for (i = 0; i < this.scenes.length; i++) t += this.durationOf(this.scenes[i]) + this.delayOf(this.scenes[i]);
    return t || 1;
  };

  Player.prototype.offsetOf = function (idx) {
    var t = 0, i;
    for (i = 0; i < idx && i < this.scenes.length; i++) t += this.durationOf(this.scenes[i]) + this.delayOf(this.scenes[i]);
    return t;
  };

  Player.prototype._build = function () {
    var title = this.data.title || this.data.id || 'Story';
    this.root.classList.add('tli-sp');
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Story: ' + title);
    this.root.innerHTML =
      '<div class="tli-sp-stage-wrap">' +
        '<div class="tli-sp-stage" tabindex="0">' +
          '<div class="tli-sp-bg" aria-hidden="true"></div>' +
          '<div class="tli-sp-actors" aria-live="off"></div>' +
          '<div class="tli-sp-subs" hidden>' +
            '<div class="tli-sp-sub-en" lang="en"></div>' +
            '<div class="tli-sp-sub-km" lang="km"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tli-sp-bar" role="toolbar" aria-label="Story controls">' +
        '<button type="button" class="tli-sp-btn tli-sp-prev" aria-label="Previous scene" title="Previous">' +
          '<i class="fa-solid fa-backward-step" aria-hidden="true"></i></button>' +
        '<button type="button" class="tli-sp-btn tli-sp-play" aria-label="Play" title="Play">' +
          '<i class="fa-solid fa-play" aria-hidden="true"></i></button>' +
        '<button type="button" class="tli-sp-btn tli-sp-next" aria-label="Next scene" title="Next">' +
          '<i class="fa-solid fa-forward-step" aria-hidden="true"></i></button>' +
        '<div class="tli-sp-progress-wrap">' +
          '<input type="range" class="tli-sp-progress" min="0" max="1000" value="0" step="1" aria-label="Story progress">' +
        '</div>' +
        '<span class="tli-sp-counter" aria-live="polite">1 / 1</span>' +
        '<button type="button" class="tli-sp-btn tli-sp-audio" aria-pressed="false" aria-label="Audio off" title="Audio">' +
          '<i class="fa-solid fa-volume-xmark" aria-hidden="true"></i></button>' +
        '<button type="button" class="tli-sp-btn tli-sp-cc-en" aria-pressed="true" aria-label="English subtitles on" title="English subtitles">EN</button>' +
        '<button type="button" class="tli-sp-btn tli-sp-cc-km" aria-pressed="true" aria-label="Khmer subtitles on" title="Khmer subtitles">ខ្មែរ</button>' +
      '</div>';
    this.stage = this.root.querySelector('.tli-sp-stage');
    this.bg = this.root.querySelector('.tli-sp-bg');
    this.actorsEl = this.root.querySelector('.tli-sp-actors');
    this.subs = this.root.querySelector('.tli-sp-subs');
    this.subEn = this.root.querySelector('.tli-sp-sub-en');
    this.subKm = this.root.querySelector('.tli-sp-sub-km');
    this.btnPlay = this.root.querySelector('.tli-sp-play');
    this.btnPrev = this.root.querySelector('.tli-sp-prev');
    this.btnNext = this.root.querySelector('.tli-sp-next');
    this.btnAudio = this.root.querySelector('.tli-sp-audio');
    this.btnEn = this.root.querySelector('.tli-sp-cc-en');
    this.btnKm = this.root.querySelector('.tli-sp-cc-km');
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
    this.btnEn.setAttribute('aria-label', s.subtitlesEn ? 'English subtitles on' : 'English subtitles off');
    this.btnEn.classList.toggle('is-on', !!s.subtitlesEn);
    this.btnKm.setAttribute('aria-pressed', s.subtitlesKm ? 'true' : 'false');
    this.btnKm.setAttribute('aria-label', s.subtitlesKm ? 'Khmer subtitles on' : 'Khmer subtitles off');
    this.btnKm.classList.toggle('is-on', !!s.subtitlesKm);
  };

  Player.prototype._bind = function () {
    var self = this;
    this.btnPlay.addEventListener('click', function () { if (self.playing) self.pause(); else self.play(); });
    this.btnPrev.addEventListener('click', function () { self.prev(); });
    this.btnNext.addEventListener('click', function () { self.next(); });
    this.btnAudio.addEventListener('click', function () {
      if (global.TLIReader && global.TLIReader.setAudio) global.TLIReader.setAudio(!settings().audio);
      else self._localToggle('audio');
      self._syncSettingButtons();
      self._applySubs();
    });
    this.btnEn.addEventListener('click', function () {
      if (global.TLIReader && global.TLIReader.setSubtitlesEn) global.TLIReader.setSubtitlesEn(!settings().subtitlesEn);
      else self._localToggle('subtitlesEn');
      self._syncSettingButtons();
      self._applySubs();
    });
    this.btnKm.addEventListener('click', function () {
      if (global.TLIReader && global.TLIReader.setSubtitlesKm) global.TLIReader.setSubtitlesKm(!settings().subtitlesKm);
      else self._localToggle('subtitlesKm');
      self._syncSettingButtons();
      self._applySubs();
    });
    this.progress.addEventListener('input', function () {
      var ratio = (+self.progress.value) / 1000;
      self.seekMs(ratio * self.totalMs());
    });
    this.actorsEl.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-actor]');
      if (!btn) return;
      self.repeatActor(btn.getAttribute('data-actor'));
    });
    document.addEventListener('tli-player-settings', function () {
      self._syncSettingButtons();
      self._applySubs();
      if (!settings().audio) self._stopAudio();
    });
  };

  Player.prototype._localToggle = function (key) {
    try {
      var storeKey = 'tli-reader:tli-english-cambodia:v1';
      var raw = global.localStorage.getItem(storeKey);
      var st = raw ? JSON.parse(raw) : { edits: {}, removals: {}, comments: {}, settings: {} };
      st.settings = st.settings || {};
      st.settings[key] = !st.settings[key];
      if (key === 'audio' && st.settings.audio == null) st.settings.audio = true;
      global.localStorage.setItem(storeKey, JSON.stringify(st));
    } catch (e) { /* ignore */ }
  };

  Player.prototype._clearTimer = function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  };

  Player.prototype._stopAudio = function () {
    if (this.audioEl) {
      try { this.audioEl.pause(); this.audioEl.removeAttribute('src'); this.audioEl.load(); } catch (e) { /* ignore */ }
      this.audioEl = null;
    }
  };

  Player.prototype._playAudio = function (sc) {
    this._stopAudio();
    if (!settings().audio) return;
    if (!sc || !sc.audio) return;
    var url = resolveUrl(sc.audio);
    if (!url) return;
    try {
      var a = new Audio(url);
      this.audioEl = a;
      a.play().catch(function () { /* autoplay / missing file */ });
    } catch (e) { /* ignore */ }
  };

  Player.prototype._spriteUrl = function (actorId, spriteKey) {
    var actor = this.actors[actorId];
    if (!actor) return '';
    var sprites = actor.sprites || {};
    var key = spriteKey || 'idle';
    var path = sprites[key] || sprites.idle || actor.image || '';
    return resolveUrl(path);
  };

  Player.prototype._renderScene = function (sc) {
    var self = this;
    var bgPath = (sc && sc.background) || this.data.background || '';
    this.bg.style.backgroundImage = bgPath ? 'url("' + resolveUrl(bgPath).replace(/"/g, '\\"') + '")' : 'none';
    this.actorsEl.innerHTML = '';
    var placements = (sc && sc.placements) || [];
    placements.forEach(function (p) {
      var actor = self.actors[p.id];
      if (!actor) return;
      var url = self._spriteUrl(p.id, p.sprite);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tli-sp-actor' + (sc.speaker === p.id ? ' is-speaking' : '');
      btn.setAttribute('data-actor', p.id);
      btn.setAttribute('aria-label', (actor.name || p.id) + (sc.speaker === p.id ? ' (speaking — click to repeat)' : ''));
      btn.style.left = (typeof p.x === 'number' ? p.x : 50) + '%';
      btn.style.top = (typeof p.y === 'number' ? p.y : 70) + '%';
      if (typeof p.scale === 'number') btn.style.setProperty('--sp-scale', String(p.scale));
      if (p.facing === 'left') btn.classList.add('face-left');
      if (url) {
        var img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.draggable = false;
        btn.appendChild(img);
      } else {
        btn.textContent = actor.name || p.id;
      }
      self.actorsEl.appendChild(btn);
    });
    this._applySubs();
    this.counter.textContent = (this.index + 1) + ' / ' + Math.max(1, this.scenes.length);
    this._updateProgressUI();
  };

  Player.prototype._translation = function (sc, code) {
    if (!sc) return '';
    var tr = sc.translations;
    if (tr && typeof tr === 'object' && tr[code] != null && String(tr[code]).length)
      return String(tr[code]);
    return '';
  };

  Player.prototype._applySubs = function () {
    var sc = this.scenes[this.index];
    var s = settings();
    /* English: translations.en overrides text when present; otherwise text is the source line. */
    var en = this._translation(sc, 'en') || (sc && sc.text ? String(sc.text) : '');
    var km = this._translation(sc, 'km');
    var showEn = s.subtitlesEn && !!en;
    var showKm = s.subtitlesKm && !!km;
    this.subEn.textContent = en;
    this.subKm.textContent = km;
    this.subEn.hidden = !showEn;
    this.subKm.hidden = !showKm;
    this.subs.hidden = !(showEn || showKm);
  };

  Player.prototype._updateProgressUI = function () {
    var elapsed = this.offsetOf(this.index) + this._sceneElapsed();
    var total = this.totalMs();
    var v = Math.max(0, Math.min(1000, Math.round((elapsed / total) * 1000)));
    if (document.activeElement !== this.progress) this.progress.value = String(v);
  };

  Player.prototype._sceneElapsed = function () {
    if (this.playing && this.sceneStartedAt) return Math.min(this.durationOf(this.scenes[this.index]) + this.delayOf(this.scenes[this.index]), Date.now() - this.sceneStartedAt + this.pausedElapsed);
    return this.pausedElapsed || 0;
  };

  Player.prototype._tickProgress = function () {
    var self = this;
    if (!this.playing) return;
    this._updateProgressUI();
    this.raf = requestAnimationFrame(function () { self._tickProgress(); });
  };

  Player.prototype.goTo = function (idx, opts) {
    opts = opts || {};
    if (!this.scenes.length) return;
    idx = Math.max(0, Math.min(this.scenes.length - 1, idx));
    this._clearTimer();
    this._stopAudio();
    this.index = idx;
    this.pausedElapsed = 0;
    this.sceneStartedAt = 0;
    var sc = this.scenes[idx];
    this._renderScene(sc);
    if (opts.auto === false && !this.playing) {
      this._setPlayIcon(false);
      return;
    }
    if (this.playing || opts.play) this._scheduleCurrent();
  };

  Player.prototype._setPlayIcon = function (playing) {
    this.btnPlay.innerHTML = playing
      ? '<i class="fa-solid fa-pause" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    this.btnPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    this.btnPlay.title = playing ? 'Pause' : 'Play';
  };

  Player.prototype._scheduleCurrent = function () {
    var self = this;
    var sc = this.scenes[this.index];
    if (!sc) { this.pause(); return; }
    this._clearTimer();
    this.sceneStartedAt = Date.now();
    this._playAudio(sc);
    this._tickProgress();
    var remaining = this.durationOf(sc) + this.delayOf(sc) - this.pausedElapsed;
    if (remaining < 0) remaining = 0;
    this.timer = setTimeout(function () {
      self.pausedElapsed = 0;
      if (self.index >= self.scenes.length - 1) {
        self.pause();
        self._updateProgressUI();
        return;
      }
      self.goTo(self.index + 1, { play: true });
    }, remaining);
  };

  Player.prototype.play = function () {
    if (!this.scenes.length) return;
    this.playing = true;
    this._setPlayIcon(true);
    this._scheduleCurrent();
  };

  Player.prototype.pause = function () {
    if (this.playing && this.sceneStartedAt) {
      this.pausedElapsed = Math.min(
        this.durationOf(this.scenes[this.index]) + this.delayOf(this.scenes[this.index]),
        Date.now() - this.sceneStartedAt + this.pausedElapsed
      );
    }
    this.playing = false;
    this._clearTimer();
    this._stopAudio();
    this._setPlayIcon(false);
    this._updateProgressUI();
  };

  Player.prototype.prev = function () {
    var was = this.playing;
    this.goTo(this.index - 1, { auto: false });
    if (was) this.play();
  };

  Player.prototype.next = function () {
    var was = this.playing;
    if (this.index >= this.scenes.length - 1) { this.pause(); return; }
    this.goTo(this.index + 1, { auto: false });
    if (was) this.play();
  };

  Player.prototype.seekMs = function (ms) {
    var t = 0, i;
    ms = Math.max(0, Math.min(this.totalMs(), ms));
    for (i = 0; i < this.scenes.length; i++) {
      var d = this.durationOf(this.scenes[i]) + this.delayOf(this.scenes[i]);
      if (t + d > ms || i === this.scenes.length - 1) {
        var was = this.playing;
        this.playing = false;
        this._clearTimer();
        this.index = i;
        this.pausedElapsed = Math.max(0, ms - t);
        this.sceneStartedAt = 0;
        this._renderScene(this.scenes[i]);
        if (was) this.play();
        else this._updateProgressUI();
        return;
      }
      t += d;
    }
  };

  Player.prototype.repeatActor = function (actorId) {
    var sc = this.scenes[this.index];
    if (!sc || sc.speaker !== actorId) return;
    /* Re-show enabled subtitles and replay audio if on; do not change scene timer. */
    this._applySubs();
    this.subs.classList.remove('tli-sp-flash');
    void this.subs.offsetWidth;
    this.subs.classList.add('tli-sp-flash');
    this._playAudio(sc);
  };

  function mount(el) {
    if (!el || el.getAttribute('data-tli-sp') === '1') return;
    var rel = el.getAttribute('data-scene');
    if (!rel) return;
    el.setAttribute('data-tli-sp', '1');
    var url = resolveUrl(rel);
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      new Player(el, data, url);
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

  global.TLIScenePlayer = { mount: mount, mountAll: mountAll, settings: settings, assetBase: function () { return ASSET_BASE; } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountAll(document); });
  } else {
    mountAll(document);
  }
})(typeof window !== 'undefined' ? window : this);
