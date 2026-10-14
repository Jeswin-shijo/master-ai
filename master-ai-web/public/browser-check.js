// A plain script, so it runs even where the app's code can't. If the app hasn't
// drawn anything a few seconds after the page loaded (an old browser, or a
// blocked download), say so in words instead of leaving a blank page.
window.addEventListener('load', function () {
  setTimeout(function () {
    var root = document.getElementById('root');
    var note = document.getElementById('no-start');
    if (root && note && !root.hasChildNodes()) note.hidden = false;
  }, 4000);
});
