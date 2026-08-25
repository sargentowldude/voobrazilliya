import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const siteUrl = (process.env.SITE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const adminUsername = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'tema-admin';
const cookieSecret = process.env.ADMIN_COOKIE_SECRET || 'local-tema-secret';
const personalDataEmail = String(process.env.PERSONAL_DATA_EMAIL || '').trim();
const personalDataPostalAddress = String(process.env.PERSONAL_DATA_POSTAL_ADDRESS || '').trim();
const smtpHost = String(process.env.SMTP_HOST || '').trim();
const smtpPortValue = Number(process.env.SMTP_PORT || 465);
const smtpPort = Number.isInteger(smtpPortValue) && smtpPortValue > 0 && smtpPortValue <= 65535 ? smtpPortValue : 465;
const smtpSecure = String(process.env.SMTP_SECURE || 'true').trim().toLowerCase() !== 'false';
const smtpUser = String(process.env.SMTP_USER || '').trim();
const smtpPassword = String(process.env.SMTP_PASSWORD || '');
const smtpFrom = String(process.env.SMTP_FROM || smtpUser).trim();
const smtpTo = String(process.env.SMTP_TO || '').trim();
const yandexMetrikaId = /^\d+$/.test(String(process.env.YANDEX_METRIKA_ID || '').trim())
  ? String(process.env.YANDEX_METRIKA_ID).trim()
  : '';
const trustProxy = String(process.env.TRUST_PROXY || '').trim() === '1';
const loginLimit = { maxAttempts:5, windowMs:15 * 60 * 1000 };
const leadLimit = { maxAttempts:5, windowMs:60 * 60 * 1000 };
const leadRetentionDays = 90;
const leadRetentionMs = leadRetentionDays * 24 * 60 * 60 * 1000;
const privacyPolicyVersion = '22.08.2026, редакция 2';
const personalDataConsentVersion = privacyPolicyVersion;
const analyticsConsentVersion = privacyPolicyVersion;
const brandName = 'ВообразилЛиЯ';
const brandText = value => String(value ?? '').replaceAll('ТЕМА', brandName);

const dataDir = path.join(__dirname, 'data');
const publicDir = path.join(__dirname, 'public');
const fontsDir = path.join(__dirname, 'fonts');
const logoDir = path.join(__dirname, 'logo');
const uploadsDir = path.join(publicDir, 'uploads');
const files = {
  content: path.join(dataDir, 'content.json'),
  events: path.join(dataDir, 'events.json'),
  heroes: path.join(dataDir, 'heroes.json'),
  shows: path.join(dataDir, 'shows.json'),
  plays: path.join(dataDir, 'plays.json'),
  leads: path.join(dataDir, 'leads.jsonl'),
  leadDeletionLog: path.join(dataDir, 'leads-deletion-log.jsonl')
};

await fs.mkdir(uploadsDir, { recursive: true });
app.disable('x-powered-by');
if (trustProxy) app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '1mb' }));
const legacyHtmlRedirects = {
  '/index.html': '/',
  '/animatory/index.html': '/animatory/',
  '/show/index.html': '/show/',
  '/spektakli/index.html': '/spektakli/'
};
app.get(Object.keys(legacyHtmlRedirects), (req, res) => res.redirect(301, legacyHtmlRedirects[req.path]));
app.use(express.static(publicDir, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.use('/fonts', express.static(fontsDir, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '30d' : 0 }));
app.use('/logo', express.static(logoDir, { index: false, maxAge: process.env.NODE_ENV === 'production' ? '30d' : 0 }));

const storage = multer.diskStorage({
  destination: (_req, _file, done) => done(null, uploadsDir),
  filename: (_req, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase() || '.jpg';
    done(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});
const isImageMime = value => /^image\/(jpeg|png|webp|gif)$/i.test(value || '');
const isVideoMime = value => /^video\/(mp4|quicktime|webm)$/i.test(value || '');
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, done) => {
    const accepted = isImageMime(file.mimetype)
      || (file.fieldname === 'galleryMedia' && isVideoMime(file.mimetype));
    done(null, accepted);
  }
});

const readJson = async (file, fallback) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
};
const writeJson = async (file, value) => {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
};
const writeTextAtomically = async (file, value) => {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, value, 'utf8');
  await fs.rename(temporary, file);
};
const loadContent = () => readJson(files.content, {});
const loadCatalog = type => readJson(files[type], []);
const saveCatalog = (type, items) => writeJson(files[type], items);
const now = () => new Date().toISOString();
const retentionEndsAt = createdAt => {
  const createdAtTimestamp = Date.parse(createdAt);
  return Number.isFinite(createdAtTimestamp) ? new Date(createdAtTimestamp + leadRetentionMs).toISOString() : '';
};
let leadStoreOperation = Promise.resolve();
const queueLeadStoreOperation = task => {
  const operation = leadStoreOperation.then(task, task);
  leadStoreOperation = operation.catch(() => {});
  return operation;
};
const appendLead = lead => queueLeadStoreOperation(() => fs.appendFile(files.leads, `${JSON.stringify(lead)}\n`, 'utf8'));
const purgeExpiredLeads = () => queueLeadStoreOperation(async () => {
  const source = await fs.readFile(files.leads, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error));
  if (!source) return 0;
  const currentTime = Date.now();
  const retained = [];
  const deleted = [];
  source.split(/\r?\n/).filter(Boolean).forEach(line => {
    try {
      const lead = JSON.parse(line);
      const expiresAt = String(lead.retentionUntil || retentionEndsAt(lead.createdAt));
      if (Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= currentTime) {
        deleted.push({ id:lead.id || null, createdAt:lead.createdAt || null, expiresAt, deletedAt:now(), reason:'retention-90-days' });
      } else {
        retained.push(line);
      }
    } catch {
      retained.push(line);
    }
  });
  if (!deleted.length) return 0;
  await writeTextAtomically(files.leads, retained.length ? `${retained.join('\n')}\n` : '');
  await fs.appendFile(files.leadDeletionLog, `${deleted.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  return deleted.length;
});
await purgeExpiredLeads();
setInterval(() => { void purgeExpiredLeads().catch(error => console.error('Не удалось очистить устаревшие заявки:', error.message)); }, 6 * 60 * 60 * 1000).unref();
const truthy = value => value === true || value === 'true' || value === 'on' || value === '1';
const number = (value, fallback = 50) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(200, parsed)) : fallback;
};
const priceNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(10_000_000, Math.round(parsed))) : fallback;
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
const heroPrices = hero => {
  const fallback = priceNumber(hero?.price, 0);
  return {
    weekday: priceNumber(hero?.priceWeekday, fallback),
    weekend: priceNumber(hero?.priceWeekend, fallback)
  };
};
const heroCartSettings = content => ({
  enabled: content.heroCartUpsellEnabled !== false,
  secondHeroPrice: priceNumber(content.heroCartSecondHeroPrice, 1800),
  promoTitle: String(content.heroCartPromoTitle || 'Добавьте второго героя со скидкой').trim(),
  promoDescription: String(content.heroCartPromoDescription || 'Ещё один персонаж сделает праздник ещё ярче.').trim()
});

const showAnimatorSettings = (show, heroes) => {
  const heroById = new Map(heroes.filter(visible).map(hero => [hero.id, hero]));
  const offers = (Array.isArray(show.heroOffers) ? show.heroOffers : [])
    .map((entry, index) => {
      const hero = heroById.get(String(entry?.heroId || ''));
      if (!hero) return null;
      const prices = heroPrices(hero);
      return {
        id: hero.id,
        name: hero.name,
        image: hero.image || '',
        imagePositionX: number(hero.imagePositionX, 50),
        imagePositionY: number(hero.imagePositionY, 50),
        imageScale: number(hero.imageScale, 100),
        label: String(entry.label || '').trim(),
        weekdayPrice: priceNumber(entry.weekdayPrice, prices.weekday),
        weekendPrice: priceNumber(entry.weekendPrice, prices.weekend),
        position: Math.max(1, Math.round(number(entry.position, index + 1)))
      };
    })
    .filter(Boolean)
    .sort((first, second) => first.position - second.position || first.name.localeCompare(second.name, 'ru'));
  return {
    enabled: show.heroUpsellEnabled === true && offers.length > 0,
    title: String(show.heroOfferTitle || 'Добавьте любимого героя').trim(),
    description: String(show.heroOfferDescription || 'Аниматор встретит гостей и сделает праздник ещё насыщеннее.').trim(),
    offers
  };
};
const minimumPriceLabel = items => {
  const prices = items.map(item => Number(item.price)).filter(price => Number.isFinite(price) && price > 0);
  return prices.length ? `от ${formatPrice(Math.min(...prices))}` : 'По запросу';
};
const formatEventDate = value => {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value || '') : new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long' }).format(date);
};
const cropStyle = item => `object-position:${number(item.imagePositionX)}% ${number(item.imagePositionY)}%;transform-origin:${number(item.imagePositionX)}% ${number(item.imagePositionY)}%;transform:scale(${number(item.imageScale, 100) / 100});`;
const galleryCropStyle = item => `object-position:${number(item.imagePositionX, 50)}% ${number(item.imagePositionY, 50)}%;transform-origin:${number(item.imagePositionX, 50)}% ${number(item.imagePositionY, 50)}%;transform:scale(${number(item.imageScale, 100) / 100});`;
const image = (item, className = '') => item?.image
  ? `<img class="${className}" src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name || item.title || '')}" style="${cropStyle(item)}">`
  : '<span class="hero-program-card__placeholder">ФОТО ПОЯВИТСЯ ЗДЕСЬ</span>';
const programMediaGallery = item => {
  const media = Array.isArray(item?.gallery) ? item.gallery.filter(entry => entry?.src) : [];
  if (!media.length) return '';
  const hasVideo = media.some(entry => entry.type === 'video');
  const title = String(item.galleryTitle || 'Материалы программы').trim();
  const entries = media.map(entry => {
    const alt = String(entry.alt || entry.label || '').trim();
    const label = entry.label ? `<figcaption>${escapeHtml(entry.label)}</figcaption>` : '';
    const openLabel = escapeAttr(`Открыть: ${alt || 'материал программы'}`);
    if (entry.type === 'video') {
      const previewPoster = entry.poster || item?.image || '';
      const poster = previewPoster ? ` poster="${escapeAttr(previewPoster)}"` : '';
      const posterData = previewPoster ? ` data-media-poster="${escapeAttr(previewPoster)}"` : '';
      return `<figure class="program-media-gallery__item program-media-gallery__item--video"><button class="program-media-gallery__open" type="button" data-open-media data-media-type="video" data-media-src="${escapeAttr(entry.src)}"${posterData} data-media-alt="${escapeAttr(alt)}" aria-label="${openLabel}"><video muted playsinline preload="none"${poster} aria-hidden="true" style="${galleryCropStyle(entry)}"><source src="${escapeAttr(entry.src)}" type="${escapeAttr(entry.mime || 'video/mp4')}"></video></button>${label}</figure>`;
    }
    return `<figure class="program-media-gallery__item"><button class="program-media-gallery__open" type="button" data-open-media data-media-type="image" data-media-src="${escapeAttr(entry.src)}" data-media-alt="${escapeAttr(alt)}" aria-label="${openLabel}"><img src="${escapeAttr(entry.src)}" alt="" loading="lazy" style="${galleryCropStyle(entry)}"></button>${label}</figure>`;
  }).join('');
  return `<section class="program-media-gallery${hasVideo ? ' program-media-gallery--has-video' : ''}" aria-label="${escapeAttr(title)}"><span class="program-media-gallery__title">${escapeHtml(title)}</span><div class="program-media-gallery__grid">${entries}</div></section>`;
};
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
const secureMatch = (actual, expected) => {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};
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
const convertUploadedImageToWebp = async file => {
  if (!isImageMime(file?.mimetype)) return file;
  const sourceExtension = path.extname(file.filename).toLowerCase();
  const filename = sourceExtension === '.webp'
    ? `${path.parse(file.filename).name}-${crypto.randomUUID()}.webp`
    : `${path.parse(file.filename).name}.webp`;
  const outputPath = path.join(uploadsDir, filename);
  try {
    await sharp(file.path, { animated:file.mimetype === 'image/gif', limitInputPixels:40_000_000 })
      .rotate()
      .webp({ quality:82, effort:5, smartSubsample:true })
      .toFile(outputPath);
    await fs.unlink(file.path);
    const { size } = await fs.stat(outputPath);
    Object.assign(file, { filename, mimetype:'image/webp', path:outputPath, size });
    return file;
  } catch (error) {
    await fs.unlink(outputPath).catch(() => {});
    throw error;
  }
};
const convertUploadedImagesToWebp = files => Promise.all(files.map(convertUploadedImageToWebp));
const rateLimitAttempts = new Map();
const clientAddress = req => String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 200);
const pruneRateLimitAttempts = () => {
  const cutoff = Date.now() - Math.max(loginLimit.windowMs, leadLimit.windowMs);
  rateLimitAttempts.forEach((attempts, key) => {
    const activeAttempts = attempts.filter(timestamp => timestamp > cutoff);
    if (activeAttempts.length) rateLimitAttempts.set(key, activeAttempts);
    else rateLimitAttempts.delete(key);
  });
};
setInterval(pruneRateLimitAttempts, 15 * 60 * 1000).unref();
const retryAfter = (bucketName, req, limit) => {
  const key = `${bucketName}:${clientAddress(req)}`;
  const currentTime = Date.now();
  const previous = rateLimitAttempts.get(key) || [];
  const attempts = previous.filter(timestamp => timestamp > currentTime - limit.windowMs);
  rateLimitAttempts.set(key, attempts);
  if (attempts.length < limit.maxAttempts) return 0;
  return Math.max(1, Math.ceil((attempts[0] + limit.windowMs - currentTime) / 1000));
};
const recordRateLimitAttempt = (bucketName, req, limit) => {
  const key = `${bucketName}:${clientAddress(req)}`;
  const currentTime = Date.now();
  const previous = rateLimitAttempts.get(key) || [];
  const attempts = previous.filter(timestamp => timestamp > currentTime - limit.windowMs);
  attempts.push(currentTime);
  rateLimitAttempts.set(key, attempts);
};
const clearRateLimitAttempts = (bucketName, req) => rateLimitAttempts.delete(`${bucketName}:${clientAddress(req)}`);

