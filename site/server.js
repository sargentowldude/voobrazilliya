import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const siteUrl = (process.env.SITE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const adminPassword = process.env.ADMIN_PASSWORD || 'tema-admin';
const cookieSecret = process.env.ADMIN_COOKIE_SECRET || 'local-tema-secret';

const dataDir = path.join(__dirname, 'data');
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const files = {
  content: path.join(dataDir, 'content.json'),
  events: path.join(dataDir, 'events.json'),
  heroes: path.join(dataDir, 'heroes.json'),
  shows: path.join(dataDir, 'shows.json'),
  plays: path.join(dataDir, 'plays.json'),
  leads: path.join(dataDir, 'leads.jsonl')
};

await fs.mkdir(uploadsDir, { recursive: true });
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const storage = multer.diskStorage({
  destination: (_req, _file, done) => done(null, uploadsDir),
  filename: (_req, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase() || '.jpg';
    done(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, done) => done(null, /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype))
});

const readJson = async (file, fallback) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
};
const writeJson = async (file, value) => {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
};
const loadContent = () => readJson(files.content, {});
const loadCatalog = type => readJson(files[type], []);
const saveCatalog = (type, items) => writeJson(files[type], items);
const now = () => new Date().toISOString();
const truthy = value => value === true || value === 'true' || value === 'on' || value === '1';
const number = (value, fallback = 50) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(200, parsed)) : fallback;
};
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const escapeAttr = escapeHtml;
const slugify = value => String(value || '')
  .toLowerCase()
  .replace(/ё/g, 'e')
  .replace(/[а-я]/g, char => ({ а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ж:'zh', з:'z', и:'i', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'h', ц:'ts', ч:'ch', ш:'sh', щ:'sch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya' })[char] || '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
const uniqueSlug = (value, items, currentId) => {
  const base = slugify(value) || `programma-${Date.now()}`;
  let candidate = base;
  let index = 2;
  while (items.some(item => item.id !== currentId && item.slug === candidate)) candidate = `${base}-${index++}`;
  return candidate;
};
const formatPrice = value => `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`;
const cropStyle = item => `object-position:${number(item.imagePositionX)}% ${number(item.imagePositionY)}%;transform-origin:${number(item.imagePositionX)}% ${number(item.imagePositionY)}%;transform:scale(${number(item.imageScale, 100) / 100});`;
const image = (item, className = '') => item?.image
  ? `<img class="${className}" src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name || item.title || '')}" style="${cropStyle(item)}">`
  : '<span class="hero-program-card__placeholder">ФОТО ПОЯВИТСЯ ЗДЕСЬ</span>';
const photoFromContent = (content, key) => ({
  image: content[key] || '',
  imagePositionX: content[`${key}PositionX`] ?? 50,
  imagePositionY: content[`${key}PositionY`] ?? 50,
  imageScale: content[`${key}Scale`] ?? 100
});
const photoWithFallback = (content, key, fallbackKey) => content[key]
  ? photoFromContent(content, key)
  : photoFromContent(content, fallbackKey);
const visible = item => item && item.published !== false;

const sign = value => crypto.createHmac('sha256', cookieSecret).update(value).digest('base64url');
const sessionValue = () => { const value = `admin.${Date.now() + 1000 * 60 * 60 * 24 * 7}`; return `${value}.${sign(value)}`; };
const isAdmin = req => {
  const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('tema_admin='))?.slice(11);
  if (!token) return false;
  const pieces = token.split('.');
  if (pieces.length !== 3) return false;
  const raw = `${pieces[0]}.${pieces[1]}`;
  const expected = sign(raw);
  return pieces[2].length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(pieces[2])) && Number(pieces[1]) > Date.now();
};
const requireAdmin = (req, res, next) => isAdmin(req) ? next() : res.redirect('/admin/login');
const deleteUploaded = async file => { if (file?.path) await fs.unlink(file.path).catch(() => {}); };

const pageMeta = ({ title, description, path = '/' }) => ({
  title: title || 'ТЕМА — детские праздники в Кемерово',
  description: description || 'Аниматоры, шоу и спектакли для детских праздников в Кемерово.',
  canonical: `${siteUrl}${path}`
});

const nav = () => `<header class="site-header"><a class="wordmark" href="/">ТЕМА</a><button class="menu-button" type="button" aria-expanded="false">МЕНЮ +</button><nav class="site-menu" aria-label="Основная навигация"><a href="/animatory/">Аниматоры</a><a href="/detskiy-den-rozhdeniya/">День рождения</a><a href="/show/">Шоу</a><a href="/spektakli/">Спектакли</a><a href="/afisha/">Афиша</a><a href="tel:+79000000000">Позвонить</a></nav></header>`;

const leadDialog = () => `<dialog class="lead-dialog"><button type="button" class="dialog-close" aria-label="Закрыть">×</button><span class="mono-tag">Заявка</span><h2>Давайте<br>устроим<br>праздник</h2><form class="contact-form contact-form--dialog" data-lead-form><label>Ваше имя<input required name="name" autocomplete="name" placeholder="Как к вам обращаться"></label><label>Телефон<input required name="phone" type="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__"></label><label class="contact-form__details-label contact-form__details-label--wide">Комментарий<textarea name="comment" rows="3" placeholder="Что хотите заказать?"></textarea></label><input type="hidden" name="service"><input type="hidden" name="message"><label class="consent"><input required name="consent" type="checkbox"> Согласен на обработку данных</label><button class="cream-button" type="submit">ОТПРАВИТЬ ЗАЯВКУ</button><p class="form-status" aria-live="polite"></p></form></dialog>`;

