// Тема до первой отрисовки (без вспышки другой темы). Явный выбор человека — в localStorage 'dc_theme';
// пока его нет — системная тема устройства; если её не определить — тёмная.
(function () {
  var t = null;
  try { t = localStorage.getItem('dc_theme'); } catch (e) { /* хранилище недоступно */ }
  if (t !== 'light' && t !== 'dark') {
    t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