const pageMeta = ({ title, description, path = '/' }) => ({
  title: brandText(title || `${brandName} — детские праздники в Кемерово`),
  description: description || 'Аниматоры, шоу и спектакли для детских праздников в Кемерово.',
  canonical: `${siteUrl}${path}`
});

const phoneIcon = `<svg class="header-phone__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.1 3.9 8.6 3c.7-.3 1.5.1 1.7.8l1.2 4.4c.2.7-.2 1.4-.8 1.7l-1.8.8a14 14 0 0 0 4.5 4.5l.8-1.8c.3-.6 1-.9 1.7-.8l4.4 1.2c.7.2 1.1 1 .8 1.7l-.9 2.5c-.3.8-1.1 1.3-2 1.2C10.7 18.6 5.4 13.3 4.9 5.9c-.1-.9.4-1.7 1.2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.8 4.4c2.5.4 4.4 2.3 4.8 4.8M14.5 8.1c.8.2 1.4.8 1.6 1.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const nav = () => `<header class="site-header"><a class="wordmark" href="/" aria-label="${brandName}"><img src="/brand-logo.svg" alt=""></a><div class="header-contacts" aria-label="Связаться с нами"><a class="header-contact header-phone" href="tel:+79130789922" aria-label="Позвонить: 8 913 078-99-22">${phoneIcon}<span class="header-phone__number">8 (913) 078-99-22</span></a><a class="header-contact header-messenger" href="https://max.ru/u/f9LHodD0cOIRJLSa7d4VRvn920ZcfXNmLCtdobjJSwP_htHZYKv_rKIpH2s" target="_blank" rel="noopener noreferrer" aria-label="Написать в MAX"><img class="header-messenger__icon" src="/assets/contact/max.svg" alt=""><span class="header-contact__qr" aria-hidden="true"><img src="/assets/contact/max-qr.png" alt=""><b>MAX</b><small>Сканируйте, чтобы написать</small></span></a><a class="header-contact header-messenger" href="https://t.me/Penna_Dvizh" target="_blank" rel="noopener noreferrer" aria-label="Написать в Telegram @Penna_Dvizh"><img class="header-messenger__icon" src="/assets/contact/telegram.svg" alt=""><span class="header-contact__qr" aria-hidden="true"><img src="/assets/contact/telegram-qr.png" alt=""><b>Telegram</b><small>@Penna_Dvizh</small></span></a></div><button class="menu-button" type="button" aria-expanded="false">МЕНЮ +</button><nav class="site-menu" aria-label="Основная навигация"><a href="/animatory/">Аниматоры</a><a href="/detskiy-den-rozhdeniya/">День рождения</a><a href="/show/">Шоу</a><a href="/spektakli/">Спектакли</a><a href="/afisha/">Афиша</a></nav></header>`;

const personalDataContacts = () => `<dl class="legal-contacts"><dt>Электронная почта</dt><dd>${personalDataEmail ? `<a href="mailto:${escapeAttr(personalDataEmail)}">${escapeHtml(personalDataEmail)}</a>` : '<span class="legal-placeholder">укажите в переменной PERSONAL_DATA_EMAIL</span>'}</dd><dt>Почтовый адрес для обращений</dt><dd>${personalDataPostalAddress ? escapeHtml(personalDataPostalAddress) : '<span class="legal-placeholder">укажите в переменной PERSONAL_DATA_POSTAL_ADDRESS</span>'}</dd></dl>`;
const consentField = () => `<label class="consent"><input required name="consent" type="checkbox"><span>Я даю <a href="/consent/" target="_blank" rel="noopener">согласие на обработку персональных данных</a> и ознакомлен(а) с <a href="/privacy/" target="_blank" rel="noopener">Политикой</a>.</span></label>`;
const honeypotField = () => '<input class="form-honeypot" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">';
const footer = () => `<footer class="site-footer"><span>© ${new Date().getFullYear()} ${brandName}</span><nav aria-label="Правовая информация"><a href="/privacy/">Политика конфиденциальности</a><a href="/consent/">Согласие на обработку данных</a><button class="cookie-settings" type="button" data-cookie-settings>Настроить cookies</button></nav></footer>`;

const leadDialog = () => `<dialog class="lead-dialog"><button type="button" class="dialog-close" aria-label="Закрыть">×</button><span class="mono-tag">Заявка</span><h2>Давайте<br>устроим<br>праздник</h2><form class="contact-form contact-form--dialog" data-lead-form>${honeypotField()}<label>Ваше имя<input required name="name" autocomplete="name" placeholder="Как к вам обращаться"></label><label>Телефон<input required name="phone" type="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__"></label><label class="contact-form__details-label contact-form__details-label--wide">Комментарий<textarea name="comment" rows="3" placeholder="Что хотите заказать?"></textarea></label><input type="hidden" name="service"><input type="hidden" name="message">${consentField()}<button class="cream-button" type="submit">ОТПРАВИТЬ ЗАЯВКУ</button><p class="form-status" aria-live="polite"></p></form></dialog>`;
const mediaLightbox = () => `<dialog class="media-lightbox" data-media-lightbox aria-label="Просмотр фото или видео"><button class="media-lightbox__close" type="button" data-close-media aria-label="Закрыть просмотр">×</button><div class="media-lightbox__content" data-media-lightbox-content></div></dialog>`;

const cookieConsentBanner = () => yandexMetrikaId ? `<section class="cookie-consent-banner" data-cookie-banner aria-labelledby="cookie-consent-title" hidden><div class="cookie-consent-banner__copy"><h2 id="cookie-consent-title">Настройки cookies</h2><p>С вашего согласия подключим Яндекс Метрику, чтобы понимать посещаемость сайта и делать его удобнее.</p><a href="/privacy/">Подробнее в Политике конфиденциальности</a></div><div class="cookie-consent-banner__actions"><button class="cookie-consent-banner__decline" type="button" data-cookie-choice="denied">Не согласен</button><button class="cookie-consent-banner__accept" type="button" data-cookie-choice="granted">Согласен</button></div></section>` : '';
const faviconLinks = () => '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32"><link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#140054">';
const layout = (meta, body, pageClass = '') => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(meta.title)}</title><meta name="description" content="${escapeAttr(meta.description)}"><link rel="canonical" href="${escapeAttr(meta.canonical)}"><meta property="og:title" content="${escapeAttr(meta.title)}"><meta property="og:description" content="${escapeAttr(meta.description)}"><meta property="og:type" content="website"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/legal.css">${faviconLinks()}</head><body class="${pageClass}" data-yandex-metrika-id="${yandexMetrikaId}" data-analytics-consent-version="${analyticsConsentVersion}">${nav()}<main>${brandText(body)}</main>${footer()}<a class="floating-party-cta" href="/#zayavka">ЗАКАЗАТЬ ПРАЗДНИК</a>${leadDialog()}${mediaLightbox()}${cookieConsentBanner()}<script src="/app.js" defer></script></body></html>`;

const dataStorageSection = () => `<section><h2>3.1. Размещение, доступ и сроки хранения</h2><p>Сервер, резервные копии, SMTP-сервис и используемая Яндекс Метрика находятся на территории Российской Федерации. Оператор не осуществляет трансграничную передачу персональных данных. Доступ к заявкам, почтовому ящику с заявками и административному разделу имеет только Оператор.</p><p>Заявка, по которой не заключён договор, хранится 90 календарных дней с момента получения. После этого она автоматически удаляется; в журнале удаления остаются только её идентификатор и даты создания, истечения срока и удаления. Если по заявке заключён договор, данные хранятся в течение срока, установленного договором и законодательством.</p></section>`;
const cookiesSection = () => {
  if (!yandexMetrikaId) return `${dataStorageSection()}<section><h2>4. Cookies и аналитика</h2><p>На дату публикации Политики сайт не подключает рекламные или аналитические сервисы, получающие данные посетителей. При подключении такого сервиса Оператор обновит Политику и запросит отдельное согласие до его загрузки.</p></section>`;
  return `${dataStorageSection()}<section><h2>4. Cookies и Яндекс Метрика</h2><p>Только после отдельного согласия пользователя сайт подключает Яндекс Метрику для подсчёта посещаемости, анализа источников переходов, работы страниц и форм, а также улучшения сайта. До согласия тег Метрики не загружается. Данные, введённые в формы заявок, в Метрику не передаются.</p><table><thead><tr><th>Категория</th><th>Какие данные и зачем</th><th>Срок</th></tr></thead><tbody><tr><td>Настройки согласия сайта</td><td>Выбор «согласен» или «не согласен», версия Политики и дата выбора — чтобы сохранить настройку и не загружать Метрику без согласия.</td><td>12 месяцев</td></tr><tr><td>Яндекс Метрика</td><td>Идентификаторы cookie и localStorage, IP-адрес, тип устройства и браузера, дата и время визита, адреса просмотренных страниц, источник перехода, клики, прокрутка и запись сессии Вебвизора — для статистики и улучшения сайта.</td><td>Cookie и локальное хранилище — от сессии до 2 лет; срок зависит от конкретного технического файла Метрики.</td></tr></tbody></table><p>Сведения передаются сервису Яндекс Метрика как лицу, которому поручена обработка технических данных для указанной цели. Пользователь может изменить выбор в подвале сайта; после отказа тег Метрики отключается, а доступные сайту cookies и localStorage Метрики удаляются.</p></section>`;
};

const privacyPage = () => layout(
  pageMeta({ title:'Политика конфиденциальности — ТЕМА', description:'Политика в отношении обработки персональных данных.', path:'/privacy/' }),
  `<article class="legal-page"><span class="mono-tag">Версия от ${privacyPolicyVersion}</span><h1>Политика в отношении обработки персональных данных</h1><p class="legal-page__lead">Настоящая политика определяет порядок обработки и защиты персональных данных пользователей сайта «ТЕМА».</p><section><h2>1. Общие положения</h2><p>Оператор персональных данных: <strong>физическое лицо Аничков Артём Вячеславович</strong> (далее — Оператор).</p>${personalDataContacts()}<p>Политика применяется к данным, которые Оператор получает через сайт «ТЕМА» по адресу <a href="${escapeAttr(siteUrl)}">${escapeHtml(siteUrl)}</a>, включая формы заявок. Она подготовлена в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных».</p></section><section><h2>2. Цели, состав и основания обработки</h2><table><thead><tr><th>Цель</th><th>Данные</th><th>Основание</th></tr></thead><tbody><tr><td>Принять и обработать заявку, связаться с заявителем, подобрать и оказать услугу</td><td>Имя, номер телефона, выбранная услуга, дата, район, пожелания и иные сведения, добровольно указанные в комментарии</td><td>Согласие субъекта персональных данных; при заключении договора — его исполнение</td></tr><tr><td>Подобрать формат детского праздника</td><td>Возраст ребёнка, если его указывает родитель или иной законный представитель</td><td>Согласие заявителя</td></tr><tr><td>Защитить формы и административный вход от спама и перебора пароля</td><td>IP-адрес, дата и время обращения, количество запросов и результат попытки входа</td><td>Законный интерес Оператора в обеспечении безопасности сайта</td></tr></tbody></table><p>Оператор не запрашивает и не обрабатывает специальные категории персональных данных и биометрические персональные данные. Пожалуйста, не указывайте в комментарии сведения о здоровье, документах, убеждениях и иную чувствительную информацию.</p></section><section><h2>3. Порядок и условия обработки</h2><p>Данные предоставляются пользователем добровольно через форму заявки. Оператор обрабатывает их автоматизированным способом: собирает, записывает, систематизирует, хранит, уточняет, использует для связи и удаления.</p><p>Для доставки новой заявки Оператор направляет указанные в ней сведения через настроенный почтовый SMTP-сервис. Такой сервис обрабатывает только необходимые данные по поручению Оператора для доставки сообщения.</p><p>Персональные данные не распространяются и не предоставляются третьим лицам без основания, установленного законом, согласия субъекта либо договора поручения обработки.</p><p>Для защиты сайта от спама и перебора пароля технические сведения об IP-адресах и попытках обращений хранятся только в памяти сервера: для заявок — до 1 часа, для входа в административный раздел — до 15 минут.</p><p>Оператор обеспечивает запись, систематизацию, накопление, хранение, уточнение и извлечение персональных данных граждан Российской Федерации с использованием баз данных, находящихся на территории Российской Федерации. Если потребуется подключить сервис, предусматривающий передачу данных за пределы Российской Федерации, Оператор сначала выполнит требования законодательства о трансграничной передаче и обновит настоящую Политику.</p><p>Данные хранятся только до достижения цели обработки, отзыва согласия или истечения законного срока хранения. После этого они уничтожаются или обезличиваются, если их сохранение не требуется законодательством Российской Федерации.</p></section>${cookiesSection()}<section><h2>5. Согласие и данные детей</h2><p>Отмечая чекбокс и отправляя заявку, пользователь даёт конкретное, информированное и сознательное согласие на обработку данных в объёме и для целей, указанных в <a href="/consent/">Согласии на обработку персональных данных</a>.</p><p>Если в заявке указываются сведения о ребёнке или ином третьем лице, заявитель подтверждает, что является его законным представителем или иным образом вправе передать эти сведения Оператору.</p></section><section><h2>6. Права пользователя</h2><p>Пользователь вправе запросить сведения об обработке своих данных, потребовать их уточнения, блокирования или уничтожения, а также отозвать согласие. Для этого направьте обращение Оператору по контактам, указанным в разделе 1. Отзыв согласия не влияет на законность обработки до его отзыва и может сделать невозможными обработку заявки или оказание услуги.</p><p>Обращение также можно направить в Роскомнадзор или обжаловать действия Оператора в судебном порядке.</p></section><section><h2>7. Защита данных</h2><p>Оператор принимает необходимые правовые, организационные и технические меры: ограничивает доступ к заявкам, использует аутентификацию для административного раздела, защищает учётные данные и контролирует доступ к данным. Доступ к заявкам имеет только Оператор и лица, которым он поручил обработку на законном основании.</p></section><section><h2>8. Изменение Политики</h2><p>Оператор вправе обновлять Политику при изменении сайта, способов обработки или законодательства. Актуальная версия всегда доступна по адресу <a href="/privacy/">${escapeHtml(siteUrl)}/privacy/</a>.</p></section></article>`,
  'legal-body'
);