const layout = (meta, body, pageClass = '') => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(meta.title)}</title><meta name="description" content="${escapeAttr(meta.description)}"><link rel="canonical" href="${escapeAttr(meta.canonical)}"><meta property="og:title" content="${escapeAttr(meta.title)}"><meta property="og:description" content="${escapeAttr(meta.description)}"><meta property="og:type" content="website"><link rel="stylesheet" href="/styles.css"></head><body class="${pageClass}">${nav()}<main>${body}</main>${leadDialog()}<script src="/app.js" defer></script></body></html>`;

const heroBlock = ({ tag, lines, intro, photo, mascot = '/assets/mascot-peek.png', action = 'Подобрать праздник', service = 'Праздник', pageClass = '', artVariant = '' }) => {
  const resolvedArtVariant = artVariant;
  const artLabel = ({ animatory:'КАСТИНГ ГЕРОЕВ', show:'НАЖМИ · ИГРА НАЧАЛАСЬ', theater:'ЗАНАВЕС ОТКРЫТ' })[resolvedArtVariant] || 'ГЛАВНЫЙ КАДР';
  const photoMarkup = resolvedArtVariant
    ? `<div class="landing-hero-art landing-hero-art--${escapeAttr(resolvedArtVariant)}" aria-hidden="true"><span class="landing-hero-art__label">${escapeHtml(artLabel)}</span><i class="landing-hero-art__shape landing-hero-art__shape--one"></i><i class="landing-hero-art__shape landing-hero-art__shape--two"></i>${photo?.image ? `<img src="${escapeAttr(photo.image)}" alt="" style="${cropStyle(photo)}">` : ''}</div>`
    : `<div class="hero-photo-slot image-slot">${photo?.image ? `<img class="managed-photo" src="${escapeAttr(photo.image)}" alt="" style="${cropStyle(photo)}">` : '<div class="placeholder-art placeholder-art--party"><i></i><i></i><i></i></div>'}</div>`;
  return `<section class="hero ${pageClass}"><span class="hero__tag mono-tag">${escapeHtml(tag)}</span><h1>${lines.map((line, index) => index === 0 ? `<span class="hero__line"><span class="hero__mascot-wrap" aria-hidden="true">${mascot ? `<img class="hero__mascot" src="${escapeAttr(mascot)}" alt="">` : ''}</span><span class="hero__text">${escapeHtml(line)}</span></span>` : `<span${index === 1 ? ' class="soft"' : ''}>${escapeHtml(line)}</span>`).join(' ')}</h1>${photoMarkup}<div class="hero__foot"><p>${escapeHtml(intro)}</p><button class="outline-button" data-open-form data-service="${escapeAttr(service)}">${escapeHtml(action)} <span>↗</span></button></div></section>`;
};

const pageHeroDefaults = {
  animatory: {
    title: 'ДЕТСКИЕ АНИМАТОРЫ\nНА ПРАЗДНИК\nВ КЕМЕРОВО',
    intro: 'Аниматоры в Кемерово для дня рождения, детского сада и школьного праздника. Выберите любимого героя — и он приедет с программой.'
  },
  show: {
    title: 'ШОУ-ПРОГРАММЫ\nНА ПРАЗДНИК\nВ КЕМЕРОВО',
    intro: 'Шоу-программы в Кемерово для дня рождения, выпускного, компании взрослых и большого праздника. Эмоции, музыка и участие каждого гостя.'
  },
  theater: {
    title: 'СПЕКТАКЛИ\nДЛЯ ДЕТЕЙ\nВ КЕМЕРОВО',
    intro: 'Выездные спектакли для детей в Кемерово: для детских садов, школ, праздников и больших семейных встреч. Дети не зрители — они внутри истории.'
  },
  birthday: {
    title: 'ДЕНЬ РОЖДЕНИЯ\nДЛЯ ДЕТЕЙ\nВ КЕМЕРОВО',
    intro: 'Детский день рождения в Кемерово с аниматором, шоу или спектаклем. Подберём программу по возрасту ребёнка, гостям и вашей площадке.'
  }
};

const pageHeroCopy = (content, key) => {
  const fallback = pageHeroDefaults[key];
  const title = String(content[`${key}HeroTitle`] || fallback.title).trim();
  return {
    lines: title.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
    intro: String(content[`${key}HeroIntro`] || fallback.intro).trim()
  };
};

const partyForm = () => `<section class="contact" id="zayavka"><div><span class="mono-tag">Ваш праздник за три шага</span><h2>Соберём<br>вау-эффект</h2><p>Выберите возраст и формат — заявка уже будет понятна нам. Останется оставить имя и телефон.</p></div><form class="contact-form contact-form--planner" data-lead-form data-party-builder><div class="contact-form__planner-intro"><span class="mono-tag">Мини-конструктор</span><strong>Какой праздник<br>нужен вам?</strong><p data-builder-summary>Выберите возраст и формат — добавим их к заявке.</p></div><fieldset class="contact-form__step contact-form__step--age"><legend><b>01</b>Возраст ребёнка</legend><div class="contact-form__choices"><button type="button" data-builder-age="0–3 года">0–3</button><button type="button" data-builder-age="4–6 лет">4–6</button><button type="button" data-builder-age="7–9 лет">7–9</button><button type="button" data-builder-age="10+ лет">10+</button></div></fieldset><fieldset class="contact-form__step contact-form__step--format"><legend><b>02</b>Формат</legend><div class="contact-form__choices"><button type="button" data-builder-format="Аниматор">Герой</button><button type="button" data-builder-format="Шоу">Шоу</button><button type="button" data-builder-format="Спектакль">Театр</button><button type="button" data-builder-format="День рождения">Под ключ</button></div></fieldset><input type="hidden" name="childAge"><input type="hidden" name="partyFormat"><input type="hidden" name="service"><input type="hidden" name="message"><label class="contact-form__details-label">Ваше имя<input required name="name" autocomplete="name" placeholder="Как к вам обращаться"></label><label class="contact-form__details-label">Телефон<input required name="phone" type="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__"></label><label class="contact-form__details-label contact-form__details-label--wide">Комментарий<input name="comment" placeholder="Дата, район, пожелания"></label><label class="consent"><input required name="consent" type="checkbox"> Согласен на обработку данных</label><button class="cream-button" type="submit">ОТПРАВИТЬ ЗАЯВКУ</button><p class="form-status" aria-live="polite"></p></form></section>`;

const factIcons = {
  age: '<svg class="service-card__fact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  people: '<svg class="service-card__fact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2"/><path d="M3 20c.5-4 3-6 6-6s5.5 2 6 6M15 15c3 0 5 1.8 5.5 5"/></svg>'
};
const directionCard = ({ href, title, age, people, variant, photo, mascot }) => `<a class="service-card service-card--${variant}${mascot ? ' service-card--has-mascot' : ''}" href="${escapeAttr(href)}">${photo?.image ? `<div class="service-card__media">${image(photo)}</div>` : ''}<h3>${escapeHtml(title)}</h3><dl class="service-card__facts"><div><dt>${factIcons.age} Возраст</dt><dd>${escapeHtml(age)}</dd></div><div><dt>${factIcons.people} Гостей</dt><dd>${escapeHtml(people)}</dd></div></dl>${mascot ? `<img class="service-card__mascot-game" src="${escapeAttr(mascot)}" alt="" aria-hidden="true">` : ''}<span class="service-card__cta">ВЫБРАТЬ <b>↗</b></span></a>`;

const reviews = () => {
  const items = [
    ['Алексей', 'А', '1 июля', 'Всё было супер 😁👍 Наш праздник стал лучше на 300%! Спасибо тебе! Возвращайся скорее, будем ждать.'],
    ['Татьяна Новикова', 'Т', '21 июня', 'Очень нам понравился Человек-паук, дети в восторге. Спасибо вам большое 😍'],
    ['Инна', 'И', '2 июня', 'Это нереально крутой Человек-паук. Появление просто вау! Дети остались очень довольны — а это главное для родителей.'],
    ['Михаил', 'М', '13 мая', 'Договорились за пару недель, за день созвонились — всё на высшем уровне. Аниматор приехал минута в минуту.'],
    ['Татьяна', 'Т', '11 апреля', 'Пригласили на день рождения Человека-паука. Аниматор пришёл вовремя и отыграл программу на все 1000%.'],
    ['Екатерина', 'Е', '2 мая', 'Спасибо за чудесный праздник для сына! Максим светился счастьем, а для мамы это самое главное.'],
    ['Алина', 'А', '15 апреля', 'Спасибо аниматору! Всё прошло просто отлично. Ребёнок в полном восторге.']
  ];
  return `<section class="reviews" aria-labelledby="reviews-title"><div class="reviews__heading"><div><span class="mono-tag">Отзывы родителей</span><h2 id="reviews-title">Праздники,<br>о которых<br>говорят дома</h2></div><div class="reviews__score"><strong>5,0</strong><div><span aria-label="5 из 5 звёзд">★★★★★</span><p>Спасибо за доверие — это отзывы семей после настоящих праздников.</p></div></div></div><div class="reviews__grid">${items.map((item, index) => `<article class="review-card review-card--${['yellow','pink','violet','cream','sage','blue'][index % 6]}"><header class="review-card__header"><span class="review-card__avatar">${item[1]}</span><div><h3>${item[0]}</h3><time>${item[2]}</time></div></header><p class="review-card__rating" aria-label="Оценка: 5 из 5">★★★★★</p><blockquote>«${item[3]}»</blockquote></article>`).join('')}</div></section>`;
};

const eventCards = events => `<div class="event-grid">${events.filter(visible).map((event, index) => `<article class="poster-card poster-card--${['yellow','pink','red'][index % 3]}">${event.image ? `<div class="poster-card__image ${event.imageFit === 'poster' ? 'poster-card__image--poster' : ''}">${image(event)}</div>` : ''}<span class="mono-tag">${escapeHtml(event.category || 'Афиша')} · ${escapeHtml(event.date || '')}</span><h3>${escapeHtml(event.title)}</h3>${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}${event.buttonUrl ? `<a class="poster-card__cta" href="${escapeAttr(event.buttonUrl)}"><span>${escapeHtml(event.buttonLabel || 'Открыть')}</span><b>↗</b></a>` : `<a class="poster-card__cta" href="/afisha/${escapeAttr(event.slug)}/"><span>${escapeHtml(event.buttonLabel || 'Открыть афишу')}</span><b>↗</b></a>`}</article>`).join('')}</div>`;

const renderHome = async () => {
  const content = await loadContent();
  const events = await loadCatalog('events');
  const directionCards = [
    directionCard({ href:'/animatory/?audience=boys#hero-catalog', title:'Аниматор для мальчика', age:'0+', people:'от 1 до 15', variant:'yellow', photo:photoWithFallback(content, 'homeBoyPhoto', 'animatoryPhoto1') }),
    directionCard({ href:'/animatory/?audience=girls#hero-catalog', title:'Аниматор для девочки', age:'0+', people:'от 1 до 15', variant:'cream', photo:photoWithFallback(content, 'homeGirlPhoto', 'animatoryPhoto2') }),
    directionCard({ href:'/show/#show-catalog', title:'Шоу для взрослых', age:'12+', people:'от 2 до 50', variant:'pink', photo:photoWithFallback(content, 'homeAdultShowPhoto', 'showPhoto1'), mascot:'/assets/mascot-game.png' }),
    directionCard({ href:'/show/#show-catalog', title:'Пенная вечеринка', age:'3+', people:'от 1 до 200', variant:'foam', photo:photoWithFallback(content, 'homeFoamPhoto', 'showPhoto2') }),
    directionCard({ href:'/spektakli/', title:'Спектакли к вам', age:'3+', people:'от 30 до 150', variant:'birthday', photo:photoWithFallback(content, 'homeTheaterPhoto', 'theaterPhoto1') })
  ].join('');
  const formats = 'АНИМАТОРЫ <i>✦</i> ШОУ <i>✦</i> СПЕКТАКЛИ <i>✦</i> ДЕНЬ РОЖДЕНИЯ <i>✦</i> ПЕННАЯ ВЕЧЕРИНКА <i>✦</i> КЕМЕРОВО';
  const conditions = '40 минут игры <i>·</i> от 2 000 ₽ <i>·</i> дом / сад / школа <i>·</i> Кемерово';
  const homeTicker = `<div class="ticker" aria-label="Направления"><div class="ticker__track"><div class="ticker__group">${formats}</div><div class="ticker__group" aria-hidden="true">${formats}</div></div></div>`;
  const homePulse = `<div class="home-pulse" aria-label="Условия"><div class="home-pulse__track"><div class="home-pulse__group">${conditions}</div><div class="home-pulse__group" aria-hidden="true">${conditions}</div></div></div>`;
  const homeMosaic = `<section class="photo-story"><div class="photo-story__intro"><span class="mono-tag">НЕ ПОСТАНОВКА · ЖИВЫЕ ЭМОЦИИ</span><h2>Дети не позируют.<br>Они живут внутри истории.</h2><p>Живые реакции, детали реквизита и герои в действии.</p></div><div class="photo-story__mosaic"><figure class="story-shot story-shot--wide"><div class="image-slot">${image(photoFromContent(content, 'photo5'), 'managed-photo')}</div><figcaption><b>01</b> Момент, когда весь зал играет вместе</figcaption></figure><figure class="story-shot story-shot--portrait"><div class="image-slot">${image(photoFromContent(content, 'photo6'), 'managed-photo')}</div></figure><figure class="story-shot story-shot--detail"><div class="image-slot">${image(photoFromContent(content, 'photo7'), 'managed-photo')}</div><figcaption><b>03</b> Маленькие вещи делают мир убедительным</figcaption></figure></div></section>`;
  const body = [
    heroBlock({ tag:'Детские праздники · Кемерово', lines:['ПРАЗДНИК', '— ЭТО', 'ГЛАГОЛ'], intro:content.heroIntro || 'Аниматоры, шоу и спектакли — на вашей площадке в Кемерово.', photo:photoFromContent(content, 'photo1'), service:'Праздник в Кемерово', pageClass:'hero--home' }),
    homeTicker,
    `<section class="services"><div class="section-heading"><span class="mono-tag">Выберите формат праздника</span><h2>И начнём<br>игру</h2></div><div class="service-grid service-grid--home">${directionCards}</div></section>`,
    homePulse,
    homeMosaic,
    `<section class="events events--home"><div class="events__head"><h2>Афиша впечатлений</h2><a class="events__all" href="/afisha/">Вся афиша <b>↗</b></a></div>${eventCards(events.slice(0, 3))}</section>`,
    partyForm()
  ].join('');
  return layout(pageMeta({ path:'/', title:content.heroTitle ? `${content.heroTitle} | ТЕМА` : undefined, description:content.heroIntro }), body, 'page--home');
};

const heroCard = (hero, index) => `<article class="hero-program-card hero-program-card--${escapeAttr(hero.accent || 'yellow')}" data-hero-audience="${escapeAttr(hero.audience || 'all')}"><div class="hero-program-card__media">${image(hero)}<span class="hero-program-card__number">0${index + 1}</span></div><div class="hero-program-card__summary"><span class="mono-tag">${hero.audience === 'girls' ? 'Для девочек' : hero.audience === 'boys' ? 'Для мальчиков' : 'Для всех'}</span><h3>${escapeHtml(hero.name)}</h3><div class="hero-program-card__facts"><span><small>Время</small>${escapeHtml(hero.duration || 40)} минут</span><span><small>Стоимость</small><b>от ${formatPrice(hero.price)}</b></span></div></div><div class="hero-program-card__details"><p>${escapeHtml(hero.description)}</p><a class="hero-program-card__seo-link" href="/animatory/${escapeAttr(hero.slug)}/">Подробнее о герое</a></div><div class="hero-program-card__action"><button class="hero-program-card__cta" data-open-form data-service="Аниматор ${escapeAttr(hero.name)}" data-order-message="Хочу заказать аниматора ${escapeAttr(hero.name)}.">ЗАКАЗАТЬ <b>↗</b></button></div></article>`;

const renderAnimators = async () => {
  const content = await loadContent(); const heroes = (await loadCatalog('heroes')).filter(visible);
  const heroCopy = pageHeroCopy(content, 'animatory');
  const body = `${heroBlock({ tag:'Аниматоры на праздник · Кемерово', lines:heroCopy.lines, intro:heroCopy.intro, photo:photoFromContent(content,'animatoryPhoto1'), mascot:'/assets/mascot-peek-animator.png', service:'Подбор аниматора', pageClass:'afisha-hero' })}<section class="hero-catalog" id="hero-catalog"><div class="hero-catalog__heading"><span class="mono-tag">Выберите своего героя</span><h2>Суперсила<br>на праздник</h2><div class="hero-filter" role="group" aria-label="Фильтр героев"><button class="hero-filter__button is-active" type="button" data-hero-filter="all" aria-pressed="true">Все герои</button><button class="hero-filter__button" type="button" data-hero-filter="boys" aria-pressed="false">Для мальчиков</button><button class="hero-filter__button" type="button" data-hero-filter="girls" aria-pressed="false">Для девочек</button></div></div><div class="hero-program-grid">${heroes.map(heroCard).join('')}</div><p class="hero-filter__empty" data-hero-empty hidden>В этой категории герои скоро появятся.</p></section>${partyForm()}`;
  return layout(pageMeta({ title:'Аниматоры на детский праздник в Кемерово | ТЕМА', description:'Заказать аниматора на детский день рождения в Кемерово: супергерои, игровая программа, выезд на дом, в сад или школу.', path:'/animatory/' }), body, 'page--animatory');
};

const showCard = (show, index) => `<article class="show-offer-card show-offer-card--${escapeAttr(show.accent || 'yellow')}"><div class="show-offer-card__media">${image(show)}<span class="show-offer-card__number">0${index + 1}</span></div><div class="show-offer-card__summary"><span class="mono-tag">Интерактивная программа</span><h3>${escapeHtml(show.name)}</h3><p class="show-offer-card__price"><span>Стоимость</span><strong>от ${formatPrice(show.price)}</strong></p></div><div class="show-offer-card__details"><p>${escapeHtml(show.description)}</p><a class="show-offer-card__seo-link" href="/show/${escapeAttr(show.slug)}/">Подробнее о шоу</a></div><div class="show-offer-card__action"><button class="show-offer-card__cta" data-open-form data-service="${escapeAttr(show.name)}" data-order-message="Хочу заказать: ${escapeAttr(show.name)}.">ЗАКАЗАТЬ ШОУ <b>↗</b></button></div></article>`;

const renderShow = async () => {
  const content = await loadContent(); const shows = (await loadCatalog('shows')).filter(visible);
  const heroCopy = pageHeroCopy(content, 'show');
  const body = `${heroBlock({ tag:'Шоу в Кемерово', lines:heroCopy.lines, intro:heroCopy.intro, photo:photoFromContent(content,'showPhoto1'), mascot:'/assets/mascot-peek-show.png', service:'Подбор шоу', pageClass:'afisha-hero' })}<section class="show-catalog" id="show-catalog"><div class="show-offer-grid-wrap"><button class="show-catalog__mascot-cta" type="button" data-open-form data-service="Подбор шоу"><img src="/assets/mascot-game.png" alt="" aria-hidden="true"><span><small>Нужна подсказка?</small><strong>Подберём шоу ↗</strong></span></button><div class="show-offer-grid">${shows.map(showCard).join('')}</div></div></section>${partyForm()}`;
  return layout(pageMeta({ title:'Шоу на праздник в Кемерово — заказать | ТЕМА', description:'Интерактивные и научные шоу на праздник в Кемерово: азотное шоу, неоновая дискотека, пенная вечеринка и другие программы.', path:'/show/' }), body, 'page--show');
};

const playCard = play => `<article class="playbill-card playbill-card--${escapeAttr(play.accent || 'violet')}"><div class="playbill-card__photo">${image(play)}</div><span class="mono-tag">Интерактивный спектакль · ${escapeHtml(play.age || '3+') }</span><h3>${escapeHtml(play.name)}</h3><p>${escapeHtml(play.description)}</p>${Number(play.price) > 0 ? `<p><strong>от ${formatPrice(play.price)}</strong></p>` : ''}<div class="playbill-card__action"><button class="playbill-card__cta" data-open-form data-service="Спектакль: ${escapeAttr(play.name)}" data-order-message="Хочу заказать спектакль «${escapeAttr(play.name)}».">ЗАКАЗАТЬ СПЕКТАКЛЬ <b>↗</b></button></div></article>`;

const stagePlayCard = play => `<article class="theater-stage-card theater-stage-card--${escapeAttr(play.accent || 'violet')}"><div class="theater-stage-card__media">${image(play)}</div><div class="theater-stage-card__copy"><span class="mono-tag">Интерактивный спектакль · ${escapeHtml(play.age || '3+') }</span><h2>${escapeHtml(play.name)}</h2><p>${escapeHtml(play.description)}</p>${Number(play.price) > 0 ? `<strong class="theater-stage-card__price">от ${formatPrice(play.price)}</strong>` : ''}<button class="theater-stage-card__cta" data-open-form data-service="Спектакль: ${escapeAttr(play.name)}" data-order-message="Хочу заказать спектакль «${escapeAttr(play.name)}».">ЗАКАЗАТЬ СПЕКТАКЛЬ <b>↗</b></button></div></article>`;

const renderPlays = async () => {
  const content = await loadContent(); const plays = (await loadCatalog('plays')).filter(visible);
  const heroCopy = pageHeroCopy(content, 'theater');
  const theaterStage = `<section class="theater-stage" aria-label="Театр приезжает к вам"><i class="theater-stage__curtain theater-stage__curtain--left"></i><i class="theater-stage__curtain theater-stage__curtain--right"></i><img src="/assets/mascot-theater.png" alt="" aria-hidden="true"><div class="theater-stage__program">${plays.length ? plays.map(stagePlayCard).join('') : '<p class="empty-state">Скоро здесь появится спектакль.</p>'}</div></section>`;
  const body = [
    heroBlock({ tag:'Выездной театр · Кемерово', lines:heroCopy.lines, intro:heroCopy.intro, photo:photoFromContent(content,'theaterPhoto1'), mascot:'/assets/mascot-peek-theater.png', service:'Спектакль', pageClass:'afisha-hero' }),
    theaterStage,
    partyForm()
  ].join('');
  return layout(pageMeta({ title:'Выездные спектакли для детей в Кемерово | ТЕМА', description:'Интерактивный спектакль на детский праздник, в школу или детский сад в Кемерово. Герои приезжают на вашу площадку.', path:'/spektakli/' }), body, 'page--theater');
};

const renderBirthdayLegacy = async () => {
  const content = await loadContent();
  const body = `${heroBlock({ tag:'Детский день рождения · Кемерово', lines:['ДЕНЬ.', 'КОТОРЫЙ.', 'ПОМНЯТ.'], intro:'Подберём героя, шоу или спектакль для дня рождения. Учитываем возраст ребёнка, гостей и вашу площадку.', photo:photoFromContent(content,'photoBirthday'), mascot:'/assets/mascot-peek-birthday.png', service:'Детский день рождения', pageClass:'afisha-hero' })}<section class="services"><div class="section-heading"><span class="mono-tag">Формат праздника</span><h2>Выберите<br>настроение</h2></div><div class="service-grid">${directionCard({ href:'/animatory/#hero-catalog',title:'Аниматор',age:'0+',people:'от 1 до 15',variant:'yellow',photo:photoFromContent(content,'animatoryPhoto1') })}${directionCard({ href:'/show/#show-catalog',title:'Шоу',age:'3+',people:'от 2 до 50',variant:'pink',photo:photoFromContent(content,'showPhoto1') })}${directionCard({ href:'/spektakli/',title:'Спектакль',age:'3+',people:'от 30 до 150',variant:'cream',photo:photoFromContent(content,'theaterPhoto1') })}</div></section>${partyForm()}`;
  return layout(pageMeta({ title:'Детский день рождения в Кемерово | ТЕМА', description:'Организация детского дня рождения в Кемерово: аниматоры, шоу и спектакли на дом, в сад или на площадку.', path:'/detskiy-den-rozhdeniya/' }), body, 'page--birthday');
};

const renderBirthday = async () => {
  const content = await loadContent();
  const heroCopy = pageHeroCopy(content, 'birthday');
  const serviceCards = [
    directionCard({ href:'/animatory/#hero-catalog', title:'Аниматор', age:'0+', people:'от 1 до 15', variant:'yellow', photo:photoFromContent(content,'animatoryPhoto1') }),
    directionCard({ href:'/show/#show-catalog', title:'Шоу', age:'3+', people:'от 2 до 50', variant:'pink', photo:photoFromContent(content,'showPhoto1') }),
    directionCard({ href:'/spektakli/', title:'Спектакль', age:'3+', people:'от 30 до 150', variant:'cream', photo:photoFromContent(content,'theaterPhoto1') })
  ].join('');
  const body = `${heroBlock({ tag:'Детский день рождения · Кемерово', lines:heroCopy.lines, intro:heroCopy.intro, photo:photoFromContent(content,'photoBirthday'), mascot:'/assets/mascot-peek-birthday.png', service:'Детский день рождения', pageClass:'afisha-hero' })}<section class="services"><div class="section-heading"><span class="mono-tag">Формат праздника</span><h2>Выберите<br>настроение</h2></div><div class="service-grid">${serviceCards}</div></section>${partyForm()}`;
  return layout(pageMeta({ title:'Детский день рождения в Кемерово | ТЕМА', description:'Организация детского дня рождения в Кемерово: аниматоры, шоу и спектакли на дом, в сад или на площадку.', path:'/detskiy-den-rozhdeniya/' }), body, 'page--birthday');
};

const renderHomeAnimator = async () => {
  const content = await loadContent();
  const body = `${heroBlock({ tag:'Аниматор на дом · Кемерово', lines:['ГЕРОЙ', 'УЖЕ', 'В ПУТИ.'], intro:'Позовите аниматора домой, в кафе, сад или школу — и обычный день превратится в приключение.', photo:photoFromContent(content,'animatoryPhoto3'), mascot:'/assets/mascot-peek-animator.png', service:'Аниматор на дом', pageClass:'afisha-hero' })}<section class="landing-intro"><span class="mono-tag">Где провести</span><h2>Мы приедем<br>туда, где<br>удобно вам</h2><p>Привезём реквизит, программу и настроение. Вам остаётся собрать гостей и ждать героя.</p></section>${partyForm()}`;
  return layout(pageMeta({ title:'Аниматор на дом в Кемерово | ТЕМА', description:'Заказать аниматора на дом в Кемерово: игровая программа, реквизит и любимый герой ребёнка.', path:'/animatory-na-dom/' }), body, 'page--animatory');
};

const renderAfisha = async () => {
  const events = (await loadCatalog('events')).filter(visible);
  const body = `<section class="afisha-page-intro"><span class="mono-tag">События и программы · Кемерово</span><h1>Афиша<br>детских событий</h1><p>Выбирайте дату, открывайте афишу и оставляйте заявку — расскажем всё про программу и площадку.</p><a class="outline-button" href="#afisha-catalog">Смотреть события <span>↓</span></a></section><section class="afisha-catalog" id="afisha-catalog"><div class="section-heading"><span class="mono-tag">Скоро</span><h2>Приходите<br>за эмоциями</h2></div>${events.length ? eventCards(events) : '<p class="empty-state">Афиша обновляется — скоро добавим новые события.</p>'}</section>${reviews()}${partyForm()}`;
  return layout(pageMeta({ title:'Афиша детских событий в Кемерово | ТЕМА', description:'Афиша праздников, спектаклей и детских событий в Кемерово. Билеты, программы и заявки.', path:'/afisha/' }), body, 'page--afisha');
};

const renderServiceDetail = ({ item, type }) => {
  const isHero = type === 'heroes';
  const name = item.name;
  const label = isHero ? `Аниматор ${name}` : name;
  const body = `<section class="event-detail seo-service-detail${isHero ? '' : ' seo-service-page--show'}"><a class="event-detail__back" href="/${isHero ? 'animatory' : 'show'}/">← НАЗАД В КАТАЛОГ</a><div class="event-detail__layout"><div class="event-detail__media">${image(item)}</div><article class="event-detail__copy"><span class="mono-tag">${isHero ? 'Аниматор на праздник' : 'Шоу на праздник'} · Кемерово</span><h1>${escapeHtml(label)}</h1><p class="seo-service-detail__lead">${escapeHtml(item.description)}</p><p>${isHero ? `${escapeHtml(item.duration || 40)} минут игры, яркий реквизит и герой, который вовлечёт детей в приключение.` : 'Программа на вашей площадке: ведущий, реквизит и эффектный финал.'}</p><p><strong>${isHero ? `${escapeHtml(item.duration || 40)} минут · ` : ''}${formatPrice(item.price)}</strong></p><button class="outline-button" data-open-form data-service="${escapeAttr(label)}" data-order-message="Хочу заказать ${escapeAttr(label)}.">ЗАКАЗАТЬ <span>↗</span></button></article></div></section>${partyForm()}`;
  return layout(pageMeta({ title:item.seoTitle || `${label} в Кемерово | ТЕМА`, description:item.seoDescription || item.description, path:`/${isHero ? 'animatory' : 'show'}/${item.slug}/` }), body, isHero ? 'page--animatory' : 'page--show');
};

const renderEventDetail = event => {
  const target = event.buttonUrl || '';
  const body = `<section class="event-detail"><a class="event-detail__back" href="/afisha/">← ВСЯ АФИША</a><div class="event-detail__layout"><div class="event-detail__media ${event.imageFit === 'poster' ? 'event-detail__media--poster' : ''}">${image(event)}</div><article class="event-detail__copy"><span class="mono-tag">${escapeHtml(event.category || 'Событие')} · ${escapeHtml(event.date || '')}</span><h1>${escapeHtml(event.title)}</h1><p>${escapeHtml(event.description || 'Оставьте заявку — расскажем о программе, времени и площадке.')}</p>${target ? `<a class="outline-button" href="${escapeAttr(target)}">${escapeHtml(event.buttonLabel || 'Открыть')} <span>↗</span></a>` : `<button class="outline-button" data-open-form data-service="${escapeAttr(event.title)}" data-order-message="Интересует афиша: ${escapeAttr(event.title)}.">${escapeHtml(event.buttonLabel || 'Оставить заявку')} <span>↗</span></button>`}</article></div></section>${partyForm()}`;
  return layout(pageMeta({ title:`${event.title} | ТЕМА`, description:event.description || `Афиша события «${event.title}» в Кемерово.`, path:`/afisha/${event.slug}/` }), body, 'page--afisha');
};

const adminLayout = (title, body) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ТЕМА</title><link rel="stylesheet" href="/admin.css"></head><body class="admin-page"><header class="admin-header"><a href="/admin/">ТЕМА <span>/ админка</span></a><nav><a href="/" target="_blank" rel="noopener">Открыть сайт ↗</a><form action="/admin/logout" method="post"><button type="submit">Выйти</button></form></nav></header><main class="admin-shell">${body}</main><script src="/admin.js" defer></script></body></html>`;
const adminLogin = error => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход · ТЕМА</title><link rel="stylesheet" href="/admin.css"></head><body class="admin-login"><form class="login-card" method="post" action="/admin/login"><a href="/">ТЕМА</a><h1>Админка</h1><label>Пароль<input name="password" type="password" autofocus required></label>${error ? `<p class="admin-error">${escapeHtml(error)}</p>` : ''}<button type="submit">Войти</button></form></body></html>`;
const adminTabs = active => `<nav class="admin-tabs"><a class="${active === 'content' ? 'is-active' : ''}" href="/admin/">Главная и фото</a><a class="${active === 'heroes' ? 'is-active' : ''}" href="/admin/catalog/heroes">Аниматоры</a><a class="${active === 'birthday' ? 'is-active' : ''}" href="/admin/birthday">День рождения</a><a class="${active === 'shows' ? 'is-active' : ''}" href="/admin/catalog/shows">Шоу</a><a class="${active === 'plays' ? 'is-active' : ''}" href="/admin/catalog/plays">Спектакли</a><a class="${active === 'events' ? 'is-active' : ''}" href="/admin/catalog/events">Афиша</a></nav>`;
const formField = (label, name, value = '', options = {}) => `<label class="admin-field${options.wide ? ' admin-field--wide' : ''}">${escapeHtml(label)}${options.textarea ? `<textarea name="${escapeAttr(name)}" ${options.required ? 'required' : ''}>${escapeHtml(value)}</textarea>` : `<input name="${escapeAttr(name)}" value="${escapeAttr(value)}" ${options.type ? `type="${escapeAttr(options.type)}"` : 'type="text"'} ${options.type === 'range' ? 'min="0" max="200"' : ''} ${options.required ? 'required' : ''} ${options.step ? `step="${escapeAttr(options.step)}"` : ''}>`}</label>`;
const selectField = (label, name, value, values) => `<label class="admin-field">${escapeHtml(label)}<select name="${escapeAttr(name)}">${values.map(([itemValue, itemLabel]) => `<option value="${escapeAttr(itemValue)}" ${itemValue === value ? 'selected' : ''}>${escapeHtml(itemLabel)}</option>`).join('')}</select></label>`;
const visibilityField = value => `<label class="admin-check"><input type="checkbox" name="published" ${value !== false ? 'checked' : ''}> Показывать на сайте</label>`;
const mediaEditor = (key, item, { poster = false } = {}) => `<div class="photo-editor" data-fit-preview="${escapeAttr(key)}"><div class="admin-photo-preview ${poster && item.imageFit === 'poster' ? 'is-poster' : ''}">${item.image ? `<img data-crop-preview="${escapeAttr(key)}" src="${escapeAttr(item.image)}" alt="" style="${cropStyle(item)}">` : '<i>Фото</i>'}</div><label class="upload-field">Загрузить фотографию<input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" data-photo-input="${escapeAttr(key)}"><span>JPG, PNG или WEBP · до 12 МБ</span></label><div class="crop-grid">${formField('Горизонт', 'imagePositionX', number(item.imagePositionX), { type:'range', step:'1' }).replace(`name=\"imagePositionX\"`, `name=\"imagePositionX\" data-crop-x=\"${escapeAttr(key)}\"`)}${formField('Вертикаль', 'imagePositionY', number(item.imagePositionY), { type:'range', step:'1' }).replace(`name=\"imagePositionY\"`, `name=\"imagePositionY\" data-crop-y=\"${escapeAttr(key)}\"`)}${formField('Масштаб', 'imageScale', number(item.imageScale, 100), { type:'range', step:'1' }).replace(`name=\"imageScale\"`, `name=\"imageScale\" data-crop-scale=\"${escapeAttr(key)}\"`)}<output data-scale-output="${escapeAttr(key)}">${number(item.imageScale, 100)}%</output></div>${poster ? selectField('Как показывать афишу', 'imageFit', item.imageFit || 'cover', [['cover','Заполнить карточку (кадрирование)'],['poster','Целая афиша без обрезки']]).replace(`name=\"imageFit\"`, `name=\"imageFit\" data-image-fit=\"${escapeAttr(key)}\"`) : ''}</div>`;

