/* tli audio recorder – JSON-driven spoken practice (same idea as the scene player).
   Mount:
     <div class="tli-audio-recorder" data-recorder="recorders/foo.json"></div>
     <div class="tli-audio-recorder"><script type="application/json">{…}</script></div>
     TLIAudioRecorder.mount(el, config)
   Schema: viewer/assets/recorders/README.md
   UI: icon-only Listen (play+volume stack) · Record/Stop · Play take (play+mic stack). */
(function (global) {
  'use strict';

  var LABELS = {
    en: {
      playOriginal: 'Listen',
      record: 'Record',
      stopRec: 'Stop',
      playRec: 'Play recording'
    },
    km: {
      playOriginal: 'ស្តាប់',
      record: 'ថត',
      stopRec: 'ឈប់',
      playRec: 'ចាក់ថត'
    }
  };

  var bags = typeof WeakMap === 'function' ? new WeakMap() : null;

  var ASSET_BASE = (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      var m = /^(.*\/assets\/)audio-recorder\.js(?:\?|$)/i.exec(src);
      if (m) return m[1];
    }
    return 'assets/';
  })();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uiLang() {
    return document.documentElement.lang === 'km' ? 'km' : 'en';
  }

  function label(key) {
    var pack = LABELS[uiLang()] || LABELS.en;
    return pack[key] != null ? pack[key] : (LABELS.en[key] || key);
  }

  function resolveUrl(rel) {
    if (!rel) return '';
    if (/^https?:\/\//i.test(rel) || rel.charAt(0) === '/' || /^blob:/i.test(rel)) return rel;
    if (/^assets\//i.test(rel)) return rel;
    return ASSET_BASE + String(rel).replace(/^\.\//, '');
  }

  function normalizeConfig(raw) {
    var cfg = raw && typeof raw === 'object' ? raw : {};
    var model = cfg.model && typeof cfg.model === 'object' ? cfg.model : {};
    var en = typeof model.en === 'string' ? model.en : (typeof cfg.modelEn === 'string' ? cfg.modelEn : '');
    var file = cfg.audioFile != null ? cfg.audioFile : (cfg.audio != null ? cfg.audio : null);
    if (file === '') file = null;
    return {
      version: cfg.version || 1,
      id: cfg.id || '',
      model: { en: en, km: typeof model.km === 'string' ? model.km : '' },
      audioFile: file
    };
  }

  function bagFor(root) {
    if (!bags || !root) return { url: '', stream: null, recorder: null, chunks: [], recording: false, config: null };
    var bag = bags.get(root);
    if (!bag) {
      bag = { url: '', stream: null, recorder: null, chunks: [], recording: false, config: null };
      bags.set(root, bag);
    }
    return bag;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }

  function setStatus(root, text) {
    var n = root && $('.tli-ar-status', root);
    if (n) n.textContent = text || '';
  }

  function nameButton(btn, key) {
    if (!btn) return;
    var name = label(key);
    btn.setAttribute('aria-label', name);
    btn.title = name;
    btn.setAttribute('data-ar-label', key);
  }

  function setToggleIdle(root) {
    var btn = $('.tli-ar-toggle', root);
    if (!btn) return;
    btn.classList.remove('is-recording');
    btn.setAttribute('aria-pressed', 'false');
    nameButton(btn, 'record');
    var ic = $('.tli-ar-toggle-icon', btn);
    if (ic) ic.className = 'fa-solid fa-microphone tli-ar-toggle-icon';
  }

  function setToggleRecording(root) {
    var btn = $('.tli-ar-toggle', root);
    if (!btn) return;
    btn.classList.add('is-recording');
    btn.setAttribute('aria-pressed', 'true');
    nameButton(btn, 'stopRec');
    var ic = $('.tli-ar-toggle-icon', btn);
    if (ic) ic.className = 'fa-solid fa-stop tli-ar-toggle-icon';
  }

  function showPlayRecording(root, on) {
    var play = $('.tli-ar-play', root);
    if (play) play.hidden = !on;
  }

  function speakOriginal(root) {
    var bag = bagFor(root);
    var cfg = bag.config || normalizeConfig({});
    var text = cfg.model.en || '';
    var file = cfg.audioFile ? resolveUrl(cfg.audioFile) : '';
    function tts() {
      if (!text || !global.speechSynthesis || !global.SpeechSynthesisUtterance) {
        setStatus(root, 'English listening is not available in this browser.');
        return;
      }
      /* Never send Khmer (or any non-English model field) to speechSynthesis. */
      global.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      global.speechSynthesis.speak(u);
    }
    if (!text && !file) {
      setStatus(root, 'No English model line is set for this recorder.');
      return;
    }
    if (file) {
      var audio = new Audio(file);
      audio.onerror = tts;
      var played = audio.play();
      if (played && played.catch) played.catch(tts);
      return;
    }
    tts();
  }

  function discardTake(root, silent) {
    var bag = bagFor(root);
    if (bag.recorder && bag.recorder.state === 'recording') {
      try { bag.recorder.stop(); } catch (e) { /* already stopped */ }
    }
    if (bag.stream) {
      bag.stream.getTracks().forEach(function (track) { track.stop(); });
      bag.stream = null;
    }
    if (bag.url) {
      URL.revokeObjectURL(bag.url);
      bag.url = '';
    }
    bag.chunks = [];
    bag.recording = false;
    setToggleIdle(root);
    showPlayRecording(root, false);
    if (!silent) setStatus(root, '');
  }

  function stopRecording(root) {
    var bag = bagFor(root);
    if (bag.recorder && bag.recorder.state === 'recording') bag.recorder.stop();
    if (bag.stream) {
      bag.stream.getTracks().forEach(function (track) { track.stop(); });
      bag.stream = null;
    }
    bag.recording = false;
  }

  function startRecording(root) {
    if (!root) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !global.MediaRecorder) {
      setStatus(root, 'Recording is not available in this browser. You can still say it aloud.');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      discardTake(root, true);
      var bag = bagFor(root);
      bag.stream = stream;
      bag.chunks = [];
      var rec;
      try { rec = new MediaRecorder(stream); }
      catch (err) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        setStatus(root, 'Recording is not available in this browser.');
        return;
      }
      bag.recorder = rec;
      bag.recording = true;
      rec.ondataavailable = function (ev) {
        if (ev.data && ev.data.size) bag.chunks.push(ev.data);
      };
      rec.onstop = function () {
        if (bag.url) URL.revokeObjectURL(bag.url);
        bag.url = URL.createObjectURL(new Blob(bag.chunks, { type: rec.mimeType || 'audio/webm' }));
        bag.recording = false;
        setToggleIdle(root);
        showPlayRecording(root, true);
        setStatus(root, 'Recording ready. It stays on this page only.');
      };
      rec.start();
      setToggleRecording(root);
      setStatus(root, 'Recording…');
    }).catch(function () {
      setStatus(root, 'The browser did not allow the microphone. Nothing was saved. You can still practise out loud.');
    });
  }

  function playRecording(root) {
    var bag = bagFor(root);
    if (bag.url) new Audio(bag.url).play();
  }

  function toggleRecord(root) {
    var bag = bagFor(root);
    if (bag.recording) stopRecording(root);
    else startRecording(root);
  }

  function buildUi(root) {
    /* Icon-only row: [Play original] [Replay slot] [1-button gap] [Record/Stop].
       Replay uses assets/icons/person-speaking.svg (inlined so currentColor themes). */
    var replayIcon = '<svg class="tli-ar-replay-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 148 164" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M98.98 56.20A37.31 37.31 0 1 198.71 40.07L106.20 50.20Z M85.50 63.70H108V69H85.50Z"/><path fill="currentColor" d="M15.2 146.2C11.2 145.4 10.2 142 10.3 138C10.6 120 18 105.5 32.5 97.6C38.5 94.4 43.5 92 48.2 92C54.4 97.8 70.6 97.8 76.8 92C81.5 92 86.5 94.4 92.5 97.6C107 105.5 114.4 120 114.7 138C114.8 142 113.8 145.4 109.8 146.2Z"/><g fill="none" stroke="currentColor" stroke-width="7.6" stroke-linecap="round"><path d="M116.2 50.4L133.4 41.2"/><path d="M116 60L135.2 60"/><path d="M116.2 70.2L133.4 79.4"/></g></svg>';
    root.innerHTML =
      '<div class="tli-ar-row" role="group" aria-label="Speaking practice">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary tli-ar-original" data-ar-label="playOriginal" aria-label="' + esc(label('playOriginal')) + '" title="' + esc(label('playOriginal')) + '">' +
          '<i class="fa-solid fa-play tli-ar-play-icon" aria-hidden="true"></i>' +
        '</button>' +
        '<div class="tli-ar-replay-slot">' +
          '<button type="button" class="btn btn-sm btn-outline-primary tli-ar-play" data-ar-label="playRec" hidden aria-label="' + esc(label('playRec')) + '" title="' + esc(label('playRec')) + '">' +
            replayIcon +
          '</button>' +
        '</div>' +
        '<span class="tli-ar-gap" aria-hidden="true"></span>' +
        '<button type="button" class="btn btn-sm btn-primary tli-ar-toggle" data-ar-label="record" aria-pressed="false" aria-label="' + esc(label('record')) + '" title="' + esc(label('record')) + '">' +
          '<i class="fa-solid fa-microphone tli-ar-toggle-icon" aria-hidden="true"></i>' +
        '</button>' +
      '</div>' +
      '<p class="tli-ar-status" role="status"></p>';
  }

  function readInlineJson(el) {
    var scripts = el.querySelectorAll ? el.querySelectorAll('script[type="application/json"]') : [];
    for (var i = 0; i < scripts.length; i++) {
      var raw = (scripts[i].textContent || '').trim();
      if (!raw) continue;
      try { return JSON.parse(raw); } catch (e) { /* try next */ }
    }
    return null;
  }

  function applyConfig(el, config) {
    var bag = bagFor(el);
    bag.config = normalizeConfig(config);
    el.setAttribute('data-tli-ar', '1');
    if (bag.config.id) el.setAttribute('data-recorder-id', bag.config.id);
    buildUi(el);
  }

  function fetchConfig(rel) {
    var url = resolveUrl(rel);
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('recorder ' + rel + ' HTTP ' + res.status);
      return res.json();
    });
  }

  function mount(el, config) {
    if (!el || !el.getAttribute) return;
    if (config && typeof config === 'object') {
      applyConfig(el, config);
      return;
    }
    if (el.getAttribute('data-tli-ar') === '1' && bagFor(el).config) return;
    var inline = readInlineJson(el);
    if (inline) {
      applyConfig(el, inline);
      return;
    }
    var rel = el.getAttribute('data-recorder');
    if (rel) {
      fetchConfig(rel).then(function (data) {
        applyConfig(el, data);
      }).catch(function () {
        el.setAttribute('data-tli-ar', '1');
        buildUi(el);
        setStatus(el, 'Recorder config could not be loaded.');
      });
      return;
    }
    applyConfig(el, {});
  }

  function mountAll(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll ? scope.querySelectorAll('.tli-audio-recorder') : [];
    Array.prototype.forEach.call(nodes, function (el) { mount(el); });
  }

  function resetAll(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll ? scope.querySelectorAll('.tli-audio-recorder[data-tli-ar="1"]') : [];
    Array.prototype.forEach.call(nodes, function (el) { discardTake(el, true); setStatus(el, ''); });
  }

  function refreshLabels(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll ? scope.querySelectorAll('.tli-audio-recorder[data-tli-ar="1"]') : [];
    Array.prototype.forEach.call(nodes, function (el) {
      var bag = bagFor(el);
      if (bag.recording) setToggleRecording(el);
      else setToggleIdle(el);
      nameButton($('.tli-ar-original', el), 'playOriginal');
      nameButton($('.tli-ar-play', el), 'playRec');
    });
  }

  function onClick(ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var root = t.closest('.tli-audio-recorder');
    if (!root || root.getAttribute('data-tli-ar') !== '1') return;
    if (t.closest('.tli-ar-original')) { speakOriginal(root); return; }
    if (t.closest('.tli-ar-toggle')) { toggleRecord(root); return; }
    if (t.closest('.tli-ar-play')) { playRecording(root); return; }
  }

  global.TLIAudioRecorder = {
    mount: mount,
    mountAll: mountAll,
    resetAll: resetAll,
    refreshLabels: refreshLabels,
    normalizeConfig: normalizeConfig
  };

  document.addEventListener('click', onClick, false);

  /* Mount now: app.js may already have rendered quiz HTML (script order).
     Also listen for DOMContentLoaded for slow/partial parses (jsdom keeps readyState=loading). */
  mountAll(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountAll(document); });
  }
})(typeof window !== 'undefined' ? window : this);