const consentPage = () => layout(
  pageMeta({ title:'Согласие на обработку персональных данных — ТЕМА', description:'Согласие на обработку персональных данных для заявок с сайта.', path:'/consent/' }),
  `<article class="legal-page"><span class="mono-tag">Версия от ${personalDataConsentVersion}</span><h1>Согласие на обработку персональных данных</h1><p class="legal-page__lead">Заполняя форму и отмечая поле согласия, я свободно, своей волей и в своём интересе даю согласие физическому лицу <strong>Аничкову Артёму Вячеславовичу</strong> на обработку моих персональных данных.</p><section><h2>Что обрабатывается и зачем</h2><p>Оператор может обрабатывать имя, номер телефона, сведения из комментария, выбранную услугу, а также возраст ребёнка, если я укажу его в заявке. Цель — принять и обработать заявку, связаться со мной, подобрать услугу, заключить и исполнить договор при его оформлении.</p></section><section><h2>Как обрабатываются данные</h2><p>Я разрешаю сбор, запись, систематизацию, накопление, хранение, уточнение, использование, передачу почтовому сервису для доставки заявки и иные передачи в случаях, предусмотренных законодательством или договором поручения обработки, блокирование и уничтожение данных с использованием средств автоматизации или без них. Оператор не распространяет мои данные неопределённому кругу лиц.</p></section><section><h2>Срок и отзыв согласия</h2><p>Согласие действует до достижения цели обработки или до его отзыва, если более длительное хранение не требуется законом или договором. Я могу отозвать согласие, направив обращение Оператору по контактам, указанным ниже. После отзыва Оператор прекратит обработку и уничтожит данные в сроки, установленные законом, если их сохранение не требуется для исполнения обязанностей по закону или договору.</p>${personalDataContacts()}</section><section><h2>Дополнительно</h2><p>Я подтверждаю достоверность предоставленных сведений. Если я указываю данные ребёнка или другого лица, то являюсь его законным представителем либо имею законное основание на их передачу. Полный порядок обработки приведён в <a href="/privacy/">Политике в отношении обработки персональных данных</a>.</p></section></article>`,
  'legal-body'
);

const heroBlock = ({ tag, lines, intro, photo, mascot = '/assets/mascot-peek.png', action = 'Подобрать праздник', service = 'Праздник', pageClass = '', artVariant = '' }) => {
  const resolvedArtVariant = artVariant;
  const artLabel = ({ animatory:'КАСТИНГ ГЕРОЕВ', show:'НАЖМИ · ИГРА НАЧАЛАСЬ', theater:'ЗАНАВЕС ОТКРЫТ' })[resolvedArtVariant] || 'ГЛАВНЫЙ КАДР';
  const photoMarkup = resolvedArtVariant
    ? `<div class="landing-hero-art landing-hero-art--${escapeAttr(resolvedArtVariant)}" aria-hidden="true"><span class="landing-hero-art__label">${escapeHtml(artLabel)}</span><i class="landing-hero-art__shape landing-hero-art__shape--one"></i><i class="landing-hero-art__shape landing-hero-art__shape--two"></i>${photo?.image ? `<img src="${escapeAttr(photo.image)}" alt="" style="${cropStyle(photo)}">` : ''}</div>`
    : `<div class="hero-photo-slot image-slot">${photo?.image ? `<img class="managed-photo" src="${escapeAttr(photo.image)}" alt="" style="${cropStyle(photo)}">` : '<div class="placeholder-art placeholder-art--party"><i></i><i></i><i></i></div>'}</div>`;
  return `<section class="hero ${pageClass}"><span class="hero__tag mono-tag">${escapeHtml(tag)}</span><h1>${lines.map((line, index) => index === 0 ? `<span class="hero__line"><span class="hero__mascot-wrap" aria-hidden="true">${mascot ? `<img class="hero__mascot" src="${escapeAttr(mascot)}" alt="">` : ''}</span><span class="hero__text">${escapeHtml(line)}</span></span>` : `<span${index === 1 ? ' class="soft"' : ''}>${escapeHtml(line)}</span>`).join(' ')}</h1>${photoMarkup}<div class="hero__foot"><p>${escapeHtml(intro)}</p><button class="outline-button" data-open-form data-service="${escapeAttr(service)}">${escapeHtml(action)}</button></div></section>`;
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
  },
  homeAnimator: {
    title: 'ГЕРОЙ\nУЖЕ\nВ ПУТИ.',
    intro: 'Позовите аниматора домой, в кафе, сад или школу — и обычный день превратится в приключение.'
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

const partyForm = () => `<section class="contact" id="zayavka"><div><span class="mono-tag">Заявка</span><h2>Обсудим<br>ваш праздник</h2><p>Оставьте контакты — уточним детали и всё обсудим по телефону.</p></div><form class="contact-form contact-form--planner" data-lead-form data-party-form>${honeypotField()}<div class="contact-form__planner-intro"><span class="mono-tag">Давайте знакомиться</span><strong>Позвоним<br>и всё обсудим</strong><p>Оставьте номер — подберём праздник вместе по телефону.</p></div><input type="hidden" name="service"><input type="hidden" name="message"><label class="contact-form__details-label">Ваше имя<input required name="name" autocomplete="name" placeholder="Как к вам обращаться"></label><label class="contact-form__details-label">Телефон<input required name="phone" type="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__"></label><label class="contact-form__details-label full">Комментарий<input name="comment" placeholder="Дата, район, пожелания"></label>${consentField()}<button class="cream-button" type="submit">ОТПРАВИТЬ ЗАЯВКУ</button><p class="form-status" aria-live="polite"></p></form></section>`;

const factIcons = {
  age: '<svg class="service-card__fact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  people: '<svg class="service-card__fact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2"/><path d="M3 20c.5-4 3-6 6-6s5.5 2 6 6M15 15c3 0 5 1.8 5.5 5"/></svg>'
};
const directionCard = ({ href, title, age, people, variant, photo, mascot }) => `<a class="service-card service-card--${variant}${mascot ? ' service-card--has-mascot' : ''}" href="${escapeAttr(href)}">${photo?.image ? `<div class="service-card__media">${image(photo)}</div>` : ''}<h3>${escapeHtml(title)}</h3><dl class="service-card__facts"><div><dt>${factIcons.age} Возраст</dt><dd>${escapeHtml(age)}</dd></div><div><dt>${factIcons.people} Гостей</dt><dd>${escapeHtml(people)}</dd></div></dl>${mascot ? `<img class="service-card__mascot-game" src="${escapeAttr(mascot)}" alt="" aria-hidden="true">` : ''}<span class="service-card__cta">ВЫБРАТЬ</span></a>`;

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

const eventCards = events => `<div class="event-grid">${events.filter(visible).map((event, index) => `<article class="poster-card poster-card--${['yellow','pink','red'][index % 3]}">${event.image ? `<div class="poster-card__image ${event.imageFit === 'poster' ? 'poster-card__image--poster' : ''}">${image(event)}</div>` : ''}<span class="mono-tag">${escapeHtml(event.category || 'Афиша')}${event.date ? ` · ${escapeHtml(formatEventDate(event.date))}` : ''}</span><h3>${escapeHtml(event.title)}</h3>${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}${event.buttonUrl ? `<a class="poster-card__cta" href="${escapeAttr(event.buttonUrl)}"><span>${escapeHtml(event.buttonLabel || 'Открыть')}</span></a>` : `<a class="poster-card__cta" href="/afisha/${escapeAttr(event.slug)}/"><span>${escapeHtml(event.buttonLabel || 'Открыть афишу')}</span></a>`}</article>`).join('')}</div>`;

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
  const homeMosaic = `<section class="photo-story"><div class="photo-story__intro"><span class="mono-tag">НЕ ПОСТАНОВКА · ЖИВЫЕ ЭМОЦИИ</span><h2>Дети не позируют.<br>Они живут внутри истории.</h2></div><div class="photo-story__mosaic"><figure class="story-shot story-shot--wide"><div class="image-slot">${image(photoFromContent(content, 'photo5'), 'managed-photo')}</div><figcaption><b>01</b> Момент, когда весь зал играет вместе</figcaption></figure><figure class="story-shot story-shot--portrait"><div class="image-slot">${image(photoFromContent(content, 'photo6'), 'managed-photo')}</div></figure><figure class="story-shot story-shot--detail"><div class="image-slot">${image(photoFromContent(content, 'photo7'), 'managed-photo')}</div><figcaption><b>03</b> Маленькие вещи делают мир убедительным</figcaption></figure></div></section>`;
  const body = [
    heroBlock({ tag:'Праздники · Кемерово', lines:['ПРАЗДНИКИ', 'В КЕМЕРОВО'], intro:content.heroIntro || 'Организация детских праздников в Кемерово: аниматоры, шоу и спектакли на вашей площадке.', photo:photoFromContent(content, 'photo1'), service:'Праздник в Кемерово', pageClass:'hero--home' }),
    homeTicker,
    `<section class="services"><div class="section-heading section-heading--home-formats"><span class="mono-tag">Выберите формат праздника</span><h2>И начнём игру</h2></div><div class="service-grid service-grid--home">${directionCards}</div></section>`,
    homePulse,
    homeMosaic,
    `<section class="events events--home"><div class="events__head"><h2>Афиша впечатлений</h2><a class="events__all" href="/afisha/">Вся афиша</a></div>${eventCards(events.slice(0, 3))}</section>`,
    partyForm()
  ].join('');
  return layout(pageMeta({ path:'/', title:content.heroTitle ? `${content.heroTitle} | ТЕМА` : undefined, description:content.heroIntro }), body, 'page--home');
};

const heroCard = (hero, index) => {
  const prices = heroPrices(hero);
  return `<article class="hero-program-card hero-program-card--${escapeAttr(hero.accent || 'yellow')}" data-hero-card data-hero-audience="${escapeAttr(hero.audience || 'all')}" data-hero-id="${escapeAttr(hero.id)}" data-hero-name="${escapeAttr(hero.name)}" data-hero-weekday-price="${prices.weekday}" data-hero-weekend-price="${prices.weekend}"><div class="hero-program-card__media">${image(hero)}<span class="hero-program-card__number">0${index + 1}</span></div><div class="hero-program-card__summary"><span class="mono-tag">${hero.audience === 'girls' ? 'Для девочек' : hero.audience === 'boys' ? 'Для мальчиков' : 'Для всех'}</span><h3>${escapeHtml(hero.name)}</h3><div class="hero-program-card__facts"><span><small>Время</small>${escapeHtml(hero.duration || 40)} минут</span><span><small>Будни</small><b>${formatPrice(prices.weekday)}</b></span><span><small>Выходные</small><b>${formatPrice(prices.weekend)}</b></span></div></div><div class="hero-program-card__details"><p>${escapeHtml(hero.description)}</p><a class="hero-program-card__seo-link" href="/animatory/${escapeAttr(hero.slug)}/">Подробнее о герое</a></div><div class="hero-program-card__action"><button class="hero-program-card__cta" type="button" data-add-hero>ВЫБРАТЬ ГЕРОЯ</button></div></article>`;
};

const heroCartDialog = (heroes, settings) => {
  const miniCards = heroes.map(hero => `<button class="hero-cart__mini-card" type="button" data-cart-second-option="${escapeAttr(hero.id)}">${hero.image ? `<img src="${escapeAttr(hero.image)}" alt="" style="${cropStyle(hero)}">` : '<span class="hero-cart__mini-placeholder" aria-hidden="true">★</span>'}<span>${escapeHtml(hero.name)}</span></button>`).join('');
  const promo = settings.enabled && heroes.length > 1 ? `<section class="hero-cart__upsell" data-cart-upsell><div class="hero-cart__upsell-head"><div class="hero-cart__upsell-copy"><span class="mono-tag">Акция к празднику</span><h3>${escapeHtml(settings.promoTitle)}</h3><p>${escapeHtml(settings.promoDescription)}</p></div><div class="hero-cart__upsell-price"><small>Второй герой</small><strong>${formatPrice(settings.secondHeroPrice)}</strong><span>фиксированная доплата</span></div></div><ul class="hero-cart__upsell-benefits"><li>Больше игр и внимания каждому ребёнку</li><li>Два любимых героя в одной истории</li></ul><p class="hero-cart__upsell-help">Выберите напарника для главного героя</p><div class="hero-cart__mini-grid" role="group" aria-label="Выберите второго героя">${miniCards}</div></section>` : '';
  return `<dialog class="hero-cart-dialog" data-hero-cart data-second-hero-price="${settings.secondHeroPrice}"><button class="dialog-close" type="button" data-close-hero-cart aria-label="Закрыть корзину">×</button><form class="hero-cart" data-lead-form data-hero-cart-form>${honeypotField()}<header class="hero-cart__header"><span class="mono-tag">Ваша корзина</span><h2>Соберём<br>праздник</h2><p>Выберите день — сумма посчитается сразу.</p></header><fieldset class="hero-cart__day"><legend>Когда праздник?</legend><div><button type="button" class="is-selected" data-cart-day="weekday" aria-pressed="true">Будни</button><button type="button" data-cart-day="weekend" aria-pressed="false">Выходные</button></div></fieldset><section class="hero-cart__items" aria-live="polite"><div class="hero-cart__item"><span><small>Главный герой</small><strong data-cart-primary-name>Выберите героя</strong></span><b data-cart-primary-price>—</b></div><div class="hero-cart__item hero-cart__item--second" data-cart-second-item hidden><span><small>Второй герой · акция</small><strong data-cart-second-name></strong></span><b data-cart-second-price></b></div></section>${promo}<section class="hero-cart__total"><span>Итого</span><strong data-cart-total>—</strong><small data-cart-summary>Выберите главного героя.</small></section><section class="hero-cart__lead"><h3>Оставьте заявку</h3><div class="hero-cart__fields"><label>Ваше имя<input required name="name" autocomplete="name" placeholder="Как к вам обращаться"></label><label>Телефон<input required name="phone" type="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__"></label><label class="hero-cart__field--wide">Комментарий<input name="comment" placeholder="Дата, район, пожелания"></label></div><input type="hidden" name="service"><input type="hidden" name="message">${consentField()}<button class="cream-button" type="submit">ОТПРАВИТЬ ЗАЯВКУ</button><p class="form-status" aria-live="polite"></p></section></form></dialog>`;
};