const contentPhotoEditor = (key, title, content) => {
  const item = photoFromContent(content, key);
  return `<fieldset class="admin-photo-block"><legend>${escapeHtml(title)}</legend><div class="photo-editor" data-fit-preview="${escapeAttr(key)}"><div class="admin-photo-preview">${item.image ? `<img data-crop-preview="${escapeAttr(key)}" src="${escapeAttr(item.image)}" alt="" style="${cropStyle(item)}">` : '<i>Фото</i>'}</div><label class="upload-field">Заменить изображение<input type="file" name="${escapeAttr(key)}" accept="image/png,image/jpeg,image/webp,image/gif" data-photo-input="${escapeAttr(key)}"><span>JPG, PNG или WEBP</span></label><div class="crop-grid">${formField('Горизонт', `${key}PositionX`, number(item.imagePositionX), { type:'range', step:'1' }).replace(`name=\"${key}PositionX\"`, `name=\"${key}PositionX\" data-crop-x=\"${escapeAttr(key)}\"`)}${formField('Вертикаль', `${key}PositionY`, number(item.imagePositionY), { type:'range', step:'1' }).replace(`name=\"${key}PositionY\"`, `name=\"${key}PositionY\" data-crop-y=\"${escapeAttr(key)}\"`)}${formField('Масштаб', `${key}Scale`, number(item.imageScale, 100), { type:'range', step:'1' }).replace(`name=\"${key}Scale\"`, `name=\"${key}Scale\" data-crop-scale=\"${escapeAttr(key)}\"`)}<output data-scale-output="${escapeAttr(key)}">${number(item.imageScale, 100)}%</output></div></div></fieldset>`;
};

