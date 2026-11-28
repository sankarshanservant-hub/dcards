// Страница онлайн-занятий «Метафорическое мышление и создание карт» (28.11.2026) и предварительная заявка.
// Текст страницы утверждён владельцем, здесь не переписывается. Дат, программы и стоимости нет — их и не показываем.
// Заявка без регистрации; у вошедшего имя и email подставляются из профиля. Подтверждение — только после сохранения.
import { esc, tt, u, api, errorText } from '../util.js';
import { session } from '../ui.js';

const RU = {
  title: 'Метафорическое мышление и создание карт', kicker: 'Творческие онлайн-воркшопы', lead: 'Идеи для ваших карт уже рядом.',
  p1: 'Стоит начать искать идею для карты, и вдруг замечаешь, сколько всего происходит вокруг. В привычных вещах проступают детали, которые раньше ускользали. Между событиями, на первый взгляд совсем разными, обнаруживаются неожиданные связи. Одна такая находка может дать пищу для размышлений, а из другой вырастет метафора. Сам поиск добавляет в повседневную жизнь красок и духа приключений. Уже ради этого стоит попробовать.',
  why: 'Ради чего прийти',
  list: [
    'Замечать больше в повседневной жизни: тонкие детали, неожиданные связи и идеи там, где раньше их не искали.',
    'Учиться мыслить метафорами и выражать через образы то, для чего трудно подобрать слова.',
    'Получать удовольствие от творчества: пробовать разные приёмы, экспериментировать и радоваться находкам.',
    'Создавать свои карты — собирать в образах личный архив историй, воспоминаний и открытий.',
    'Делиться работами, вдохновлять друг друга и видеть, как по-разному люди читают один и тот же образ.',
    'Создавать карты, с которых другим людям будет легче начать разговор по душам.',
  ],
  p2: 'На встречах будем знакомиться с опытом других авторов и пробовать творческие приёмы, которые помогают подмечать главное, соединять образы и делать так, чтобы метафора заговорила. Как передать через образ мысль или чувство, для которых трудно подобрать слова? Как сделать его выразительнее, чтобы он откликнулся другому человеку? Будем искать ответы на практике. А в конце занятия можно будет показать свою работу или набросок, поделиться находками и услышать, что в вашем образе увидели другие.',
  p3: 'Придумывать образы и удивляться тому, что из этого получается, — само по себе удовольствие. А открытия, которые хочется сохранить, могут стать вашими картами. Со временем из них складывается свой архив историй и воспоминаний. И вот что удивительно: вы сохранили в карте что-то важное для себя, а кто-то другой увидел в ней что-то своё. Так с одного образа может начаться разговор по душам.',
  p4: 'Мы уверены, что такой опыт нужен каждому. На своей жизни мы убедились, сколько радости приносит этот поиск и как удивительно работают образы в разговоре. Нам хочется поделиться этим с вами.',
  p5: 'Сейчас мы собираем желающих. Когда наберётся группа, объявим даты и время.',
  cta: 'Хочу на онлайн занятия', ctaNote: 'Оставьте предварительную заявку. Мы сообщим вам, когда появятся даты и подробности.',
  name: 'Имя', contact: 'Email или Telegram', contactHint: 'Используем этот контакт, чтобы сообщить о занятиях.', interest: 'Что вам интересно в этих занятиях?', optional: 'необязательно',
  send: 'Отправить заявку', sending: 'Отправляем…', thanks: 'Спасибо! Ваша заявка принята. Мы сообщим вам, когда появятся даты и подробности занятий.', already: 'Заявка отправлена', later: 'Мы сообщим вам, когда появятся даты и подробности занятий.',
  errName: 'Укажите имя.', errContact: 'Укажите email или ник в Telegram (например, @name).', errRetry: 'Заявка не отправлена. Проверьте соединение и попробуйте ещё раз — заполненное сохранено.',
};
// Английская версия — по смыслу русского (для переключателя языка); русский текст — исходный.
const EN = {
  title: 'Metaphorical thinking and card making', kicker: 'Creative online workshops', lead: 'Ideas for your cards are already close by.',
  p1: 'Once you start looking for an idea for a card, you suddenly notice how much is going on around you. Details that used to slip away show up in familiar things. Unexpected connections appear between events that at first seem completely different. One such find can give you food for thought, and a metaphor grows out of another. The search itself adds colour and a sense of adventure to everyday life. That alone makes it worth a try.',
  why: 'Why come',
  list: [
    'Notice more in everyday life: subtle details, unexpected connections and ideas where you never looked for them.',
    'Learn to think in metaphors and express through images what is hard to put into words.',
    'Enjoy creating: try different techniques, experiment and delight in your finds.',
    'Make your own cards — gather a personal archive of stories, memories and discoveries in images.',
    'Share your works, inspire each other and see how differently people read the same image.',
    'Make cards that help other people start a heart-to-heart conversation.',
  ],
  p2: 'At the meetings we will get to know the experience of other authors and try creative techniques that help notice what matters, connect images and make a metaphor speak. How do you convey through an image a thought or feeling that is hard to put into words? How do you make it more expressive so that it resonates with another person? We will look for answers in practice. At the end of a session you can show your work or a sketch, share your finds and hear what others saw in your image.',
  p3: 'Coming up with images and being surprised by what comes of it is a joy in itself. And the discoveries you want to keep can become your cards. Over time they grow into your own archive of stories and memories. And here is the amazing thing: you kept something important to you in a card, and someone else saw something of their own in it. That is how a heart-to-heart conversation can begin with a single image.',
  p4: 'We are sure everyone needs this experience. In our own lives we have seen how much joy this search brings and how wonderfully images work in conversation. We want to share it with you.',
  p5: 'We are now gathering those who are interested. Once there is a group, we will announce dates and times.',
  cta: 'I want to join the online workshops', ctaNote: 'Leave a preliminary request. We will let you know when dates and details are available.',
  name: 'Name', contact: 'Email or Telegram', contactHint: 'We will use this contact to tell you about the workshops.', interest: 'What interests you about these workshops?', optional: 'optional',
  send: 'Send request', sending: 'Sending…', thanks: 'Thank you! Your request has been received. We will let you know when dates and details of the workshops are available.', already: 'Request sent', later: 'We will let you know when dates and details of the workshops are available.',
  errName: 'Please enter your name.', errContact: 'Please enter an email or a Telegram username (for example, @name).', errRetry: 'The request was not sent. Check your connection and try again — what you entered is kept.',
};
const T = () => (tt('ru', 'en') === 'en' ? EN : RU);

