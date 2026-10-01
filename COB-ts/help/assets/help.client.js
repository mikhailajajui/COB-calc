(function () {
  'use strict';
  var doc = document;
  var root = doc.documentElement;
  var KEYS = ['manual', 'coverage', 'domain'];
  var live = doc.getElementById('live');
  var notice = doc.getElementById('notice');
  var box = doc.getElementById('goto');
  var msg = doc.getElementById('goto-msg');
  var tabs = Array.prototype.slice.call(doc.querySelectorAll('nav[aria-label="Documents"] a'));
  var tocs = Array.prototype.slice.call(doc.querySelectorAll('details.toc-box'));
  var wide = window.matchMedia('(min-width: 992px)');
  var current = 'manual';
  var timer = 0;
  var queued = false;

  function say(text) {
    live.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(function () { live.textContent = ''; }, 2000);
  }

  function show(key) {
    current = key;
    KEYS.forEach(function (k) {
      var a = doc.getElementById('doc-' + k);
      if (k === key) a.removeAttribute('hidden');
      else a.setAttribute('hidden', 'until-found');
    });
    tabs.forEach(function (t) {
      if (t.getAttribute('href') === '#doc-' + key) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    root.setAttribute('data-doc', key);
    root.className = 'js ready';
  }

  function resolve(hash) {
    var id = hash.replace(/^#/, '');
    try { id = decodeURIComponent(id); } catch (e) { /* keep the raw text */ }
    if (!id) return { key: 'manual' };
    var m = /^(?:doc-)?(manual|coverage|domain)$/.exec(id);
    if (m) return { key: m[1], top: true };
    var el = doc.getElementById(id) || doc.getElementById(id.toUpperCase());
    if (!el) return { key: 'manual', missing: id };
    var art = el.closest('article');
    return { key: art ? art.id.slice(4) : 'manual', el: el };
  }

  function route() {
    var r = resolve(location.hash);
    show(r.key);
    notice.textContent = r.missing ? 'No section named “' + r.missing + '”. Showing the User manual.' : '';
    if (r.el) {
      r.el.scrollIntoView();
      if (r.el.hasAttribute('tabindex')) r.el.focus({ preventScroll: true });
    } else if (r.top || r.missing) {
      window.scrollTo(0, 0);
    }
    layout();
    spy();
  }

  function spy() {
    queued = false;
    var art = doc.getElementById('doc-' + current);
    var heads = art.querySelectorAll('.doc-body h2[id], .doc-body h3[id]');
    var cur = null;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].getBoundingClientRect().top <= 160) cur = heads[i].id;
      else break;
    }
    Array.prototype.forEach.call(art.querySelectorAll('.toc-box a'), function (a) {
      if (cur && a.getAttribute('href') === '#' + cur) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  }

  function layout() {
    tocs.forEach(function (d) { d.open = wide.matches; });
  }

  function find(text) {
    var tries = [text, text.toUpperCase()];
    for (var i = 0; i < tries.length; i++) {
      var el = doc.getElementById(tries[i]) || doc.querySelector('[data-id="' + CSS.escape(tries[i]) + '"]');
      if (el) return el;
    }
    return null;
  }

  function goTo(el) {
    if (el.id) {
      if (location.hash === '#' + el.id) route();
      else location.hash = '#' + el.id;
      return;
    }
    show(el.closest('article').id.slice(4));
    el.scrollIntoView({ block: 'center' });
    el.classList.add('hit');
    setTimeout(function () { el.classList.remove('hit'); }, 2000);
  }

  box.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var text = box.value.trim();
    if (!text) return;
    var el = find(text);
    if (!el) {
      msg.textContent = 'No entry for ' + text + ' in this help.';
      return;
    }
    msg.textContent = '';
    goTo(el);
  });

  doc.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a.anchor') : null;
    if (!a || !navigator.clipboard) return;
    navigator.clipboard.writeText(location.href.split('#')[0] + a.getAttribute('href')).then(
      function () { say('Link copied'); },
      function () { /* the address bar still has the link */ }
    );
  });

  doc.addEventListener('beforematch', function (e) {
    var art = e.target.closest ? e.target.closest('article') : null;
    if (art && art.id.slice(4) !== current) show(art.id.slice(4));
  }, true);

  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', function () {
    if (!queued) {
      queued = true;
      requestAnimationFrame(spy);
    }
  }, { passive: true });
  wide.addEventListener('change', layout);

  var logo = doc.getElementById('brandLogo');
  logo.addEventListener('error', function () {
    logo.hidden = true;
    logo.nextElementSibling.hidden = false;
  });
  logo.src = logo.getAttribute('data-src');

  layout();
  route();
}());