const heroChoiceDialog = settings => settings.enabled ? `<dialog class="hero-choice-dialog" data-hero-choice><button class="dialog-close" type="button" data-close-hero-choice aria-label="Закрыть">×</button><div class="hero-choice"><span class="mono-tag">Акция к празднику</span><h2>${escapeHtml(settings.promoTitle)}</h2><p><strong data-choice-hero-name></strong> уже в программе. ${escapeHtml(settings.promoDescription)}</p><section class="hero-choice__offer"><div class="hero-choice__price"><span>Второй герой<br>по акции</span><strong>${formatPrice(settings.secondHeroPrice)}</strong><small>фиксированная доплата</small></div><ul class="hero-choice__benefits"><li>Больше игр и внимания каждому ребёнку</li><li>Два персонажа в одной истории</li></ul></section><div class="hero-choice__actions"><button class="hero-choice__no" type="button" data-choice-no>Оставить<br>одного героя</button><button class="hero-choice__yes" type="button" data-choice-yes>Выбрать<br>второго героя</button></div></div></dialog>` : '';

const renderAnimators = async () => {
  const content = await loadContent(); const heroes = (await loadCatalog('heroes')).filter(visible);
  const heroCopy = pageHeroCopy(content, 'animatory');
  const cartSettings = heroCartSettings(content);
  const body = `${heroBlock({ tag:'Аниматоры на праздник · Кемерово', lines:heroCopy.lines, intro:heroCopy.intro, photo:photoFromContent(content,'animatoryPhoto1'), mascot:'/assets/mascot-peek-animator.png', service:'Подбор аниматора', pageClass:'afisha-hero' })}<section class="hero-catalog" id="hero-catalog"><div class="hero-catalog__heading"><h2>Выбери своего героя</h2><aside class="hero-filter" aria-label="Фильтр героев"><span class="hero-filter__label">Фильтр героев</span><div class="hero-filter__options" role="group" aria-label="Категория героя"><button class="hero-filter__button is-active" type="button" data-hero-filter="all" aria-pressed="true">Все герои</button><button class="hero-filter__button" type="button" data-hero-filter="boys" aria-pressed="false">Для мальчиков</button><button class="hero-filter__button" type="button" data-hero-filter="girls" aria-pressed="false">Для девочек</button></div></aside></div><div class="hero-program-grid">${heroes.map(heroCard).join('')}</div><p class="hero-filter__empty" data-hero-empty hidden>В этой категории герои скоро появятся.</p></section>${heroChoiceDialog(cartSettings)}${heroCartDialog(heroes, cartSettings)}${partyForm()}`;
  return layout(pageMeta({ title:'Аниматоры на детский праздник в Кемерово | ТЕМА', description:'Заказать аниматора на детский день рождения в Кемерово: супергерои, игровая программа, выезд на дом, в сад или школу.', path:'/animatory/' }), body, 'page--animatory');
};

const showCartDialog = (shows, heroes) => {
  const catalog = shows.map(show => ({
    id: show.id,
    name: show.name,
    price: priceNumber(show.price, 0),
    ...showAnimatorSettings(show, heroes)
  }));
  return `<dialog class="hero-cart-dialog show-cart-dialog" data-show-cart data-show-cart-catalog="${escapeAttr(JSON.stringify(catalog))}"><button class="dialog-close" type="button" data-close-show-cart aria-label="Закрыть корзину">×</button><form class="hero-cart show-cart" data-lead-form data-show-cart-form>${honeypotField()}<header class="hero-cart__header"><span class="mono-tag">Ваш праздник</span><h2>Соберём<br>программу</h2><p>Добавьте аниматора, если он подходит к выбранному шоу. Сумма посчитается сразу.</p></header><fieldset class="hero-cart__day"><legend>Когда праздник?</legend><div><button type="button" class="is-selected" data-show-cart-day="weekday" aria-pressed="true">Будни</button><button type="button" data-show-cart-day="weekend" aria-pressed="false">Выходные</button></div></fieldset><section class="hero-cart__items" aria-live="polite"><div class="hero-cart__item"><span><small>Главная программа</small><strong data-show-cart-name>Выберите шоу</strong></span><b data-show-cart-price>—</b></div><div class="hero-cart__item hero-cart__item--second" data-show-cart-hero-item hidden><span><small>Аниматор</small><strong data-show-cart-hero-name></strong></span><b data-show-cart-hero-price></b></div></section><section class="hero-cart__upsell" data-show-cart-upsell hidden><div class="hero-cart__upsell-head"><div class="hero-cart__upsell-copy"><span class="mono-tag">Дополнение к шоу</span><h3 data-show-cart-offer-title>Добавьте любимого героя</h3><p data-show-cart-offer-description></p></div><button class="show-cart__no-hero" type="button" data-show-cart-no-hero aria-pressed="true">Только шоу</button></div><p class="hero-cart__upsell-help">Выберите героя — или продолжите только с шоу.</p><div class="hero-cart__mini-grid" role="group" aria-label="Выберите аниматора" data-show-cart-hero-options></div></section><section class="hero-cart__total"><span>Итого</span><strong data-show-cart-total>—</strong><small data-show-cart-summary>Выберите шоу.</small></section><section class="hero-cart__lead"><h3>Оставьте заявку</h3><div class="hero-cart__fields"><label>Ваше имя<input required name="name" autocomplete="name" placeholder="Как к вам обращаться"></label><label>Телефон<input required name="phone" type="tel" autocomplete="tel" placeholder="+7 (___) ___-__-__"></label><label class="hero-cart__field--wide">Комментарий<input name="comment" placeholder="Дата, район, пожелания"></label></div><input type="hidden" name="service"><input type="hidden" name="message">${consentField()}<button class="cream-button" type="submit">ОТПРАВИТЬ ЗАЯВКУ</button><p class="form-status" aria-live="polite"></p></section></form></dialog>`;
};

const showCard = (show, index) => `<article class="show-offer-card show-offer-card--${escapeAttr(show.accent || 'yellow')}" data-show-card data-show-id="${escapeAttr(show.id)}"><div class="show-offer-card__media">${image(show)}<span class="show-offer-card__number">0${index + 1}</span></div><div class="show-offer-card__summary"><span class="mono-tag">Интерактивная программа</span><h3>${escapeHtml(show.name)}</h3><p class="show-offer-card__price"><span>Стоимость</span><strong>от ${formatPrice(show.price)}</strong></p></div><div class="show-offer-card__details"><p>${escapeHtml(show.description)}</p>${programMediaGallery(show)}<a class="show-offer-card__seo-link" href="/show/${escapeAttr(show.slug)}/">Подробнее о шоу</a></div><div class="show-offer-card__action"><button class="show-offer-card__cta" type="button" data-select-show>ВЫБРАТЬ ШОУ</button></div></article>`;

const renderShow = async () => {
  const [content, catalog, heroes] = await Promise.all([loadContent(), loadCatalog('shows'), loadCatalog('heroes')]);
  const shows = catalog.filter(visible);
  const heroCopy = pageHeroCopy(content, 'show');
  const body = `${heroBlock({ tag:'Шоу в Кемерово', lines:heroCopy.lines, intro:heroCopy.intro, photo:photoFromContent(content,'showPhoto1'), mascot:'/assets/mascot-peek-show.png', service:'Подбор шоу', pageClass:'afisha-hero' })}<section class="show-catalog" id="show-catalog"><div class="show-offer-grid-wrap"><button class="show-catalog__mascot-cta" type="button" data-open-form data-service="Подбор шоу"><img src="/assets/mascot-game.png" alt="" aria-hidden="true"><span><small>Нужна подсказка?</small><strong>Подберём шоу</strong></span></button><div class="show-offer-grid">${shows.map(showCard).join('')}</div></div></section>${showCartDialog(shows, heroes)}${partyForm()}`;
  return layout(pageMeta({ title:'Шоу на праздник в Кемерово — заказать | ТЕМА', description:'Интерактивные и научные шоу на праздник в Кемерово: азотное шоу, неоновая дискотека, пенная вечеринка и другие программы.', path:'/show/' }), body, 'page--show');
};

const playCard = play => `<article class="playbill-card playbill-card--${escapeAttr(play.accent || 'violet')}"><div class="playbill-card__photo">${image(play)}</div><span class="mono-tag">Интерактивный спектакль · ${escapeHtml(play.age || '3+') }</span><h3>${escapeHtml(play.name)}</h3><p>${escapeHtml(play.description)}</p>${Number(play.price) > 0 ? `<p><strong>от ${formatPrice(play.price)}</strong></p>` : ''}<div class="playbill-card__action"><button class="playbill-card__cta" data-open-form data-service="Спектакль: ${escapeAttr(play.name)}" data-order-message="Хочу заказать спектакль «${escapeAttr(play.name)}».">ЗАКАЗАТЬ СПЕКТАКЛЬ</button></div></article>`;

const stagePlayCard = play => `<article class="theater-stage-card theater-stage-card--${escapeAttr(play.accent || 'violet')}"><div class="theater-stage-card__media">${image(play)}</div><div class="theater-stage-card__copy"><span class="mono-tag">Интерактивный спектакль · ${escapeHtml(play.age || '3+') }</span><h2>${escapeHtml(play.name)}</h2><p>${escapeHtml(play.description)}</p>${programMediaGallery(play)}${Number(play.price) > 0 ? `<strong class="theater-stage-card__price">от ${formatPrice(play.price)}</strong>` : ''}<button class="theater-stage-card__cta" data-open-form data-service="Спектакль: ${escapeAttr(play.name)}" data-order-message="Хочу заказать спектакль «${escapeAttr(play.name)}».">ЗАКАЗАТЬ СПЕКТАКЛЬ</button></div></article>`;

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
  const [heroes, shows, plays] = await Promise.all([loadCatalog('heroes'), loadCatalog('shows'), loadCatalog('plays')]);
  const birthdayFormatCard = ({ href, title, description, age, duration, guests, price, includes, variant, photo }) => `<a class="birthday-format-card birthday-format-card--${escapeAttr(variant)}" href="${escapeAttr(href)}"><div class="birthday-format-card__media">${image(photo)}</div><div class="birthday-format-card__copy"><span class="mono-tag">Формат праздника</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div><dl class="birthday-format-card__facts"><div><dt>Возраст</dt><dd>${escapeHtml(age)}</dd></div><div><dt>Длительность</dt><dd>${escapeHtml(duration)}</dd></div><div><dt>Гостей</dt><dd>${escapeHtml(guests)}</dd></div><div><dt>Стоимость</dt><dd>${escapeHtml(price)}</dd></div></dl><div class="birthday-format-card__includes"><small>В программе</small><strong>${escapeHtml(includes)}</strong></div><span class="birthday-format-card__cta">ВЫБРАТЬ</span></a>`;
  const serviceCards = [
    birthdayFormatCard({ href:'/animatory/#hero-catalog', title:'Аниматор', description:'Любимый герой ведёт игру и вовлекает каждого ребёнка.', age:'3–12 лет', duration:'40 минут', guests:'до 15', price:minimumPriceLabel(heroes.filter(visible)), includes:'герой, игры, реквизит', variant:'yellow', photo:photoFromContent(content,'animatoryPhoto1') }),
    birthdayFormatCard({ href:'/show/#show-catalog', title:'Шоу', description:'Эффектная программа для детей, которые любят удивляться.', age:'3+ лет', duration:'30–45 минут', guests:'до 50', price:minimumPriceLabel(shows.filter(visible)), includes:'ведущий, эффекты, участие детей', variant:'pink', photo:photoFromContent(content,'showPhoto1') }),
    birthdayFormatCard({ href:'/spektakli/', title:'Спектакль', description:'Интерактивная история, в которой дети помогают героям.', age:plays.find(visible)?.age || '4+ лет', duration:'45–60 минут', guests:'от 30', price:minimumPriceLabel(plays.filter(visible)), includes:'актёры, сюжет, реквизит', variant:'cream', photo:photoFromContent(content,'theaterPhoto1') })
  ].join('');
  const body = `${heroBlock({ tag:'Детский день рождения · Кемерово', lines:heroCopy.lines, intro:heroCopy.intro, photo:photoFromContent(content,'photoBirthday'), mascot:'/assets/mascot-peek-birthday.png', service:'Детский день рождения', pageClass:'afisha-hero' })}<section class="birthday-formats"><header class="birthday-formats__head"><div><span class="mono-tag">Форматы праздника</span><h2>Что добавить<br>в день рождения</h2></div><p>Выберите основу программы — подскажем, какой формат подойдёт возрасту ребёнка, гостям и площадке.</p></header><div class="birthday-format-grid">${serviceCards}</div></section>${partyForm()}`;
  return layout(pageMeta({ title:'Детский день рождения в Кемерово | ТЕМА', description:'Организация детского дня рождения в Кемерово: аниматоры, шоу и спектакли на дом, в сад или на площадку.', path:'/detskiy-den-rozhdeniya/' }), body, 'page--birthday');
};

const renderHomeAnimator = async () => {
  const content = await loadContent();
  const heroCopy = pageHeroCopy(content, 'homeAnimator');
  const body = `${heroBlock({ tag:'Аниматор на дом · Кемерово', lines:heroCopy.lines, intro:heroCopy.intro, photo:photoFromContent(content,'animatoryPhoto3'), mascot:'/assets/mascot-peek-animator.png', service:'Аниматор на дом', pageClass:'afisha-hero' })}<section class="landing-intro"><span class="mono-tag">Где провести</span><h2>Мы приедем<br>туда, где<br>удобно вам</h2><p>Привезём реквизит, программу и настроение. Вам остаётся собрать гостей и ждать героя.</p></section>${partyForm()}`;
  return layout(pageMeta({ title:'Аниматор на дом в Кемерово | ТЕМА', description:'Заказать аниматора на дом в Кемерово: игровая программа, реквизит и любимый герой ребёнка.', path:'/animatory-na-dom/' }), body, 'page--animatory');
};

