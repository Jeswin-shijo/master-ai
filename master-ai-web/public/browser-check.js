// A plain script, so it runs even where the app's code can't. If the app never
// draws anything (an old browser, or a blocked download), say so in words
// instead of leaving a blank page. It watches for the app's first drawing: the
// page can be empty for a moment between two screens, and that must never set
// it off. If the app draws late, the note goes away again.
(function () {
  var drawn = false;
  var note = function () {
    return document.getElementById('no-start');
  };
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('root');
    if (!root) return;
    if (root.hasChildNodes()) drawn = true;
    if (drawn || !window.MutationObserver) return;
    var watch = new MutationObserver(function () {
      if (!root.hasChildNodes()) return;
      drawn = true;
      if (note()) note().hidden = true;
      watch.disconnect();
    });
    watch.observe(root, { childList: true });
  });
  window.addEventListener('load', function () {
    setTimeout(function () {
      var root = document.getElementById('root');
      if (root && root.hasChildNodes()) drawn = true;
      if (!drawn && note()) note().hidden = false;
    }, 4000);
  });
})();
