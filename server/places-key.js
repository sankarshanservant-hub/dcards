// Ключ поиска города: без регистра, ё → е, без пробелов, дефисов, точек и апострофов («Чианг-Май» = «чиангмай»).
const cityKey = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s\-–—'’.,()]/g, '');
module.exports = { cityKey };