const pageHeroEditor = (key, label, content) => {
  const heroCopy = pageHeroCopy(content, key);
  return `<article class="admin-copy-card"><span>${escapeHtml(label)}</span>${formField('H1 — каждая строка с новой строки', `${key}HeroTitle`, heroCopy.lines.join('\n'), { textarea:true, wide:true, required:true })}${formField('Описание под H1', `${key}HeroIntro`, heroCopy.intro, { textarea:true, wide:true, required:true })}</article>`;
};

const pageHeroForm = (key, title, content, redirectTo) => {
  const heroCopy = pageHeroCopy(content, key);
  return `<form class="admin-page-copy" method="post" action="/admin/content" enctype="multipart/form-data"><input type="hidden" name="redirectTo" value="${escapeAttr(redirectTo)}"><section class="admin-panel"><div class="admin-panel__top"><div><h2>Главный текст страницы</h2><p class="admin-panel__hint">${escapeHtml(title)}: отредактируйте H1 и описание первого экрана. Каждая новая строка H1 станет новой строкой в дизайне.</p></div></div><div class="admin-grid">${formField('H1 — каждая строка с новой строки', `${key}HeroTitle`, heroCopy.lines.join('\n'), { textarea:true, wide:true, required:true })}${formField('Описание под H1', `${key}HeroIntro`, heroCopy.intro, { textarea:true, wide:true, required:true })}</div><div class="admin-actions"><button type="submit">СОХРАНИТЬ ГЛАВНЫЙ ТЕКСТ</button></div></section></form>`;
};