const renderAfisha = async () => {
  const events = (await loadCatalog('events')).filter(visible);
  const body = `<section class="afisha-catalog afisha-catalog--compact" id="afisha-catalog"><header class="afisha-catalog__head"><div><span class="mono-tag">Кемерово</span><h1>Афиша</h1></div><p>${events.length ? 'Выберите событие и откройте афишу — внутри подробности программы и заявка.' : 'Новые события появятся здесь совсем скоро.'}</p></header>${events.length ? eventCards(events) : '<p class="empty-state">Афиша обновляется — скоро добавим новые события.</p>'}</section>`;
  return layout(pageMeta({ title:'Афиша детских событий в Кемерово | ТЕМА', description:'Афиша праздников, спектаклей и детских событий в Кемерово. Билеты, программы и заявки.', path:'/afisha/' }), body, 'page--afisha');
};

const renderServiceDetail = ({ item, type, showCart = '' }) => {
  const isHero = type === 'heroes';
  const name = item.name;
  const label = isHero ? `Аниматор ${name}` : name;
  const action = isHero
    ? `<button class="outline-button" data-open-form data-service="${escapeAttr(label)}" data-order-message="Хочу заказать ${escapeAttr(label)}.">ЗАКАЗАТЬ</button>`
    : `<button class="outline-button" type="button" data-select-show data-show-id="${escapeAttr(item.id)}">ВЫБРАТЬ ШОУ</button>`;
  const body = `<section class="event-detail seo-service-detail${isHero ? '' : ' seo-service-page--show'}"><a class="event-detail__back" href="/${isHero ? 'animatory' : 'show'}/">← НАЗАД В КАТАЛОГ</a><div class="event-detail__layout"><div class="event-detail__media">${image(item)}</div><article class="event-detail__copy"><span class="mono-tag">${isHero ? 'Аниматор на праздник' : 'Шоу на праздник'} · Кемерово</span><h1>${escapeHtml(label)}</h1><p class="seo-service-detail__lead">${escapeHtml(item.description)}</p><p>${isHero ? `${escapeHtml(item.duration || 40)} минут игры, яркий реквизит и герой, который вовлечёт детей в приключение.` : 'Программа на вашей площадке: ведущий, реквизит и эффектный финал.'}</p>${programMediaGallery(item)}<p><strong>${isHero ? `${escapeHtml(item.duration || 40)} минут · ` : ''}${formatPrice(item.price)}</strong></p>${action}</article></div></section>${showCart}${partyForm()}`;
  return layout(pageMeta({ title:item.seoTitle || `${label} в Кемерово | ТЕМА`, description:item.seoDescription || item.description, path:`/${isHero ? 'animatory' : 'show'}/${item.slug}/` }), body, isHero ? 'page--animatory' : 'page--show');
};

const renderEventDetail = event => {
  const target = event.buttonUrl || '';
  const body = `<section class="event-detail"><a class="event-detail__back" href="/afisha/">← ВСЯ АФИША</a><div class="event-detail__layout"><div class="event-detail__media ${event.imageFit === 'poster' ? 'event-detail__media--poster' : ''}">${image(event)}</div><article class="event-detail__copy"><span class="mono-tag">${escapeHtml(event.category || 'Событие')} · ${escapeHtml(event.date || '')}</span><h1>${escapeHtml(event.title)}</h1><p>${escapeHtml(event.description || 'Оставьте заявку — расскажем о программе, времени и площадке.')}</p>${target ? `<a class="outline-button" href="${escapeAttr(target)}">${escapeHtml(event.buttonLabel || 'Открыть')}</a>` : `<button class="outline-button" data-open-form data-service="${escapeAttr(event.title)}" data-order-message="Интересует афиша: ${escapeAttr(event.title)}.">${escapeHtml(event.buttonLabel || 'Оставить заявку')}</button>`}</article></div></section>${partyForm()}`;
  return layout(pageMeta({ title:`${event.title} | ТЕМА`, description:event.description || `Афиша события «${event.title}» в Кемерово.`, path:`/afisha/${event.slug}/` }), body, 'page--afisha');
};

const adminLayout = (title, body, active = 'home') => brandText(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ТЕМА</title><link rel="stylesheet" href="/admin.css">${faviconLinks()}</head><body class="admin-page"><header class="admin-header"><a href="/admin/">ТЕМА <span>/ админка</span></a><nav><a href="/" target="_blank" rel="noopener">Открыть главную ↗</a><form action="/admin/logout" method="post"><button type="submit">Выйти</button></form></nav></header><div class="admin-workspace"><aside class="admin-sidebar">${adminTabs(active)}</aside><main class="admin-shell">${body}</main></div><script src="/admin.js" defer></script></body></html>`);
const adminLogin = error => brandText(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход · ТЕМА</title><link rel="stylesheet" href="/admin.css">${faviconLinks()}</head><body class="admin-login"><form class="login-card" method="post" action="/admin/login"><a href="/">ТЕМА</a><h1>Админка</h1><label>Логин<input name="username" autocomplete="username" autofocus required></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>${error ? `<p class="admin-error">${escapeHtml(error)}</p>` : ''}<button type="submit">Войти</button></form></body></html>`);
const adminTabs = active => `<nav class="admin-navigation" aria-label="Разделы админки"><section><span class="admin-navigation__title">Страницы</span><a class="${active === 'home' ? 'is-active' : ''}" href="/admin/">Главная</a><a class="${active === 'birthday' ? 'is-active' : ''}" href="/admin/birthday">День рождения</a><a class="${active === 'animatory-page' ? 'is-active' : ''}" href="/admin/page/animatory">Аниматоры — первый экран</a><a class="${active === 'home-animator' ? 'is-active' : ''}" href="/admin/page/home-animator">Аниматор на дом</a><a class="${active === 'show-page' ? 'is-active' : ''}" href="/admin/page/show">Шоу — первый экран</a><a class="${active === 'theater-page' ? 'is-active' : ''}" href="/admin/page/theater">Спектакли — первый экран</a></section><section><span class="admin-navigation__title">Каталог</span><a class="${active === 'heroes' ? 'is-active' : ''}" href="/admin/catalog/heroes">Аниматоры</a><a class="${active === 'shows' ? 'is-active' : ''}" href="/admin/catalog/shows">Шоу</a><a class="${active === 'plays' ? 'is-active' : ''}" href="/admin/catalog/plays">Спектакли</a><a class="${active === 'events' ? 'is-active' : ''}" href="/admin/catalog/events">Афиша</a></section><section><span class="admin-navigation__title">Продажи</span><a class="${active === 'cart' ? 'is-active' : ''}" href="/admin/cart">Акция второго героя</a></section></nav>`;
const formField = (label, name, value = '', options = {}) => `<label class="admin-field${options.wide ? ' admin-field--wide' : ''}">${escapeHtml(label)}${options.textarea ? `<textarea name="${escapeAttr(name)}" ${options.required ? 'required' : ''}>${escapeHtml(value)}</textarea>` : `<input name="${escapeAttr(name)}" value="${escapeAttr(value)}" ${options.type ? `type="${escapeAttr(options.type)}"` : 'type="text"'} ${options.type === 'range' ? 'min="0" max="200"' : ''} ${options.required ? 'required' : ''} ${options.step ? `step="${escapeAttr(options.step)}"` : ''}>`}</label>`;
const selectField = (label, name, value, values) => `<label class="admin-field">${escapeHtml(label)}<select name="${escapeAttr(name)}">${values.map(([itemValue, itemLabel]) => `<option value="${escapeAttr(itemValue)}" ${itemValue === value ? 'selected' : ''}>${escapeHtml(itemLabel)}</option>`).join('')}</select></label>`;
const visibilityField = value => `<label class="admin-check"><input type="checkbox" name="published" ${value !== false ? 'checked' : ''}> Показывать на сайте</label>`;
const mediaEditor = (key, item, { poster = false } = {}) => `<div class="photo-editor" data-fit-preview="${escapeAttr(key)}"><div class="admin-photo-preview ${poster && item.imageFit === 'poster' ? 'is-poster' : ''}">${item.image ? `<img data-crop-preview="${escapeAttr(key)}" src="${escapeAttr(item.image)}" alt="" style="${cropStyle(item)}">` : '<i>Фото</i>'}</div><label class="upload-field">Загрузить фотографию<input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" data-photo-input="${escapeAttr(key)}"><span>JPG, PNG, WEBP или GIF → WebP · до 12 МБ</span></label><div class="crop-grid">${formField('Горизонт', 'imagePositionX', number(item.imagePositionX), { type:'range', step:'1' }).replace(`name=\"imagePositionX\"`, `name=\"imagePositionX\" data-crop-x=\"${escapeAttr(key)}\"`)}${formField('Вертикаль', 'imagePositionY', number(item.imagePositionY), { type:'range', step:'1' }).replace(`name=\"imagePositionY\"`, `name=\"imagePositionY\" data-crop-y=\"${escapeAttr(key)}\"`)}${formField('Масштаб', 'imageScale', number(item.imageScale, 100), { type:'range', step:'1' }).replace(`name=\"imageScale\"`, `name=\"imageScale\" data-crop-scale=\"${escapeAttr(key)}\"`)}<output data-scale-output="${escapeAttr(key)}">${number(item.imageScale, 100)}%</output></div>${poster ? selectField('Как показывать афишу', 'imageFit', item.imageFit || 'cover', [['cover','Заполнить карточку (кадрирование)'],['poster','Целая афиша без обрезки']]).replace(`name=\"imageFit\"`, `name=\"imageFit\" data-image-fit=\"${escapeAttr(key)}\"`) : ''}</div>`;

const galleryCropControls = (key, index, item) => {
  const cropKey = `${key}-gallery-${index}`;
  const control = (label, field, value, attribute) => `<label class="admin-field">${label}<input type="range" min="0" max="200" step="1" name="${field}-${index}" value="${number(value, field === 'galleryScale' ? 100 : 50)}" ${attribute}="${escapeAttr(cropKey)}"></label>`;
  return `<div class="crop-grid admin-gallery-item__crop">${control('Горизонт', 'galleryPositionX', item.imagePositionX, 'data-crop-x')}${control('Вертикаль', 'galleryPositionY', item.imagePositionY, 'data-crop-y')}${control('Масштаб', 'galleryScale', item.imageScale, 'data-crop-scale')}<output data-scale-output="${escapeAttr(cropKey)}">${number(item.imageScale, 100)}%</output></div>`;
};

const galleryEditor = (key, item) => {
  const gallery = Array.isArray(item.gallery) ? item.gallery.filter(entry => entry?.src) : [];
  const entries = gallery.map((entry, index) => {
    const cropKey = `${key}-gallery-${index}`;
    const isVideo = entry.type === 'video';
    const preview = isVideo
      ? `<video data-crop-preview="${escapeAttr(cropKey)}" src="${escapeAttr(entry.src)}"${entry.poster ? ` poster="${escapeAttr(entry.poster)}"` : ''} muted playsinline preload="metadata" style="${galleryCropStyle(entry)}" aria-label="${escapeAttr(entry.label || 'Видео')}"></video>`
      : `<img data-crop-preview="${escapeAttr(cropKey)}" src="${escapeAttr(entry.src)}" alt="" style="${galleryCropStyle(entry)}">`;
    return `<article class="admin-gallery-item"><div class="admin-gallery-preview ${isVideo ? 'is-video' : ''}">${preview}</div><div class="admin-gallery-item__fields">${formField('Подпись', `galleryLabel-${index}`, entry.label || '')}<label class="admin-check"><input type="checkbox" name="galleryRemove-${index}"> Убрать материал</label></div>${galleryCropControls(key, index, entry)}</article>`;
  }).join('');
  return `<section class="admin-gallery-editor"><header><div><h3>Дополнительные фото и видео</h3><p>Обложка карточки остаётся отдельно. Материалы ниже можно удалить, подписать и кадрировать.</p></div>${formField('Заголовок блока', 'galleryTitle', item.galleryTitle || 'Материалы программы')}</header>${entries ? `<div class="admin-gallery-grid">${entries}</div>` : '<p class="admin-gallery-editor__empty">Пока нет дополнительных материалов.</p>'}<label class="upload-field admin-gallery-editor__upload">Добавить фото или видео<input type="file" name="galleryMedia" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"><span>Фото JPG, PNG, WEBP или GIF → WebP; видео MP4, MOV, WebM · до 100 МБ</span></label></section>`;
};

const contentPhotoEditor = (key, title, content) => {
  const item = photoFromContent(content, key);
  return `<fieldset class="admin-photo-block"><legend>${escapeHtml(title)}</legend><div class="photo-editor" data-fit-preview="${escapeAttr(key)}"><div class="admin-photo-preview">${item.image ? `<img data-crop-preview="${escapeAttr(key)}" src="${escapeAttr(item.image)}" alt="" style="${cropStyle(item)}">` : '<i>Фото</i>'}</div><label class="upload-field">Заменить изображение<input type="file" name="${escapeAttr(key)}" accept="image/png,image/jpeg,image/webp,image/gif" data-photo-input="${escapeAttr(key)}"><span>JPG, PNG, WEBP или GIF → WebP</span></label><div class="crop-grid">${formField('Горизонт', `${key}PositionX`, number(item.imagePositionX), { type:'range', step:'1' }).replace(`name=\"${key}PositionX\"`, `name=\"${key}PositionX\" data-crop-x=\"${escapeAttr(key)}\"`)}${formField('Вертикаль', `${key}PositionY`, number(item.imagePositionY), { type:'range', step:'1' }).replace(`name=\"${key}PositionY\"`, `name=\"${key}PositionY\" data-crop-y=\"${escapeAttr(key)}\"`)}${formField('Масштаб', `${key}Scale`, number(item.imageScale, 100), { type:'range', step:'1' }).replace(`name=\"${key}Scale\"`, `name=\"${key}Scale\" data-crop-scale=\"${escapeAttr(key)}\"`)}<output data-scale-output="${escapeAttr(key)}">${number(item.imageScale, 100)}%</output></div></div></fieldset>`;
};

