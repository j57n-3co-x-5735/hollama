(function() {
  var theme = null;
  try {
    var settings = localStorage.getItem('hollama-settings');
    theme = settings ? JSON.parse(settings).userTheme : null;
  } catch (e) { /* corrupted localStorage — fall through to default */ }
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-color-theme', theme);
})();