const renderAdminContent = async () => {
  const content = await loadContent();
  const photoGroups = [
    ['photo1','Главная — большое фото'], ['homeBoyPhoto','Главная, карточка — аниматор для мальчика'], ['homeGirlPhoto','Главная, карточка — аниматор для девочки'], ['homeAdultShowPhoto','Главная, карточка — шоу для взрослых'], ['homeFoamPhoto','Главная, карточка — пенная вечеринка'], ['homeTheaterPhoto','Главная, карточка — спектакли'], ['photo5','Главная — мозаика, широкий кадр'], ['photo6','Главная — мозаика, портрет'], ['photo7','Главная — мозаика, деталь'], ['photoBirthday','День рождения — главное фото'], ['animatoryPhoto1','Аниматоры — главное фото'], ['animatoryPhoto2','Аниматоры — дополнительное фото'], ['animatoryPhoto3','Аниматоры — фото 3'], ['animatoryPhoto4','Аниматоры — фото 4'], ['showPhoto1','Шоу — главное фото'], ['showPhoto2','Шоу — фото 2'], ['showPhoto3','Шоу — фото 3'], ['showPhoto4','Шоу — фото 4'], ['theaterPhoto1','Спектакли — главное фото'], ['theaterPhoto2','Спектакли — фото 2'], ['theaterPhoto3','Спектакли — фото 3'], ['theaterPhoto4','Спектакли — фото 4']
  ];
  return adminLayout('Главная', `<div class="admin-page-head"><div><span>ТЕМА</span><h1>Главная и фотографии</h1><p>Все фотографии и их кадрирование в одном месте.</p></div></div>${adminTabs('content')}<form class="admin-content-form" method="post" action="/admin/content" enctype="multipart/form-data"><section class="admin-panel"><h2>Текст на главной</h2><div class="admin-grid">${formField('H1', 'heroTitle', content.heroTitle, { required:true, wide:true })}${formField('Подзаголовок', 'heroIntro', content.heroIntro, { textarea:true, wide:true })}</div></section><section class="admin-panel"><h2>Фотографии страниц</h2><div class="admin-photo-grid">${photoGroups.map(([key,title]) => contentPhotoEditor(key,title,content)).join('')}</div></section><div class="admin-actions"><button type="submit">СОХРАНИТЬ ИЗМЕНЕНИЯ</button></div></form>`);
};