const adminSaveNotice = query => query?.deleted === '1'
  ? `<p class="admin-toast" role="status">Карточка удалена из каталога.</p>`
  : query?.saved === '1' ? `<p class="admin-toast" role="status">Сохранено. Изменения уже видны на сайте.</p>` : '';

const adminPreviewLink = (url, label = 'Открыть на сайте') => url
  ? `<a class="admin-preview-link" href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(label)} ↗</a>` : '';

const adminSaveBar = ({ previewUrl, submitLabel = 'Сохранить изменения' } = {}) => `<div class="admin-savebar" data-savebar><span data-save-status>Изменений нет</span><div><button class="admin-savebar__reset" type="button" data-reset-form hidden>Отменить</button>${adminPreviewLink(previewUrl, 'Посмотреть')}<button type="submit">${escapeHtml(submitLabel)}</button></div></div>`;

const pagePhotoGroup = (group, content) => `<details class="admin-editor-section admin-editor-section--photos" ${group.open === false ? '' : 'open'}><summary><span><strong>${escapeHtml(group.title)}</strong><small>${escapeHtml(group.description || 'Изменяйте только то, что видно в указанном месте сайта.')}</small></span><b aria-hidden="true">⌄</b></summary><div class="admin-photo-grid">${group.items.map(([key, label]) => contentPhotoEditor(key, label, content)).join('')}</div></details>`;

const adminPageConfig = {
  home: {
    active:'home', title:'Главная', eyebrow:'Страницы сайта',
    intro:'Здесь редактируется только главная: первый экран, плитки направлений и фотомозаика. Фото других страниц — в их разделах слева.',
    publicUrl:'/', adminUrl:'/admin/',
    hero:{ titleName:'heroTitle', introName:'heroIntro', title:'Первый экран', hint:'Главный заголовок и текст, который посетитель видит сразу после открытия сайта.' },
    photoGroups:[
      { title:'Первый экран', description:'Большая фотография на первом экране главной.', items:[['photo1','Главная → первое большое фото']] },
      { title:'Плитки направлений', description:'Карточки ниже первого экрана. Резервное фото будет видно, только если отдельная плитка не заполнена.', items:[
        ['homeBoyPhoto','Главная → плитка «Аниматор для мальчика»'],
        ['homeGirlPhoto','Главная → плитка «Аниматор для девочки» (сейчас используется резерв аниматоров)'],
        ['homeAdultShowPhoto','Главная → плитка «Шоу для взрослых» (сейчас используется главное фото шоу)'],
        ['homeFoamPhoto','Главная → плитка «Пенная вечеринка»'],
        ['homeTheaterPhoto','Главная → плитка «Спектакли к вам» (сейчас используется главное фото спектаклей)']
      ]},
      { title:'Фотомозаика «Живые эмоции»', description:'Три кадра ниже плиток на главной странице.', items:[
        ['photo5','Главная → мозаика, широкий кадр'],
        ['photo6','Главная → мозаика, вертикальный кадр'],
        ['photo7','Главная → мозаика, деталь']
      ]}
    ]
  },
  birthday: {
    active:'birthday', title:'День рождения', eyebrow:'Страницы сайта',
    intro:'Первый экран страницы дня рождения. Карточки «Аниматор», «Шоу» и «Спектакль» ниже используют общие фото из соответствующих разделов.',
    publicUrl:'/detskiy-den-rozhdeniya/', adminUrl:'/admin/birthday',
    hero:{ key:'birthday', title:'Первый экран', hint:'Каждая новая строка H1 станет новой строкой в дизайне.' },
    photoGroups:[{ title:'Первый экран', description:'Главная фотография страницы дня рождения.', items:[['photoBirthday','День рождения → первое большое фото']] }]
  },
  animatory: {
    active:'animatory-page', title:'Аниматоры — страница', eyebrow:'Страницы сайта',
    intro:'Первый экран каталога аниматоров и связанные резервные изображения на главной.',
    publicUrl:'/animatory/', adminUrl:'/admin/page/animatory',
    hero:{ key:'animatory', title:'Первый экран', hint:'Заголовок и подзаголовок страницы каталога аниматоров.' },
    photoGroups:[
      { title:'Главное фото', description:'Первый экран аниматоров, карточка «Аниматор» на дне рождения и резерв на главной.', items:[['animatoryPhoto1','Аниматоры → первый экран и связанные карточки']] },
      { title:'Резерв на главной', description:'Появится в плитке «Аниматор для девочки», если там не загружено отдельное фото.', items:[['animatoryPhoto2','Главная → резерв для плитки «Аниматор для девочки»']] },
      { title:'Резерв', description:'Это фото пока нигде не используется и не видно посетителям.', open:false, items:[['animatoryPhoto4','Резерв → пока не показывается на сайте']] }
    ]
  },
  homeAnimator: {
    active:'home-animator', title:'Аниматор на дом', eyebrow:'Страницы сайта',
    intro:'Первый экран страницы «Аниматор на дом»: заголовок, описание и фотография.',
    publicUrl:'/animatory-na-dom/', adminUrl:'/admin/page/home-animator',
    hero:{ key:'homeAnimator', title:'Первый экран', hint:'Заголовок и описание страницы «Аниматор на дом».' },
    photoGroups:[{ title:'Первый экран', description:'Главная фотография страницы «Аниматор на дом».', items:[['animatoryPhoto3','Аниматор на дом → первое большое фото']] }]
  },
  show: {
    active:'show-page', title:'Шоу — страница', eyebrow:'Страницы сайта',
    intro:'Первый экран каталога шоу и резервные изображения, которые могут подхватываться на главной.',
    publicUrl:'/show/', adminUrl:'/admin/page/show',
    hero:{ key:'show', title:'Первый экран', hint:'Заголовок и подзаголовок страницы шоу.' },
    photoGroups:[
      { title:'Главное фото', description:'Первый экран шоу, карточка на дне рождения и резерв на главной.', items:[['showPhoto1','Шоу → первый экран и связанные карточки']] },
      { title:'Резерв пенной вечеринки', description:'Покажется на главной только если для плитки «Пенная вечеринка» нет отдельного фото.', items:[['showPhoto2','Главная → резерв для плитки «Пенная вечеринка»']] },
      { title:'Резерв', description:'Эти фото сейчас нигде не используются и не видны посетителям.', open:false, items:[['showPhoto3','Резерв → пока не показывается на сайте'],['showPhoto4','Резерв → пока не показывается на сайте']] }
    ]
  },
  theater: {
    active:'theater-page', title:'Спектакли — страница', eyebrow:'Страницы сайта',
    intro:'Первый экран каталога спектаклей и резервные изображения.',
    publicUrl:'/spektakli/', adminUrl:'/admin/page/theater',
    hero:{ key:'theater', title:'Первый экран', hint:'Заголовок и подзаголовок страницы спектаклей.' },
    photoGroups:[
      { title:'Главное фото', description:'Первый экран спектаклей, карточка на дне рождения и резерв на главной.', items:[['theaterPhoto1','Спектакли → первый экран и связанные карточки']] },
      { title:'Резерв', description:'Эти фото сейчас нигде не используются и не видны посетителям.', open:false, items:[['theaterPhoto2','Резерв → пока не показывается на сайте'],['theaterPhoto3','Резерв → пока не показывается на сайте'],['theaterPhoto4','Резерв → пока не показывается на сайте']] }
    ]
  }
};

const renderPageHeroFields = (config, content) => {
  if (!config.hero) return '';
  const titleName = config.hero.key ? `${config.hero.key}HeroTitle` : config.hero.titleName;
  const introName = config.hero.key ? `${config.hero.key}HeroIntro` : config.hero.introName;
  const current = config.hero.key ? pageHeroCopy(content, config.hero.key) : { lines:[content[titleName] || ''], intro:content[introName] || '' };
  return `<section class="admin-editor-card"><header><span>${escapeHtml(config.hero.title)}</span><h2>Что увидят на первом экране</h2><p>${escapeHtml(config.hero.hint)}</p></header><div class="admin-grid">${formField(config.hero.key ? 'H1 — каждая строка с новой строки' : 'H1', titleName, current.lines.join('\n'), { textarea:Boolean(config.hero.key), wide:true, required:true })}${formField(config.hero.key ? 'Описание под H1' : 'Подзаголовок', introName, current.intro, { textarea:true, wide:true, required:true })}</div></section>`;
};

const renderAdminPage = async (key, query = {}) => {
  const config = adminPageConfig[key];
  if (!config) throw new Error('Страница админки не найдена');
  const content = await loadContent();
  const body = `<header class="admin-page-head"><div><span>${escapeHtml(config.eyebrow)}</span><h1>${escapeHtml(config.title)}</h1><p>${escapeHtml(config.intro)}</p></div>${adminPreviewLink(config.publicUrl, 'Открыть страницу')}</header>${adminSaveNotice(query)}<form class="admin-content-form admin-edit-form" method="post" action="/admin/content" enctype="multipart/form-data" data-admin-form><input type="hidden" name="redirectTo" value="${escapeAttr(config.adminUrl)}">${renderPageHeroFields(config, content)}<section class="admin-edit-guide"><span>Как это работает</span><p>Замените фото при необходимости и сразу проверьте кадрирование в предпросмотре. Сохранение применит только изменения этой страницы.</p></section>${config.photoGroups.map(group => pagePhotoGroup(group, content)).join('')}${adminSaveBar({ previewUrl:config.publicUrl })}</form>`;
  return adminLayout(config.title, body, config.active);
};

const renderAdminContent = query => renderAdminPage('home', query);
const renderAdminBirthday = query => renderAdminPage('birthday', query);

const renderAdminHeroCart = async (query = {}) => {
  const settings = heroCartSettings(await loadContent());
  const body = `<header class="admin-page-head"><div><span>Продажи</span><h1>Акция второго героя</h1><p>Это предложение клиент увидит после выбора первого аниматора. Здесь меняются только настройки акции.</p></div>${adminPreviewLink('/animatory/', 'Посмотреть каталог')}</header>${adminSaveNotice(query)}<form class="admin-content-form admin-edit-form" method="post" action="/admin/cart" data-admin-form><section class="admin-editor-card"><header><span>Настройки акции</span><h2>Второй герой со скидкой</h2><p>Доплата прибавляется к цене первого героя на выбранный день.</p></header><div class="admin-panel__top"><label class="admin-check"><input type="checkbox" name="heroCartUpsellEnabled" ${settings.enabled ? 'checked' : ''}> Показывать предложение на сайте</label></div><div class="admin-grid">${formField('Цена второго героя, ₽', 'heroCartSecondHeroPrice', settings.secondHeroPrice, { type:'number', step:'1', required:true })}${formField('Заголовок акции', 'heroCartPromoTitle', settings.promoTitle, { required:true, wide:true })}${formField('Текст под заголовком', 'heroCartPromoDescription', settings.promoDescription, { textarea:true, wide:true })}</div></section>${adminSaveBar({ previewUrl:'/animatory/', submitLabel:'Сохранить акцию' })}</form>`;
  return adminLayout('Акция второго героя', body, 'cart');
};

const catalogTitles = { heroes:'Аниматоры', shows:'Шоу', plays:'Спектакли', events:'Афиша' };
const catalogPageIntro = {
  heroes:'Добавляйте и редактируйте карточки аниматоров. Первый экран страницы настраивается отдельно в разделе «Аниматоры — первый экран».',
  shows:'Добавляйте и редактируйте шоу. Первый экран страницы настраивается отдельно в разделе «Шоу — первый экран».',
  plays:'Добавляйте и редактируйте спектакли. Первый экран страницы настраивается отдельно в разделе «Спектакли — первый экран».',
  events:'Добавляйте мероприятия в афишу. Каждая карточка открывается в отдельной редакторской странице.'
};

const catalogPublicUrl = (type, item) => {
  if (!item || item.published === false) return '';
  if (type === 'heroes') return `/animatory/${item.slug}/`;
  if (type === 'shows') return `/show/${item.slug}/`;
  if (type === 'events') return `/afisha/${item.slug}/`;
  return '/spektakli/';
};

const catalogEditorSection = (title, description, body, open = true) => `<details class="admin-editor-section" ${open ? 'open' : ''}><summary><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span><b aria-hidden="true">⌄</b></summary><div class="admin-editor-section__body">${body}</div></details>`;

const showHeroOfferEditor = (show, heroes) => {
  const offers = new Map((Array.isArray(show.heroOffers) ? show.heroOffers : []).map(offer => [offer.heroId, offer]));
  const availableHeroes = heroes.filter(visible);
  const rows = availableHeroes.length
    ? availableHeroes.map((hero, index) => {
      const offer = offers.get(hero.id) || {};
      const prices = heroPrices(hero);
      const active = Boolean(offers.get(hero.id));
      return `<article class="admin-show-hero-offer"><label class="admin-check admin-show-hero-offer__toggle"><input type="checkbox" name="heroOfferIds" value="${escapeAttr(hero.id)}" ${active ? 'checked' : ''}> <span><strong>${escapeHtml(hero.name)}</strong><small>По умолчанию: будни ${formatPrice(prices.weekday)} · выходные ${formatPrice(prices.weekend)}</small></span></label><div class="admin-grid admin-show-hero-offer__fields">${formField('Подпись в корзине (необязательно)', `heroOfferLabel-${hero.id}`, offer.label || '', { wide:true })}${formField('Будни, ₽', `heroOfferWeekday-${hero.id}`, offer.weekdayPrice ?? prices.weekday, { type:'number', step:'1' })}${formField('Выходные, ₽', `heroOfferWeekend-${hero.id}`, offer.weekendPrice ?? prices.weekend, { type:'number', step:'1' })}${formField('Порядок', `heroOfferPosition-${hero.id}`, offer.position ?? index + 1, { type:'number', step:'1' })}</div></article>`;
    }).join('')
    : '<p class="admin-empty">Сначала добавьте хотя бы одного видимого аниматора в каталоге.</p>';
  return catalogEditorSection('Аниматоры к шоу', 'Выберите только подходящих персонажей. Для взрослой программы выключите предложение целиком.', `<div class="admin-panel__top"><label class="admin-check"><input type="checkbox" name="heroUpsellEnabled" ${show.heroUpsellEnabled === true ? 'checked' : ''}> Предлагать аниматора после выбора шоу</label></div><div class="admin-grid">${formField('Заголовок предложения', 'heroOfferTitle', show.heroOfferTitle || 'Добавьте любимого героя', { wide:true })}${formField('Текст предложения', 'heroOfferDescription', show.heroOfferDescription || 'Аниматор встретит гостей и сделает праздник ещё насыщеннее.', { textarea:true, wide:true })}</div><div class="admin-show-hero-offer-list">${rows}</div>`);
};

