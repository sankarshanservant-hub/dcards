// Тема для отдельных страниц-набросков (strategy.html): светлая/тёмная, знак под тему.
(function () {
  const root = document.documentElement;
  const isLight = () => (root.dataset.theme ? root.dataset.theme === 'light' : matchMedia('(prefers-color-scheme: light)').matches);
  const syncEm = () => { const em = document.getElementById('em'); if (em) em.src = isLight() ? 'img/emblem-black.webp' : 'img/emblem-cream.webp'; };
  const b = document.getElementById('theme'); if (b) b.addEventListener('click', () => { root.dataset.theme = isLight() ? 'dark' : 'light'; syncEm(); });
  syncEm();
})();