const renderAdminBirthday = async () => {
  const content = await loadContent();
  return adminLayout('День рождения', `<div class="admin-page-head"><div><span>ТЕМА / СТРАНИЦА</span><h1>День рождения</h1><p>Главный текст и SEO-смысл страницы детского дня рождения.</p></div></div>${adminTabs('birthday')}${pageHeroForm('birthday', 'Детский день рождения', content, '/admin/birthday')}`);
};

const catalogForm = (type, item = {}) => {
  const hero = type === 'heroes'; const show = type === 'shows'; const play = type === 'plays'; const event = type === 'events';
  const label = hero ? 'аниматора' : show ? 'шоу' : play ? 'спектакля' : 'афиши';
  const heading = item.id ? `Редактировать ${label}` : `Добавить ${label}`;
  let basic = formField(hero || show || event ? 'Название' : 'Название спектакля', 'name', item.name || item.title || '', { required:true, wide:true });
  if (!play) basic += formField('SEO-slug / адрес', 'slug', item.slug || '', { wide:true });
  if (event) {
    basic += formField('Дата', 'date', item.date || '', { type:'date' });
    basic += formField('Категория', 'category', item.category || 'Событие');
    basic += formField('Описание', 'description', item.description || '', { textarea:true, wide:true });
    basic += formField('Надпись на кнопке', 'buttonLabel', item.buttonLabel || 'Открыть афишу');
    basic += formField('Ссылка кнопки (необязательно)', 'buttonUrl', item.buttonUrl || '');
  } else {
    basic += formField('Описание', 'description', item.description || '', { textarea:true, wide:true });
    if (hero) {
      basic += formField('Длительность, минут', 'duration', item.duration || 40, { type:'number', step:'1' });
      basic += selectField('Для кого', 'audience', item.audience || 'all', [['all','Для всех'],['boys','Для мальчиков'],['girls','Для девочек']]);
    }
    if (play) {
      basic += formField('Возраст', 'age', item.age || '3+');
      basic += formField('Цена, ₽ (необязательно)', 'price', item.price || '', { type:'number', step:'1' });
    } else {
      basic += formField('Цена, ₽', 'price', item.price || '', { type:'number', step:'1', required:true });
    }
    if (!play) {
      basic += formField('SEO-заголовок', 'seoTitle', item.seoTitle || '', { wide:true });
      basic += formField('SEO-описание', 'seoDescription', item.seoDescription || '', { textarea:true, wide:true });
    }
  }
  return `<section class="admin-panel"><div class="admin-panel__top"><h2>${heading}</h2>${visibilityField(item.published)}</div><input type="hidden" name="id" value="${escapeAttr(item.id || '')}"><div class="admin-grid">${basic}</div>${mediaEditor(`${type}-${item.id || 'new'}`, item, { poster:event })}</section>`;
};

