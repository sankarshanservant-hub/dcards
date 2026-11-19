'use strict';
// Что видно из демо-данных в служебных разделах (админка, кураторы).
// scope: false — только настоящие записи; true — все (настоящий пользователь включил демо-просмотр);
// 'only' — только демо-записи: демо-роль может взять любой посетитель, настоящие данные ей показывать нельзя.
const demoWhere = (scope, col) => (scope === 'only' ? `${col} = 1` : scope ? '1=1' : `${col} = 0`);
const demoScope = (req) => (!req.showDemo ? false : req.user && req.user.is_demo ? 'only' : true);
module.exports = { demoWhere, demoScope };
