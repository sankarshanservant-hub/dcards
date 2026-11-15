// Тема до первой отрисовки (без вспышки другой темы). По умолчанию — всегда тёмная, независимо от системной.
// Светлую человек включает сам; явный выбор хранится в localStorage 'dc_theme'. Прежние версии сохраняли туда
// только нажатие на переключатель (системная тема не записывалась), поэтому сохранённое значение — осознанный выбор.
(function () {
  var t = null;
  try { t = localStorage.getItem('dc_theme'); } catch (e) { /* хранилище недоступно */ }
  if (t !== 'light' && t !== 'dark') t = 'dark';
  document.documentElement.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'light' ? '#f5f5f2' : '#060c1e');
})();