const catalogItemCard = (type, item) => {
  const title = item.name || item.title || 'Без названия';
  const typeName = { heroes:'Аниматор', shows:'Шоу', plays:'Спектакль', events:'Афиша' }[type];
  const meta = [typeName, item.age, type === 'heroes' && item.duration ? `${item.duration} мин` : '', Number(item.price) ? `от ${formatPrice(item.price)}` : ''].filter(Boolean).join(' · ');
  const media = item.image
    ? `<img src="${escapeAttr(item.image)}" alt="" style="${cropStyle(item)}">`
    : '<span>Нет фото</span>';
  return `<details class="admin-catalog-item"><summary><span class="admin-catalog-item__media">${media}</span><span class="admin-catalog-item__copy"><small>${escapeHtml(meta)}</small><strong>${escapeHtml(title)}</strong></span><span class="admin-catalog-item__status ${item.published !== false ? 'is-live' : ''}">${item.published !== false ? 'На сайте' : 'Скрыто'}</span><span class="admin-catalog-item__edit">Изменить <b>↓</b></span></summary><form class="admin-catalog-form" method="post" action="/admin/catalog/${type}/save" enctype="multipart/form-data">${catalogForm(type,item)}<div class="admin-actions"><button type="submit">Сохранить изменения</button><button class="admin-danger" type="submit" formaction="/admin/catalog/${type}/delete" formnovalidate onclick="return confirm('Удалить карточку?')">Удалить</button></div></form></details>`;
};

const renderAdminCatalog = async type => {
  const titles = { heroes:'Аниматоры', shows:'Шоу', plays:'Спектакли', events:'Афиша' };
  const [items, content] = await Promise.all([loadCatalog(type), loadContent()]);
  const pageCopy = { heroes:['animatory', 'Аниматоры на праздник', '/admin/catalog/heroes'], shows:['show', 'Шоу-программы', '/admin/catalog/shows'], plays:['theater', 'Спектакли для детей', '/admin/catalog/plays'] }[type];
  const heroTextEditor = pageCopy ? pageHeroForm(pageCopy[0], pageCopy[1], content, pageCopy[2]) : '';
  return adminLayout(titles[type], `<div class="admin-page-head"><div><span>ТЕМА / КАТАЛОГ</span><h1>${titles[type]}</h1><p>Добавляйте карточки, стоимость, описание, SEO и фотографии. Изменения появляются на сайте сразу после сохранения.</p></div><button data-open-create>+ Добавить</button></div>${adminTabs(type)}${heroTextEditor}<div class="admin-catalog-list">${items.length ? items.map(item => catalogItemCard(type,item)).join('') : '<p class="admin-panel admin-empty">В каталоге пока нет карточек.</p>'}</div><dialog class="create-dialog"><button class="create-dialog__close" type="button" aria-label="Закрыть">×</button><form class="admin-catalog-form" method="post" action="/admin/catalog/${type}/save" enctype="multipart/form-data">${catalogForm(type,{ published:true })}<div class="admin-actions"><button type="submit">Создать карточку</button></div></form></dialog>`);
};

const updateCatalogItem = (type, oldItem, body, uploadedFile) => {
  const name = String(body.name || '').trim();
  const itemsPromise = loadCatalog(type);
  return itemsPromise.then(items => {
    const isNew = !oldItem;
    const source = oldItem || {};
    const base = {
      ...source,
      id: source.id || crypto.randomUUID(),
      published: truthy(body.published),
      image: uploadedFile ? `/uploads/${uploadedFile.filename}` : (source.image || ''),
      imagePositionX: number(body.imagePositionX, source.imagePositionX ?? 50),
      imagePositionY: number(body.imagePositionY, source.imagePositionY ?? 50),
      imageScale: number(body.imageScale, source.imageScale ?? 100),
      updatedAt: now(),
      createdAt: source.createdAt || now()
    };
    if (type === 'events') return {
      ...base,
      title: name,
      slug: uniqueSlug(body.slug || name, items, base.id),
      date: String(body.date || ''), category: String(body.category || 'Событие').trim(),
      description: String(body.description || '').trim(),
      buttonLabel: String(body.buttonLabel || 'Открыть афишу').trim(),
      buttonUrl: String(body.buttonUrl || '').trim(),
      imageFit: body.imageFit === 'poster' ? 'poster' : 'cover',
      accent: source.accent || 'yellow'
    };
    if (type === 'heroes') return {
      ...base, name, slug: uniqueSlug(body.slug || `animator-${name}-kemerovo`, items, base.id),
      description: String(body.description || '').trim(), duration: Math.max(1, Math.round(number(body.duration, 40))), price: Math.max(0, Math.round(number(body.price, 0))),
      audience: ['all','boys','girls'].includes(body.audience) ? body.audience : 'all', accent: body.accent || source.accent || 'yellow',
      seoTitle: String(body.seoTitle || '').trim(), seoDescription: String(body.seoDescription || '').trim()
    };
    if (type === 'shows') return {
      ...base, name, slug: uniqueSlug(body.slug || `${name}-kemerovo`, items, base.id), description: String(body.description || '').trim(),
      price: Math.max(0, Math.round(number(body.price, 0))), accent: body.accent || source.accent || 'cyan', seoTitle: String(body.seoTitle || '').trim(), seoDescription: String(body.seoDescription || '').trim()
    };
    return {
      ...base, name, slug: uniqueSlug(body.slug || name, items, base.id), description: String(body.description || '').trim(),
      age: String(body.age || '3+').trim(), price: Math.max(0, Math.round(number(body.price, source.price || 0))), accent: body.accent || source.accent || 'violet'
    };
  });
};

const trySendTelegram = async lead => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  const apiBase = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
  const text = ['Новая заявка с сайта ТЕМА', `Имя: ${lead.name}`, `Телефон: ${lead.phone}`, `Услуга: ${lead.service || '—'}`, `Сообщение: ${lead.message || '—'}`].join('\n');
  try { await fetch(`${apiBase}/bot${token}/sendMessage`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ chat_id:chat, text }) }); } catch { /* local JSON is the reliable fallback */ }
};

app.get('/health', (_req, res) => res.json({ ok:true }));
app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`));
app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const [heroes, shows, events] = await Promise.all([loadCatalog('heroes'), loadCatalog('shows'), loadCatalog('events')]);
    const paths = ['/', '/animatory/', '/animatory-na-dom/', '/detskiy-den-rozhdeniya/', '/show/', '/spektakli/', '/afisha/', ...heroes.filter(visible).map(item => `/animatory/${item.slug}/`), ...shows.filter(visible).map(item => `/show/${item.slug}/`), ...events.filter(visible).map(item => `/afisha/${item.slug}/`)];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(item => `<url><loc>${escapeHtml(`${siteUrl}${item}`)}</loc></url>`).join('')}</urlset>`);
  } catch (error) { next(error); }
});