const catalogForm = (type, item = {}, heroes = []) => {
  const hero = type === 'heroes';
  const show = type === 'shows';
  const play = type === 'plays';
  const event = type === 'events';
  const noun = hero ? 'аниматора' : show ? 'шоу' : play ? 'спектакль' : 'событие';
  const title = item.name || item.title || '';
  const name = formField(hero || show || event ? 'Название' : 'Название спектакля', 'name', title, { required:true, wide:true }).replace('name="name"', 'name="name" data-title');
  const slug = !play ? formField('Адрес страницы', 'slug', item.slug || '', { wide:true }).replace('name="slug"', 'name="slug" data-slug') : '';
  let basic = name + slug;
  let settings = '';
  let seo = '';

  if (event) {
    basic += formField('Описание', 'description', item.description || '', { textarea:true, wide:true });
    settings = formField('Дата', 'date', item.date || '', { type:'date' })
      + formField('Категория', 'category', item.category || 'Событие')
      + formField('Надпись на кнопке', 'buttonLabel', item.buttonLabel || 'Открыть афишу')
      + formField('Ссылка кнопки (необязательно)', 'buttonUrl', item.buttonUrl || '');
  } else {
    basic += formField('Описание', 'description', item.description || '', { textarea:true, wide:true });
    if (hero) {
      settings = formField('Длительность, минут', 'duration', item.duration || 40, { type:'number', step:'1' })
        + selectField('Для кого', 'audience', item.audience || 'all', [['all','Для всех'],['boys','Для мальчиков'],['girls','Для девочек']])
        + formField('Цена в будни, ₽', 'priceWeekday', item.priceWeekday ?? item.price ?? '', { type:'number', step:'1', required:true })
        + formField('Цена в выходные, ₽', 'priceWeekend', item.priceWeekend ?? item.price ?? '', { type:'number', step:'1', required:true });
    } else if (play) {
      settings = formField('Возраст', 'age', item.age || '3+') + formField('Цена, ₽ (необязательно)', 'price', item.price || '', { type:'number', step:'1' });
    } else {
      settings = formField('Цена, ₽', 'price', item.price || '', { type:'number', step:'1', required:true });
    }
    if (!play) seo = formField('Заголовок для поиска', 'seoTitle', item.seoTitle || '', { wide:true })
      + formField('Описание для поиска', 'seoDescription', item.seoDescription || '', { textarea:true, wide:true });
  }

  const status = item.published !== false ? 'Карточка видна посетителям.' : 'Карточка скрыта: её видите только вы в админке.';
  return `<input type="hidden" name="id" value="${escapeAttr(item.id || '')}"><section class="admin-editor-card"><header><span>Карточка каталога</span><h2>${item.id ? `Редактировать: ${escapeHtml(title || noun)}` : `Новая карточка`}</h2><p>${status}</p></header><div class="admin-publish-row">${visibilityField(item.published)}<span>${item.published !== false ? 'На сайте' : 'Скрыто'}</span></div><div class="admin-grid">${basic}</div></section>${settings ? catalogEditorSection('Цена и параметры', 'Данные, которые будут показаны в карточке и используются при заявке.', `<div class="admin-grid">${settings}</div>`) : ''}${show ? showHeroOfferEditor(item, heroes) : ''}${catalogEditorSection('Обложка и кадрирование', 'Главное изображение карточки. Сначала загрузите фото, затем настройте положение и масштаб.', mediaEditor(`${type}-${item.id || 'new'}`, item, { poster:event }))}${show || play ? catalogEditorSection('Фото и видео программы', 'До 8 новых файлов за раз и до 12 материалов в карточке. Фото и видео появятся после сохранения.', galleryEditor(`${type}-${item.id || 'new'}`, item)) : ''}${seo ? catalogEditorSection('Поисковая выдача', 'Необязательно. Если оставить пустым, сайт подставит название и описание карточки.', `<div class="admin-grid">${seo}</div>`, false) : ''}`;
};

const catalogItemCard = (type, item) => {
  const title = item.name || item.title || 'Без названия';
  const prices = type === 'heroes' ? heroPrices(item) : null;
  const price = type === 'heroes'
    ? `будни ${formatPrice(prices.weekday)} · выходные ${formatPrice(prices.weekend)}`
    : Number(item.price) ? `от ${formatPrice(item.price)}` : '';
  const meta = [item.age, type === 'heroes' && item.duration ? `${item.duration} мин` : '', price].filter(Boolean).join(' · ');
  const media = item.image ? `<img src="${escapeAttr(item.image)}" alt="" style="${cropStyle(item)}">` : '<span>Нет фото</span>';
  const preview = catalogPublicUrl(type, item);
  return `<article class="admin-catalog-row"><span class="admin-catalog-item__media">${media}</span><div class="admin-catalog-item__copy"><small>${escapeHtml(meta || 'Карточка каталога')}</small><strong>${escapeHtml(title)}</strong></div><span class="admin-catalog-item__status ${item.published !== false ? 'is-live' : ''}">${item.published !== false ? 'На сайте' : 'Скрыто'}</span><div class="admin-catalog-row__actions"><a class="admin-row-action" href="/admin/catalog/${escapeAttr(type)}/edit/${escapeAttr(item.id)}">Редактировать</a>${preview ? adminPreviewLink(preview, 'Открыть') : '<span class="admin-row-muted">Скрыто</span>'}</div></article>`;
};

const renderAdminCatalog = async (type, query = {}) => {
  const title = catalogTitles[type];
  const items = await loadCatalog(type);
  const pageKey = { heroes:'animatory', shows:'show', plays:'theater' }[type];
  const pageLink = pageKey ? `<aside class="admin-linked-page"><div><span>Связанная страница</span><strong>Первый экран настраивается отдельно</strong><p>Текст и общая фотография каталога не смешаны с карточками.</p></div><a href="${escapeAttr(adminPageConfig[pageKey].adminUrl)}">Открыть первый экран →</a></aside>` : '';
  const body = `<header class="admin-page-head"><div><span>Каталог</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(catalogPageIntro[type])}</p></div><a class="admin-primary-link" href="/admin/catalog/${escapeAttr(type)}/new">+ Добавить</a></header>${adminSaveNotice(query)}${pageLink}<section class="admin-catalog-list" aria-label="${escapeAttr(title)}">${items.length ? items.map(item => catalogItemCard(type, item)).join('') : '<p class="admin-empty">Пока нет карточек. Добавьте первую.</p>'}</section>`;
  return adminLayout(title, body, type);
};

const renderAdminCatalogEditor = async (type, id, query = {}) => {
  const [items, heroes] = await Promise.all([loadCatalog(type), type === 'shows' ? loadCatalog('heroes') : Promise.resolve([])]);
  const isNew = id === 'new';
  const item = isNew ? { published:true } : items.find(entry => entry.id === id);
  if (!item) throw new Error('Карточка не найдена');
  const title = item.name || item.title || 'Новая карточка';
  const preview = catalogPublicUrl(type, item);
  const body = `<header class="admin-page-head admin-page-head--editor"><div><a class="admin-back-link" href="/admin/catalog/${escapeAttr(type)}">← Все карточки</a><span>Каталог</span><h1>${escapeHtml(isNew ? `Новая карточка` : title)}</h1><p>Заполните главное, загрузите обложку и при необходимости добавьте материалы. Поля для поиска спрятаны в отдельный блок.</p></div>${preview ? adminPreviewLink(preview, 'Открыть на сайте') : ''}</header>${adminSaveNotice(query)}<form class="admin-catalog-form admin-edit-form" method="post" action="/admin/catalog/${escapeAttr(type)}/save" enctype="multipart/form-data" data-admin-form>${catalogForm(type, item, heroes)}${adminSaveBar({ previewUrl:preview, submitLabel:isNew ? 'Создать карточку' : 'Сохранить изменения' })}${isNew ? '' : `<div class="admin-delete-zone"><span>Опасная зона</span><p>Удаление уберёт карточку из каталога. Загруженные файлы сохранятся на сервере.</p><button class="admin-danger" type="submit" formaction="/admin/catalog/${escapeAttr(type)}/delete" formnovalidate onclick="return confirm('Удалить карточку?')">Удалить карточку</button></div>`}</form>`;
  return adminLayout(isNew ? `Новая карточка · ${catalogTitles[type]}` : title, body, type);
};

const updateGallery = (source, body, files = []) => {
  const existing = Array.isArray(source.gallery) ? source.gallery.filter(entry => entry?.src) : [];
  const kept = existing.map((entry, index) => {
    if (truthy(body[`galleryRemove-${index}`])) return null;
    return {
      ...entry,
      type: entry.type === 'video' ? 'video' : 'image',
      label: String(body[`galleryLabel-${index}`] ?? entry.label ?? '').trim().slice(0, 120),
      imagePositionX: number(body[`galleryPositionX-${index}`], entry.imagePositionX ?? 50),
      imagePositionY: number(body[`galleryPositionY-${index}`], entry.imagePositionY ?? 50),
      imageScale: number(body[`galleryScale-${index}`], entry.imageScale ?? 100)
    };
  }).filter(Boolean);
  const added = files.filter(file => isImageMime(file.mimetype) || isVideoMime(file.mimetype)).map(file => {
    const type = isVideoMime(file.mimetype) ? 'video' : 'image';
    return {
      type,
      src: `/uploads/${file.filename}`,
      ...(type === 'video' ? { mime:file.mimetype } : {}),
      alt: type === 'video' ? 'Видео программы' : 'Фото программы',
      label: type === 'video' ? 'Видео' : 'Фото',
      imagePositionX: 50,
      imagePositionY: 50,
      imageScale: 100
    };
  });
  const gallery = [...kept, ...added];
  if (gallery.length > 12) throw new Error('В карточке может быть максимум 12 фото и видео. Уберите лишнее и сохраните ещё раз.');
  return gallery;
};

const updateCatalogItem = (type, oldItem, body, uploadedFile, galleryFiles = []) => {
  const name = String(body.name || '').trim();
  const itemsPromise = loadCatalog(type);
  const heroesPromise = type === 'shows' ? loadCatalog('heroes') : Promise.resolve([]);
  return Promise.all([itemsPromise, heroesPromise]).then(([items, heroes]) => {
    const source = oldItem || {};
    const supportsGallery = type === 'shows' || type === 'plays';
    const gallery = supportsGallery ? updateGallery(source, body, galleryFiles) : source.gallery;
    const base = {
      ...source,
      id: source.id || crypto.randomUUID(),
      published: truthy(body.published),
      image: uploadedFile ? `/uploads/${uploadedFile.filename}` : (source.image || ''),
      imagePositionX: number(body.imagePositionX, source.imagePositionX ?? 50),
      imagePositionY: number(body.imagePositionY, source.imagePositionY ?? 50),
      imageScale: number(body.imageScale, source.imageScale ?? 100),
      updatedAt: now(),
      createdAt: source.createdAt || now(),
      ...(supportsGallery ? {
        gallery,
        galleryTitle: String(body.galleryTitle ?? source.galleryTitle ?? 'Материалы программы').trim().slice(0, 120) || 'Материалы программы'
      } : {})
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
      description: String(body.description || '').trim(), duration: Math.max(1, Math.round(number(body.duration, 40))),
      price: priceNumber(body.priceWeekday, source.priceWeekday ?? source.price ?? 0),
      priceWeekday: priceNumber(body.priceWeekday, source.priceWeekday ?? source.price ?? 0),
      priceWeekend: priceNumber(body.priceWeekend, source.priceWeekend ?? source.price ?? 0),
      audience: ['all','boys','girls'].includes(body.audience) ? body.audience : 'all', accent: body.accent || source.accent || 'yellow',
      seoTitle: String(body.seoTitle || '').trim(), seoDescription: String(body.seoDescription || '').trim()
    };
    if (type === 'shows') {
      const selectedHeroIds = [...new Set((Array.isArray(body.heroOfferIds) ? body.heroOfferIds : [body.heroOfferIds]).filter(Boolean).map(String))];
      const heroById = new Map(heroes.filter(visible).map(hero => [hero.id, hero]));
      const heroOffers = selectedHeroIds
        .map((heroId, index) => {
          const hero = heroById.get(heroId);
          if (!hero) return null;
          const prices = heroPrices(hero);
          return {
            heroId,
            label: String(body[`heroOfferLabel-${heroId}`] || '').trim().slice(0, 120),
            weekdayPrice: priceNumber(body[`heroOfferWeekday-${heroId}`], prices.weekday),
            weekendPrice: priceNumber(body[`heroOfferWeekend-${heroId}`], prices.weekend),
            position: Math.max(1, Math.round(number(body[`heroOfferPosition-${heroId}`], index + 1)))
          };
        })
        .filter(Boolean)
        .sort((first, second) => first.position - second.position || first.heroId.localeCompare(second.heroId));
      return {
        ...base, name, slug: uniqueSlug(body.slug || `${name}-kemerovo`, items, base.id), description: String(body.description || '').trim(),
        price: priceNumber(body.price, source.price ?? 0), accent: body.accent || source.accent || 'cyan', seoTitle: String(body.seoTitle || '').trim(), seoDescription: String(body.seoDescription || '').trim(),
        heroUpsellEnabled: truthy(body.heroUpsellEnabled),
        heroOfferTitle: String(body.heroOfferTitle || 'Добавьте любимого героя').trim().slice(0, 120),
        heroOfferDescription: String(body.heroOfferDescription || 'Аниматор встретит гостей и сделает праздник ещё насыщеннее.').trim().slice(0, 280),
        heroOffers
      };
    }
    return {
      ...base, name, slug: uniqueSlug(body.slug || name, items, base.id), description: String(body.description || '').trim(),
      age: String(body.age || '3+').trim(), price: priceNumber(body.price, source.price ?? 0), accent: body.accent || source.accent || 'violet'
    };
  });
};

