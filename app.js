/* Hide in Plain Sight - page wiring. Logic lives in logic.js (window.HIPS). */
(function () {
  'use strict';
  var H = window.HIPS;
  var $ = function (id) { return document.getElementById(id); };

  var LS_KEY = 'hips_api_key';
  var LS_APP = 'hips_app_key';
  var LS_SAVED = 'hips_saved';
  var SS_TOKEN = 'hips_oauth_key';
  var SS_VERIFIER = 'hips_pkce_verifier';
  var SS_STATE = 'hips_pkce_state';

  var currentPicture = null;

  /* ---------------- keys ---------------- */

  function getKey() {
    return sessionStorage.getItem(SS_TOKEN) || localStorage.getItem(LS_KEY) || '';
  }
  function getAppKey() {
    return ($('appKeyInput').value || localStorage.getItem(LS_APP) || '').trim();
  }

  function refreshKeyState(extra) {
    var el = $('keyState');
    var hasSession = !!sessionStorage.getItem(SS_TOKEN);
    var hasLocal = !!localStorage.getItem(LS_KEY);
    if (hasSession) { el.textContent = 'Connected with Pollinations (this tab)'; el.classList.add('on'); }
    else if (hasLocal) { el.textContent = 'Connected: your key, this browser'; el.classList.add('on'); }
    else { el.textContent = 'No key connected'; el.classList.remove('on'); }
    if (extra) { $('keyResult').textContent = extra; }
  }

  function syncDemoMode() {
    var demo = $('demoMode').checked;
    var select = $('modelSelect');
    select.disabled = demo;
    select.setAttribute('aria-disabled', demo ? 'true' : 'false');
    $('modelField').classList.toggle('is-disabled', demo);
  }

  function saveKeys() {
    var k = $('apiKeyInput').value.trim();
    var a = $('appKeyInput').value.trim();
    if (k) localStorage.setItem(LS_KEY, k); else localStorage.removeItem(LS_KEY);
    if (a) localStorage.setItem(LS_APP, a); else localStorage.removeItem(LS_APP);
    refreshKeyState(k || a ? 'Saved. Keys never leave this browser except to gen.pollinations.ai.' : 'Nothing to save.');
  }

  function wipeKeys() {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_APP);
    sessionStorage.removeItem(SS_TOKEN);
    $('apiKeyInput').value = '';
    $('appKeyInput').value = '';
    refreshKeyState('Keys wiped from this browser.');
  }

  /* ---------------- BYOP connect (OAuth code flow with PKCE) ---------------- */

  function base64url(bytes) {
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randomString(len) {
    var arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return base64url(arr);
  }

  function startConnect() {
    var appKey = getAppKey();
    if (!appKey) {
      $('keyResult').textContent = 'Add an app key (pk_...) first, or just paste your own API key.';
      return;
    }
    localStorage.setItem(LS_APP, appKey);
    var verifier = randomString(48);
    var state = randomString(18);
    sessionStorage.setItem(SS_VERIFIER, verifier);
    sessionStorage.setItem(SS_STATE, state);
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (hash) {
      var params = new URLSearchParams({
        response_type: 'code',
        client_id: appKey,
        redirect_uri: location.origin + location.pathname,
        scope: 'usage',
        models: 'text',
        budget: '10',
        expiry: '7',
        state: state,
        code_challenge: base64url(new Uint8Array(hash)),
        code_challenge_method: 'S256'
      });
      location.href = 'https://enter.pollinations.ai/authorize?' + params.toString();
    });
  }

  function handleOAuthCallback() {
    var params = new URLSearchParams(location.search);
    var code = params.get('code');
    if (!code) return;
    var state = params.get('state');
    var savedState = sessionStorage.getItem(SS_STATE);
    var verifier = sessionStorage.getItem(SS_VERIFIER);
    history.replaceState(null, '', location.pathname);
    if (!verifier || state !== savedState) {
      refreshKeyState('Connect failed: state mismatch. Try again.');
      return;
    }
    var appKey = localStorage.getItem(LS_APP) || '';
    fetch('https://enter.pollinations.ai/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: appKey,
        redirect_uri: location.origin + location.pathname,
        code_verifier: verifier
      })
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (data && data.access_token) {
        sessionStorage.setItem(SS_TOKEN, data.access_token);
        refreshKeyState('Connected with Pollinations. The key lives in this tab only.');
      } else {
        refreshKeyState('Connect failed: ' + ((data && (data.error_description || data.error)) || 'unknown error'));
      }
    }).catch(function () {
      refreshKeyState('Connect failed: network error.');
    }).finally(function () {
      sessionStorage.removeItem(SS_VERIFIER);
      sessionStorage.removeItem(SS_STATE);
    });
  }

  /* ---------------- model calls ---------------- */

  function callModel(key, model, messages) {
    return fetch(H.API_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model, messages: messages })
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { /* keep raw */ }
        if (!res.ok) {
          var msg = (data && data.error && (data.error.message || data.error)) || text.slice(0, 220);
          throw new Error('Model call failed (' + res.status + '): ' + msg);
        }
        var content = data && data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content : null;
        if (!content) throw new Error('The model replied with nothing readable.');
        return content;
      });
    });
  }

  /* ---------------- hide ---------------- */

  function chips(objects) {
    return (objects || []).map(function (o) {
      var s = String(o);
      return '<span class="chip"><b>' + escapeHtml(s.charAt(0).toUpperCase()) + '</b>' + escapeHtml(s.slice(1)) + '</span>';
    }).join(' ');
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showPicture(pic, secret, note) {
    currentPicture = { title: pic.title, objects: pic.objects, svg: pic.svg, secret: secret || '' };
    var stage = $('stage');
    stage.classList.remove('empty');
    stage.innerHTML = H.sanitizeSvg(pic.svg);
    $('pictureMeta').hidden = false;
    $('objectChips').innerHTML = chips(pic.objects);
    var acr = H.acrosticOf(pic.objects);
    var line = 'First letters: ' + acr.split('').join(' ') + ' spells ' + (acr || 'nothing yet') + '.';
    if (secret) {
      line += H.verifyAcrostic(pic.objects, secret)
        ? ' Matches your word. Checked by the app.'
        : ' That is not your word (' + secret + '). The model missed; try again or pick another model.';
    }
    if (note) line += ' ' + note;
    $('acrosticLine').textContent = line;
  }

  function doHide() {
    var secret = H.sanitizeSecret($('secretInput').value);
    var status = $('hideStatus');
    if (secret.length < 2) { status.textContent = 'Give me a word of at least 2 letters.'; return; }
    var theme = $('themeSelect').value;
    var demo = $('demoMode').checked;
    var btn = $('hideBtn');
    btn.disabled = true;
    if (demo) {
      status.textContent = 'Drawing with the built-in illustrator...';
      setTimeout(function () {
        showPicture(H.mockHide(secret, theme), secret, 'Demo picture: drawn locally, no Pollen spent.');
        status.textContent = 'Done (demo).';
        btn.disabled = false;
      }, 60);
      return;
    }
    var key = getKey();
    if (!key) {
      status.textContent = 'No key yet. Paste your Pollinations key above, or tick demo mode.';
      btn.disabled = false;
      return;
    }
    var model = $('modelSelect').value;
    var messages = H.buildHideMessages(secret, theme);
    status.textContent = 'Asking ' + model + ' to draw... this can take a moment.';
    callModel(key, model, messages).then(function (content) {
      if (H.isBalanceNotice(content)) {
        throw new Error('That model needs paid Pollen and your balance does not cover it. Top up, or pick GPT-5.4 Nano, which runs on any balance.');
      }
      var pic = H.parseHideResponse(content);
      if (!pic) throw new Error('The model reply held no readable picture.');
      if (H.verifyAcrostic(pic.objects, secret)) {
        showPicture(pic, secret, '');
        status.textContent = 'Done. The row spells your word.';
        btn.disabled = false;
        return null;
      }
      status.textContent = 'The row spells ' + H.acrosticOf(pic.objects) + ', not ' + secret + '. Asking the model to fix it...';
      var retry = messages.concat([
        { role: 'assistant', content: content },
        { role: 'user', content: H.buildHideRetryMessage(secret, pic.objects) }
      ]);
      return callModel(key, model, retry).then(function (content2) {
        var pic2 = H.parseHideResponse(content2);
        if (!pic2) { showPicture(pic, secret, ''); status.textContent = 'The fix-up reply was unreadable; showing the first picture.'; }
        else {
          showPicture(pic2, secret, '');
          status.textContent = H.verifyAcrostic(pic2.objects, secret)
            ? 'Done. The redrawn row spells your word.'
            : 'Done, but the row still does not spell your word. Showing the second try.';
        }
        btn.disabled = false;
      });
    }).catch(function (err) {
      status.textContent = err.message;
      btn.disabled = false;
    });
  }

  /* ---------------- picture actions ---------------- */

  function downloadSvg() {
    if (!currentPicture) return;
    var blob = new Blob([currentPicture.svg], { type: 'image/svg+xml' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hidden-picture.svg';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function copySvg() {
    if (!currentPicture) return;
    var done = function () { $('hideStatus').textContent = 'SVG code copied. Anyone with the code can try to read the word.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(currentPicture.svg).then(done, function () { fallbackCopy(); done(); });
    } else { fallbackCopy(); done(); }
  }
  function fallbackCopy() {
    var ta = document.createElement('textarea');
    ta.value = currentPicture.svg;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* clipboard unavailable */ }
    ta.remove();
  }

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(LS_SAVED) || '[]'); } catch (e) { return []; }
  }
  function storeSaved(list) {
    localStorage.setItem(LS_SAVED, JSON.stringify(list.slice(0, 12)));
  }

  function renderSaved() {
    var list = loadSaved();
    var wrap = $('savedWrap');
    var box = $('savedList');
    wrap.hidden = !list.length;
    box.innerHTML = '';
    list.forEach(function (item, idx) {
      var fig = document.createElement('figure');
      var thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.innerHTML = H.sanitizeSvg(item.svg);
      var cap = document.createElement('figcaption');
      cap.textContent = item.title + ' - hides ' + (H.acrosticOf(item.objects) || '?');
      var open = document.createElement('button');
      open.type = 'button'; open.className = 'mini'; open.textContent = 'Open';
      open.addEventListener('click', function () {
        showPicture(item, item.secret || '', 'Opened from your saved pictures.');
        $('revealInput').value = item.svg;
      });
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'mini'; del.textContent = 'Delete';
      del.addEventListener('click', function () {
        var l = loadSaved(); l.splice(idx, 1); storeSaved(l); renderSaved();
      });
      fig.appendChild(thumb); fig.appendChild(cap); fig.appendChild(open); fig.appendChild(del);
      box.appendChild(fig);
    });
  }

  function saveCurrent() {
    if (!currentPicture) return;
    var list = loadSaved();
    list.unshift({
      title: currentPicture.title || 'Hidden picture',
      objects: currentPicture.objects,
      svg: currentPicture.svg,
      secret: currentPicture.secret || '',
      ts: Date.now()
    });
    storeSaved(list);
    renderSaved();
    $('hideStatus').textContent = 'Saved in this browser.';
  }

  /* ---------------- reveal ---------------- */

  function showReveal(r, sourceNote) {
    var box = $('revealResult');
    box.hidden = false;
    if (!r || !r.found) {
      box.innerHTML = '<p><strong>Nothing found.</strong></p><p>' +
        escapeHtml((r && r.notes) || 'The reader could not find a hidden message in this picture.') + '</p>';
      return;
    }
    var html = '<p>The hidden word is</p><p class="word">' + escapeHtml(r.message) + '</p>';
    if (r.method) html += '<p><strong>How:</strong> ' + escapeHtml(r.method) + '</p>';
    if (r.objects && r.objects.length) html += '<p>The row: ' + chips(r.objects) + '</p>';
    if (r.confidence) html += '<p><strong>Confidence:</strong> ' + escapeHtml(r.confidence) + '</p>';
    if (r.notes) html += '<p>' + escapeHtml(r.notes) + '</p>';
    if (sourceNote) html += '<p class="hint">' + escapeHtml(sourceNote) + '</p>';
    box.innerHTML = html;
  }

  function doReveal(useDemo) {
    var svg = $('revealInput').value.trim();
    var status = $('revealStatus');
    if (!svg || svg.indexOf('<svg') < 0) { status.textContent = 'Paste an SVG picture first.'; return; }
    if (useDemo || $('demoMode').checked) {
      showReveal(H.mockReveal(svg), 'Read locally in demo mode. No model call, no Pollen.');
      status.textContent = 'Done (demo).';
      return;
    }
    var key = getKey();
    if (!key) { status.textContent = 'No key yet. Paste your Pollinations key above, or use the local demo reader.'; return; }
    var model = $('modelSelect').value;
    var btn = $('revealBtn');
    btn.disabled = true;
    status.textContent = 'A fresh ' + model + ' call is reading the picture...';
    callModel(key, model, H.buildRevealMessages(svg)).then(function (content) {
      if (H.isBalanceNotice(content)) {
        throw new Error('That model needs paid Pollen and your balance does not cover it. Top up, or pick GPT-5.4 Nano, which runs on any balance.');
      }
      var r = H.parseRevealResponse(content);
      if (!r) throw new Error('The model reply could not be read.');
      showReveal(r, 'Read by a fresh model call that only saw the picture code.');
      status.textContent = 'Done.';
    }).catch(function (err) {
      status.textContent = err.message;
    }).finally(function () { btn.disabled = false; });
  }

  /* ---------------- example ---------------- */

  function initExample() {
    var ex = H.galleryExample();
    $('exampleStage').innerHTML = H.sanitizeSvg(ex.svg);
    $('exampleRevealBtn').addEventListener('click', function () {
      var r = H.mockReveal(ex.svg);
      $('exampleResult').textContent = r.found
        ? 'The word is ' + r.message + ': ' + r.objects.join(', ') + '.'
        : 'Nothing found.';
      $('exampleResult').className = 'result ' + (r.found ? 'good' : 'bad');
    });
  }

  /* ---------------- init ---------------- */

  function init() {
    var savedKey = localStorage.getItem(LS_KEY);
    var savedApp = localStorage.getItem(LS_APP);
    if (savedKey) $('apiKeyInput').value = savedKey;
    if (savedApp) $('appKeyInput').value = savedApp;
    handleOAuthCallback();
    refreshKeyState();
    syncDemoMode();
    $('demoMode').addEventListener('change', syncDemoMode);
    $('saveKeyBtn').addEventListener('click', saveKeys);
    $('wipeKeyBtn').addEventListener('click', wipeKeys);
    $('connectBtn').addEventListener('click', startConnect);
    $('hideBtn').addEventListener('click', doHide);
    $('downloadBtn').addEventListener('click', downloadSvg);
    $('copyBtn').addEventListener('click', copySvg);
    $('saveBtn').addEventListener('click', saveCurrent);
    $('sendToRevealBtn').addEventListener('click', function () {
      if (!currentPicture) return;
      $('revealInput').value = currentPicture.svg;
      $('revealCard').scrollIntoView({ behavior: 'smooth' });
    });
    $('revealBtn').addEventListener('click', function () { doReveal(false); });
    $('revealDemoBtn').addEventListener('click', function () { doReveal(true); });
    initExample();
    renderSaved();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