app.post('/api/leads', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    const phone = String(req.body.phone || '').trim().slice(0, 60);
    const service = String(req.body.service || '').trim().slice(0, 160);
    const message = String(req.body.message || '').trim().slice(0, 1000);
    if (!name || !phone || !truthy(req.body.consent)) return res.status(400).json({ error:'Укажите имя, телефон и согласие на обработку данных.' });
    const lead = { id:crypto.randomUUID(), createdAt:now(), name, phone, service, message, source:'website' };
    await fs.appendFile(files.leads, `${JSON.stringify(lead)}\n`, 'utf8');
    void trySendTelegram(lead);
    res.status(201).json({ ok:true, message:'Заявка отправлена. Скоро свяжемся с вами!' });
  } catch (error) { next(error); }
});

app.get('/admin/login', (req, res) => isAdmin(req) ? res.redirect('/admin/') : res.send(adminLogin(req.query.error)));
app.post('/admin/login', (req, res) => {
  const attempted = String(req.body.password || '');
  if (attempted !== adminPassword) return res.redirect('/admin/login?error=Неверный+пароль');
  res.setHeader('Set-Cookie', `tema_admin=${sessionValue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
  res.redirect('/admin/');
});
app.post('/admin/logout', (_req, res) => { res.setHeader('Set-Cookie', 'tema_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); res.redirect('/admin/login'); });
app.get('/admin/', requireAdmin, async (_req, res, next) => { try { res.send(await renderAdminContent()); } catch (error) { next(error); } });
app.get('/admin/birthday', requireAdmin, async (_req, res, next) => { try { res.send(await renderAdminBirthday()); } catch (error) { next(error); } });
app.get('/admin/catalog/:type', requireAdmin, async (req, res, next) => {
  if (!['heroes','shows','plays','events'].includes(req.params.type)) return res.status(404).send('Каталог не найден');
  try { res.send(await renderAdminCatalog(req.params.type)); } catch (error) { next(error); }
});
app.post('/admin/content', requireAdmin, upload.any(), async (req, res, next) => {
  try {
    const previous = await loadContent();
    const nextContent = {
      ...previous,
      heroTitle: req.body.heroTitle === undefined ? previous.heroTitle : String(req.body.heroTitle || '').trim(),
      heroIntro: req.body.heroIntro === undefined ? previous.heroIntro : String(req.body.heroIntro || '').trim()
    };
    for (const key of Object.keys(pageHeroDefaults)) {
      const titleField = `${key}HeroTitle`;
      const introField = `${key}HeroIntro`;
      if (req.body[titleField] !== undefined) nextContent[titleField] = String(req.body[titleField] || '').trim();
      if (req.body[introField] !== undefined) nextContent[introField] = String(req.body[introField] || '').trim();
    }
    const inputFiles = new Map((req.files || []).map(file => [file.fieldname, file]));
    for (const key of ['photo1','homeBoyPhoto','homeGirlPhoto','homeAdultShowPhoto','homeFoamPhoto','homeTheaterPhoto','photo5','photo6','photo7','photoBirthday','animatoryPhoto1','animatoryPhoto2','animatoryPhoto3','animatoryPhoto4','showPhoto1','showPhoto2','showPhoto3','showPhoto4','theaterPhoto1','theaterPhoto2','theaterPhoto3','theaterPhoto4']) {
      const file = inputFiles.get(key);
      if (file) nextContent[key] = `/uploads/${file.filename}`;
      nextContent[`${key}PositionX`] = number(req.body[`${key}PositionX`], previous[`${key}PositionX`] ?? 50);
      nextContent[`${key}PositionY`] = number(req.body[`${key}PositionY`], previous[`${key}PositionY`] ?? 50);
      nextContent[`${key}Scale`] = number(req.body[`${key}Scale`], previous[`${key}Scale`] ?? 100);
    }
    await writeJson(files.content, nextContent);
    const redirectTo = ['/admin/', '/admin/birthday', '/admin/catalog/heroes', '/admin/catalog/shows', '/admin/catalog/plays'].includes(req.body.redirectTo) ? req.body.redirectTo : '/admin/';
    res.redirect(redirectTo);
  } catch (error) { next(error); }
});
app.post('/admin/catalog/:type/save', requireAdmin, upload.single('image'), async (req, res, next) => {
  const type = req.params.type;
  if (!['heroes','shows','plays','events'].includes(type)) { await deleteUploaded(req.file); return res.status(404).send('Каталог не найден'); }
  try {
    const items = await loadCatalog(type);
    const current = items.find(item => item.id === req.body.id);
    if (req.body.id && !current) { await deleteUploaded(req.file); return res.status(404).send('Карточка не найдена'); }
    const updated = await updateCatalogItem(type, current, req.body, req.file);
    if (!updated.name && !updated.title) { await deleteUploaded(req.file); return res.status(400).send('Укажите название'); }
    await saveCatalog(type, current ? items.map(item => item.id === current.id ? updated : item) : [...items, updated]);
    res.redirect(`/admin/catalog/${type}`);
  } catch (error) { next(error); }
});
app.post('/admin/catalog/:type/delete', requireAdmin, async (req, res, next) => {
  const type = req.params.type;
  if (!['heroes','shows','plays','events'].includes(type)) return res.status(404).send('Каталог не найден');
  try { const items = await loadCatalog(type); await saveCatalog(type, items.filter(item => item.id !== req.body.id)); res.redirect(`/admin/catalog/${type}`); } catch (error) { next(error); }
});

app.get('/', async (_req, res, next) => { try { res.send(await renderHome()); } catch (error) { next(error); } });
app.get('/animatory/', async (_req, res, next) => { try { res.send(await renderAnimators()); } catch (error) { next(error); } });
app.get('/animatory-na-dom/', async (_req, res, next) => { try { res.send(await renderHomeAnimator()); } catch (error) { next(error); } });
app.get('/detskiy-den-rozhdeniya/', async (_req, res, next) => { try { res.send(await renderBirthday()); } catch (error) { next(error); } });
app.get('/show/', async (_req, res, next) => { try { res.send(await renderShow()); } catch (error) { next(error); } });
app.get('/spektakli/', async (_req, res, next) => { try { res.send(await renderPlays()); } catch (error) { next(error); } });
app.get('/afisha/', async (_req, res, next) => { try { res.send(await renderAfisha()); } catch (error) { next(error); } });
app.get('/animatory/:slug/', async (req, res, next) => { try { const item = (await loadCatalog('heroes')).find(hero => hero.slug === req.params.slug && visible(hero)); if (!item) return res.status(404).send('Программа не найдена'); res.send(renderServiceDetail({ item, type:'heroes' })); } catch (error) { next(error); } });
app.get('/show/:slug/', async (req, res, next) => { try { const item = (await loadCatalog('shows')).find(show => show.slug === req.params.slug && visible(show)); if (!item) return res.status(404).send('Шоу не найдено'); res.send(renderServiceDetail({ item, type:'shows' })); } catch (error) { next(error); } });
app.get('/afisha/:slug/', async (req, res, next) => { try { const item = (await loadCatalog('events')).find(event => event.slug === req.params.slug && visible(event)); if (!item) return res.status(404).send('Афиша не найдена'); res.send(renderEventDetail(item)); } catch (error) { next(error); } });

app.use((req, res) => res.status(404).send(layout(pageMeta({ title:'Страница не найдена', path:req.path }), '<section class="event-detail"><h1>404</h1><p>Эта страница не найдена.</p><a class="outline-button" href="/">НА ГЛАВНУЮ</a></section>')));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).send('Ошибка сервера. Попробуйте обновить страницу.'); });

app.listen(port, () => console.log(`ТЕМА запущена: http://localhost:${port}`));