export async function page(ctx) {
  const t = T();
  let mine = null; try { mine = (await api('/api/workshops/mine')).request; } catch { /* покажем форму */ }
  if (!ctx.alive()) return;
  const draft = { name: session.user ? session.user.publicName || '' : '', contact: session.user ? session.user.email || '' : '', interest: '' };
  let open = false; let sending = false; let done = mine ? 'already' : '';
  const formHtml = () => {
    if (done) return `<div class="notice green ws-done" role="status"><b>${esc(done === 'already' ? t.already : t.thanks)}</b>${done === 'already' ? `<p class="small" style="margin:4px 0 0">${esc(t.later)}</p>` : ''}</div>`;
    if (!open) return `<div class="ws-cta"><button class="btn yellow" type="button" id="wsopen">${esc(t.cta)}</button><p class="small muted">${esc(t.ctaNote)}</p></div>`;
    return `<form class="form ws-form card-ui flat" id="wsf" novalidate>
      <div class="stack" style="gap:6px"><label class="field" for="ws-name">${esc(t.name)}</label><input id="ws-name" name="name" maxlength="100" autocomplete="name" value="${esc(draft.name)}" aria-describedby="e-wsn"><p class="field-error" id="e-wsn"></p></div>
      <div class="stack" style="gap:6px"><label class="field" for="ws-contact">${esc(t.contact)}</label><input id="ws-contact" name="contact" maxlength="200" autocomplete="email" value="${esc(draft.contact)}" aria-describedby="h-wsc e-wsc"><span class="small muted" id="h-wsc">${esc(t.contactHint)}</span><p class="field-error" id="e-wsc"></p></div>
      <div class="stack" style="gap:6px"><label class="field" for="ws-int">${esc(t.interest)} <span class="hint">${esc(t.optional)}</span></label><textarea id="ws-int" name="interest" rows="3" maxlength="2000">${esc(draft.interest)}</textarea></div>
      <p class="form-error" role="alert" id="wserr"></p>
      <div><button class="btn yellow" type="submit" ${sending ? 'disabled aria-busy="true"' : ''}>${esc(sending ? t.sending : t.send)}</button></div></form>`;
  };
  ctx.main.innerHTML = `<article class="wrap page narrow stack ws-page">
    <header class="page-head"><p class="eyebrow">${esc(t.kicker)}</p><h1>${esc(t.title)}</h1></header>
    <p class="lead">${esc(t.lead)}</p><p>${esc(t.p1)}</p>
    <h2>${esc(t.why)}</h2><ul class="ws-list">${t.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p>${esc(t.p2)}</p><p>${esc(t.p3)}</p><p>${esc(t.p4)}</p><p><b>${esc(t.p5)}</b></p>
    <div id="wsbox">${formHtml()}</div></article>`;
  const box = ctx.main.querySelector('#wsbox');
  const draw = () => { box.innerHTML = formHtml(); wire(); };
  const wire = () => {
    const o = box.querySelector('#wsopen');
    if (o) o.addEventListener('click', () => { open = true; draw(); box.querySelector('#ws-name').focus(); });
    const f = box.querySelector('#wsf'); if (!f) return;
    f.addEventListener('input', () => { draft.name = f.name.value; draft.contact = f.contact.value; draft.interest = f.interest.value; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); if (sending) return;
      const en = box.querySelector('#e-wsn'); const ec = box.querySelector('#e-wsc'); en.textContent = ''; ec.textContent = '';
      if (!draft.name.trim()) { en.textContent = t.errName; f.name.focus(); return; }
      if (!draft.contact.trim()) { ec.textContent = t.errContact; f.contact.focus(); return; }
      sending = true; draw();
      try {
        const r = await api('/api/workshops', { method: 'POST', body: draft });
        sending = false; done = r.already ? 'already' : 'thanks'; draw();
      } catch (x) {
        sending = false; draw();
        if (x.code === 'contact_invalid') { box.querySelector('#e-wsc').textContent = t.errContact; box.querySelector('#ws-contact').focus(); }
        else if (x.code === 'name_required') box.querySelector('#e-wsn').textContent = t.errName;
        else box.querySelector('#wserr').textContent = `${t.errRetry}${x.status ? ' ' + errorText(x) : ''}`;
      }
    });
  };
  wire();
}
/** Приглашение из гайда и раздела для авторов (одна фраза со ссылкой). */
export const inviteHtml = () => `<p class="ws-invite small">${esc(tt('Хотите глубже познакомиться с метафорическим мышлением на онлайн-занятиях?', 'Want to get deeper into metaphorical thinking at online workshops?'))} <a href="${u('/workshops')}">${esc(tt('Оставьте заявку', 'Leave a request'))}</a></p>`;