let smtpTransport;
const trySendEmail = async lead => {
  if (!smtpHost || !smtpUser || !smtpPassword || !smtpFrom || !smtpTo) return;
  try {
    smtpTransport ||= nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user:smtpUser, pass:smtpPassword }
    });
    await smtpTransport.sendMail({
      from: smtpFrom,
      to: smtpTo,
      subject: `Новая заявка с сайта ${brandName}`,
      text: [`Имя: ${lead.name}`, `Телефон: ${lead.phone}`, `Услуга: ${lead.service || '—'}`, `Сообщение: ${lead.message || '—'}`, `Время: ${lead.createdAt}`].join('\n')
    });
  } catch (error) {
    console.error('Не удалось отправить заявку по SMTP:', error.message);
  }
};

app.get('/health', (_req, res) => res.json({ ok:true }));
app.get('/brand-logo.svg', async (_req, res, next) => {
  try {
    const svg = await fs.readFile(path.join(logoDir, 'image.svg'), 'utf8');
    res.type('image/svg+xml').send(svg
      .replace('width="1254" height="1254" viewBox="0 0 1254 1254"', 'width="1060" height="710" viewBox="100 300 1060 710"')
      .replace('<path fill="#FEFEFD" d="M0 0L1254 0L1254 1254L0 1254L0 0Z"/>', ''));
  } catch (error) { next(error); }
});
app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: Yandex\nDisallow: /admin/\nAllow: /\nSitemap: ${new URL('/sitemap.xml', siteUrl).href}\n`));
app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const [heroes, shows, events] = await Promise.all([loadCatalog('heroes'), loadCatalog('shows'), loadCatalog('events')]);
    const paths = ['/', '/privacy/', '/consent/', '/animatory/', '/animatory-na-dom/', '/detskiy-den-rozhdeniya/', '/show/', '/spektakli/', '/afisha/', ...heroes.filter(visible).map(item => `/animatory/${item.slug}/`), ...shows.filter(visible).map(item => `/show/${item.slug}/`), ...events.filter(visible).map(item => `/afisha/${item.slug}/`)];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(item => `<url><loc>${escapeHtml(`${siteUrl}${item}`)}</loc></url>`).join('')}</urlset>`);
  } catch (error) { next(error); }
});

app.post('/api/leads', async (req, res, next) => {
  try {
    if (String(req.body.website || '').trim()) return res.status(400).json({ error:'Не удалось отправить заявку. Попробуйте ещё раз.' });
    const leadRetryAfter = retryAfter('lead', req, leadLimit);
    if (leadRetryAfter) {
      res.setHeader('Retry-After', String(leadRetryAfter));
      return res.status(429).json({ error:`Слишком много заявок. Повторите через ${Math.ceil(leadRetryAfter / 60)} мин.` });
    }
    recordRateLimitAttempt('lead', req, leadLimit);
    const name = String(req.body.name || '').trim().slice(0, 100);
    const phone = String(req.body.phone || '').trim().slice(0, 60);
    const service = String(req.body.service || '').trim().slice(0, 160);
    const message = String(req.body.message || '').trim().slice(0, 1000);
    const phoneDigits = phone.replace(/\D/g, '');
    if (!name || phoneDigits.length < 10 || phoneDigits.length > 15 || !truthy(req.body.consent)) return res.status(400).json({ error:'Укажите имя, корректный телефон и согласие на обработку данных.' });
    const consentAt = now();
    const lead = {
      id:crypto.randomUUID(),
      createdAt:consentAt,
      retentionUntil:retentionEndsAt(consentAt),
      retentionRule:`${leadRetentionDays} days from submission`,
      name,
      phone,
      service,
      message,
      source:'website',
      consent:true,
      consentAt,
      consentVersion:personalDataConsentVersion,
      consentDocument:'Согласие на обработку персональных данных',
      consentDocumentUrl:`${siteUrl}/consent/`,
      privacyPolicyVersion,
      privacyPolicyUrl:`${siteUrl}/privacy/`,
      consentMethod:'required-checkbox'
    };
    await appendLead(lead);
    void trySendEmail(lead);
    res.status(201).json({ ok:true, message:'Заявка отправлена. Скоро свяжемся с вами!' });
  } catch (error) { next(error); }
});

app.get('/admin/login', (req, res) => isAdmin(req) ? res.redirect('/admin/') : res.send(adminLogin(req.query.error)));
app.post('/admin/login', (req, res) => {
  const loginRetryAfter = retryAfter('login', req, loginLimit);
  if (loginRetryAfter) {
    res.setHeader('Retry-After', String(loginRetryAfter));
    return res.status(429).send(adminLogin(`Слишком много попыток. Повторите через ${Math.ceil(loginRetryAfter / 60)} мин.`));
  }
  const attemptedUsername = String(req.body.username || '').trim();
  const attempted = String(req.body.password || '');
  const validCredentials = secureMatch(attemptedUsername, adminUsername) & secureMatch(attempted, adminPassword);
  if (!validCredentials) {
    recordRateLimitAttempt('login', req, loginLimit);
    return res.redirect('/admin/login?error=Неверный+логин+или+пароль');
  }
  clearRateLimitAttempts('login', req);
  res.setHeader('Set-Cookie', `tema_admin=${sessionValue()}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}; Max-Age=604800`);
  res.redirect('/admin/');
});
app.post('/admin/logout', (_req, res) => { res.setHeader('Set-Cookie', 'tema_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); res.redirect('/admin/login'); });
app.get('/admin/', requireAdmin, async (req, res, next) => { try { res.send(await renderAdminContent(req.query)); } catch (error) { next(error); } });
app.get('/admin/birthday', requireAdmin, async (req, res, next) => { try { res.send(await renderAdminBirthday(req.query)); } catch (error) { next(error); } });
app.get('/admin/page/:page', requireAdmin, async (req, res, next) => {
  const pageKey = { animatory:'animatory', 'home-animator':'homeAnimator', show:'show', theater:'theater' }[req.params.page];
  if (!pageKey) return res.status(404).send('Страница админки не найдена');
  try { res.send(await renderAdminPage(pageKey, req.query)); } catch (error) { next(error); }
});
app.get('/admin/cart', requireAdmin, async (req, res, next) => { try { res.send(await renderAdminHeroCart(req.query)); } catch (error) { next(error); } });
app.get('/admin/catalog/:type/new', requireAdmin, async (req, res, next) => {
  if (!['heroes','shows','plays','events'].includes(req.params.type)) return res.status(404).send('Каталог не найден');
  try { res.send(await renderAdminCatalogEditor(req.params.type, 'new', req.query)); } catch (error) { next(error); }
});
app.get('/admin/catalog/:type/edit/:id', requireAdmin, async (req, res, next) => {
  if (!['heroes','shows','plays','events'].includes(req.params.type)) return res.status(404).send('Каталог не найден');
  try { res.send(await renderAdminCatalogEditor(req.params.type, req.params.id, req.query)); } catch (error) { next(error); }
});
app.get('/admin/catalog/:type', requireAdmin, async (req, res, next) => {
  if (!['heroes','shows','plays','events'].includes(req.params.type)) return res.status(404).send('Каталог не найден');
  try { res.send(await renderAdminCatalog(req.params.type, req.query)); } catch (error) { next(error); }
});

app.post('/admin/content', requireAdmin, upload.any(), async (req, res, next) => {
  const allUploaded = req.files || [];
  try {
    await convertUploadedImagesToWebp(allUploaded);
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
    const inputFiles = new Map(allUploaded.map(file => [file.fieldname, file]));
    for (const key of ['photo1','homeBoyPhoto','homeGirlPhoto','homeAdultShowPhoto','homeFoamPhoto','homeTheaterPhoto','photo5','photo6','photo7','photoBirthday','animatoryPhoto1','animatoryPhoto2','animatoryPhoto3','animatoryPhoto4','showPhoto1','showPhoto2','showPhoto3','showPhoto4','theaterPhoto1','theaterPhoto2','theaterPhoto3','theaterPhoto4']) {
      const file = inputFiles.get(key);
      if (file) nextContent[key] = `/uploads/${file.filename}`;
      nextContent[`${key}PositionX`] = number(req.body[`${key}PositionX`], previous[`${key}PositionX`] ?? 50);
      nextContent[`${key}PositionY`] = number(req.body[`${key}PositionY`], previous[`${key}PositionY`] ?? 50);
      nextContent[`${key}Scale`] = number(req.body[`${key}Scale`], previous[`${key}Scale`] ?? 100);
    }
    await writeJson(files.content, nextContent);
    const requestedRedirect = String(req.body.redirectTo || '');
    const redirectTo = Object.values(adminPageConfig).some(config => config.adminUrl === requestedRedirect) ? requestedRedirect : '/admin/';
    res.redirect(`${redirectTo}?saved=1`);
  } catch (error) { await Promise.all(allUploaded.map(deleteUploaded)); next(error); }
});
app.post('/admin/cart', requireAdmin, async (req, res, next) => {
  try {
    const previous = await loadContent();
    const defaults = heroCartSettings(previous);
    await writeJson(files.content, {
      ...previous,
      heroCartUpsellEnabled: truthy(req.body.heroCartUpsellEnabled),
      heroCartSecondHeroPrice: priceNumber(req.body.heroCartSecondHeroPrice, defaults.secondHeroPrice),
      heroCartPromoTitle: String(req.body.heroCartPromoTitle || defaults.promoTitle).trim().slice(0, 120),
      heroCartPromoDescription: String(req.body.heroCartPromoDescription || defaults.promoDescription).trim().slice(0, 280)
    });
    res.redirect('/admin/cart?saved=1');
  } catch (error) { next(error); }
});
app.post('/admin/catalog/:type/save', requireAdmin, upload.fields([{ name:'image', maxCount:1 }, { name:'galleryMedia', maxCount:8 }]), async (req, res, next) => {
  const type = req.params.type;
  const uploaded = req.files || {};
  const uploadedCover = uploaded.image?.[0];
  const uploadedGallery = uploaded.galleryMedia || [];
  const allUploaded = [uploadedCover, ...uploadedGallery].filter(Boolean);
  if (!['heroes','shows','plays','events'].includes(type)) { await Promise.all(allUploaded.map(deleteUploaded)); return res.status(404).send('Каталог не найден'); }
  try {
    await convertUploadedImagesToWebp(allUploaded);
    const items = await loadCatalog(type);
    const current = items.find(item => item.id === req.body.id);
    if (req.body.id && !current) { await Promise.all(allUploaded.map(deleteUploaded)); return res.status(404).send('Карточка не найдена'); }
    const updated = await updateCatalogItem(type, current, req.body, uploadedCover, uploadedGallery);
    if (!updated.name && !updated.title) { await Promise.all(allUploaded.map(deleteUploaded)); return res.status(400).send('Укажите название'); }
    await saveCatalog(type, current ? items.map(item => item.id === current.id ? updated : item) : [...items, updated]);
    res.redirect(`/admin/catalog/${type}/edit/${updated.id}?saved=1`);
  } catch (error) { await Promise.all(allUploaded.map(deleteUploaded)); next(error); }
});
app.post('/admin/catalog/:type/delete', requireAdmin, async (req, res, next) => {
  const type = req.params.type;
  if (!['heroes','shows','plays','events'].includes(type)) return res.status(404).send('Каталог не найден');
  try { const items = await loadCatalog(type); await saveCatalog(type, items.filter(item => item.id !== req.body.id)); res.redirect(`/admin/catalog/${type}?deleted=1`); } catch (error) { next(error); }
});

app.get('/privacy/', (_req, res) => res.send(privacyPage()));
app.get('/consent/', (_req, res) => res.send(consentPage()));
app.get('/', async (_req, res, next) => { try { res.send(await renderHome()); } catch (error) { next(error); } });
app.get('/animatory/', async (_req, res, next) => { try { res.send(await renderAnimators()); } catch (error) { next(error); } });
app.get('/animatory-na-dom/', async (_req, res, next) => { try { res.send(await renderHomeAnimator()); } catch (error) { next(error); } });
app.get('/detskiy-den-rozhdeniya/', async (_req, res, next) => { try { res.send(await renderBirthday()); } catch (error) { next(error); } });
app.get('/show/', async (_req, res, next) => { try { res.send(await renderShow()); } catch (error) { next(error); } });
app.get('/spektakli/', async (_req, res, next) => { try { res.send(await renderPlays()); } catch (error) { next(error); } });
app.get('/afisha/', async (_req, res, next) => { try { res.send(await renderAfisha()); } catch (error) { next(error); } });
app.get('/animatory/:slug/', async (req, res, next) => { try { const item = (await loadCatalog('heroes')).find(hero => hero.slug === req.params.slug && visible(hero)); if (!item) return res.status(404).send('Программа не найдена'); res.send(renderServiceDetail({ item, type:'heroes' })); } catch (error) { next(error); } });
app.get('/show/:slug/', async (req, res, next) => { try { const [shows, heroes] = await Promise.all([loadCatalog('shows'), loadCatalog('heroes')]); const item = shows.find(show => show.slug === req.params.slug && visible(show)); if (!item) return res.status(404).send('Шоу не найдено'); res.send(renderServiceDetail({ item, type:'shows', showCart:showCartDialog([item], heroes) })); } catch (error) { next(error); } });
app.get('/afisha/:slug/', async (req, res, next) => { try { const item = (await loadCatalog('events')).find(event => event.slug === req.params.slug && visible(event)); if (!item) return res.status(404).send('Афиша не найдена'); res.send(renderEventDetail(item)); } catch (error) { next(error); } });

app.use((req, res) => res.status(404).send(layout(pageMeta({ title:'Страница не найдена', path:req.path }), '<section class="event-detail"><h1>404</h1><p>Эта страница не найдена.</p><a class="outline-button" href="/">НА ГЛАВНУЮ</a></section>')));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).send('Ошибка сервера. Попробуйте обновить страницу.'); });

app.listen(port, () => console.log(`${brandName} запущен: http://localhost:${port}`));
