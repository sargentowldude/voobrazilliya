const menuButton = document.querySelector(".menu-button");
const menu = document.querySelector(".site-menu");
const dialog = document.querySelector(".lead-dialog");
const floatingPartyCta = document.querySelector(".floating-party-cta");
const siteFooter = document.querySelector(".site-footer");
const cookieBanner = document.querySelector("[data-cookie-banner]");
const analyticsConsentCookie = "voobrazillia_analytics_consent";
const analyticsConsentVersionCookie = "voobrazillia_analytics_consent_version";
const analyticsConsentAtCookie = "voobrazillia_analytics_consent_at";
const metrikaScriptId = "yandex-metrika-script";
let metrikaLoaded = false;

const getMetrikaCounterId = () => Number(document.body?.dataset.yandexMetrikaId);
const getAnalyticsConsentVersion = () => document.body?.dataset.analyticsConsentVersion || "";
const getCookie = name => {
  const value = document.cookie.split("; ").find(item => item.startsWith(`${name}=`))?.split("=").slice(1).join("=") || "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const setAnalyticsConsent = value => {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const attributes = `Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  document.cookie = `${analyticsConsentCookie}=${value}; ${attributes}`;
  document.cookie = `${analyticsConsentVersionCookie}=${encodeURIComponent(getAnalyticsConsentVersion())}; ${attributes}`;
  document.cookie = `${analyticsConsentAtCookie}=${encodeURIComponent(new Date().toISOString())}; ${attributes}`;
};
const removeStorageByPrefix = storage => {
  Object.keys(storage).filter(name => name.startsWith("_ym") || name.startsWith("ytm_") || name === "zz").forEach(name => storage.removeItem(name));
};
const removeMetrikaCookies = () => {
  const names = new Set(["_ym_uid", "_ym_d", "_ym_isad", "_ym_visorc", "_ym_retryReqs"]);
  document.cookie.split("; ").forEach(item => {
    const name = item.split("=")[0];
    if (name.startsWith("_ym_")) names.add(name);
  });
  names.forEach(name => {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax; Domain=${window.location.hostname}`;
  });
  removeStorageByPrefix(window.localStorage);
  removeStorageByPrefix(window.sessionStorage);
};
const loadMetrika = () => {
  const counterId = getMetrikaCounterId();
  if (!Number.isSafeInteger(counterId) || counterId <= 0 || metrikaLoaded) return;
  metrikaLoaded = true;
  window.ym = window.ym || function (...args) {
    (window.ym.a = window.ym.a || []).push(args);
  };
  window.ym.l = window.ym.l || Date.now();
  window.ym(counterId, "init", { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
  const script = document.createElement("script");
  script.id = metrikaScriptId;
  script.async = true;
  script.src = "https://mc.yandex.ru/metrika/tag.js";
  document.head.append(script);
};
const stopMetrika = () => {
  const counterId = getMetrikaCounterId();
  if (Number.isSafeInteger(counterId) && counterId > 0 && typeof window.ym === "function") {
    window.ym(counterId, "destruct");
  }
  document.getElementById(metrikaScriptId)?.remove();
  metrikaLoaded = false;
  removeMetrikaCookies();
};
const applyAnalyticsConsent = value => {
  setAnalyticsConsent(value);
  if (value === "granted") loadMetrika();
  else stopMetrika();
  if (cookieBanner) cookieBanner.hidden = true;
};

if (cookieBanner) {
  const consent = getCookie(analyticsConsentCookie);
  const hasCurrentConsentVersion = getCookie(analyticsConsentVersionCookie) === getAnalyticsConsentVersion();
  if (consent === "granted" && hasCurrentConsentVersion) loadMetrika();
  else if (!(consent === "denied" && hasCurrentConsentVersion)) cookieBanner.hidden = false;
  cookieBanner.querySelectorAll("[data-cookie-choice]").forEach(button => button.addEventListener("click", () => applyAnalyticsConsent(button.dataset.cookieChoice)));
  document.querySelectorAll("[data-cookie-settings]").forEach(button => button.addEventListener("click", () => {
    cookieBanner.hidden = false;
    cookieBanner.querySelector("[data-cookie-choice=\"granted\"]")?.focus();
  }));
}

const metrikaGoal = (goal, params) => {
  const counterId = getMetrikaCounterId();
  if (!Number.isSafeInteger(counterId) || counterId <= 0 || typeof window.ym !== "function") return;
  window.ym(counterId, "reachGoal", goal, params);
};

// Убираем фиксированную CTA, когда в кадре появляется подвал: она не должна
// закрывать правовые ссылки или контакты на коротких экранах.
if (floatingPartyCta && siteFooter && "IntersectionObserver" in window) {
  const footerObserver = new IntersectionObserver(([entry]) => {
    floatingPartyCta.classList.toggle("is-footer-visible", entry.isIntersecting);
  });
  footerObserver.observe(siteFooter);
}

const revealItems = document.querySelectorAll(".section-heading, .service-card, .photo-story__intro, .story-shot, .landing-intro, .character-card, .landing-facts, .hero-catalog__heading, .hero-program-card, .show-console, .show-round, .show-catalog__heading, .show-offer-card, .theater-stage, .playbill-card, .poster-card, .contact-form__planner-intro, .contact > div, .contact-form");
revealItems.forEach(item => item.classList.add("reveal"));

if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.14, rootMargin: "0px 0px -8%" });
  revealItems.forEach(item => revealObserver.observe(item));
} else {
  revealItems.forEach(item => item.classList.add("is-visible"));
}

menuButton?.addEventListener("click", () => {
  const open = menu.classList.toggle("is-open");
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.textContent = open ? "ЗАКРЫТЬ ×" : "МЕНЮ +";
});

document.querySelectorAll("[data-open-form]").forEach(button => {
  button.addEventListener("click", () => {
    if (!dialog) return;
    const serviceInput = dialog.querySelector('[name="service"]');
    const messageInput = dialog.querySelector('[name="message"]');
    const commentInput = dialog.querySelector('[name="comment"]');
    const service = button.dataset.service || "Праздник";
    const message = button.dataset.orderMessage || `Интересует услуга: ${service}.`;
    serviceInput.value = service;
    if (messageInput) messageInput.value = message;
    if (commentInput) commentInput.value = message;
    dialog.showModal();
    dialog.querySelector('[name="name"]')?.focus();
    metrikaGoal("form_open", { form: "dialog" });
  });
});

const heroFilterButtons = document.querySelectorAll("[data-hero-filter]");
const heroCards = document.querySelectorAll("[data-hero-audience]");
const heroEmpty = document.querySelector("[data-hero-empty]");

const applyHeroFilter = filter => {
  let visibleCount = 0;
  heroFilterButtons.forEach(button => {
    const active = button.dataset.heroFilter === filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  heroCards.forEach(card => {
    const matches = filter === "all" || card.dataset.heroAudience === "all" || card.dataset.heroAudience === filter;
    card.hidden = !matches;
    if (matches) visibleCount += 1;
  });

  if (heroEmpty) heroEmpty.hidden = visibleCount !== 0;
};

heroFilterButtons.forEach(button => {
  button.addEventListener("click", () => applyHeroFilter(button.dataset.heroFilter));
});

const requestedHeroFilter = new URLSearchParams(window.location.search).get("audience");
if (["boys", "girls", "all"].includes(requestedHeroFilter)) applyHeroFilter(requestedHeroFilter);

const heroChoice = document.querySelector("[data-hero-choice]");
const heroCart = document.querySelector("[data-hero-cart]");

if (heroCart) {
  const cartForm = heroCart.querySelector("[data-hero-cart-form]");
  const cartCards = [...document.querySelectorAll("[data-hero-card]")];
  const cartHeroes = cartCards.map(card => ({
    id: card.dataset.heroId,
    name: card.dataset.heroName,
    weekdayPrice: Number(card.dataset.heroWeekdayPrice || 0),
    weekendPrice: Number(card.dataset.heroWeekendPrice || 0)
  }));
  const state = { primaryId: "", secondaryId: "", day: "weekday" };
  const money = value => new Intl.NumberFormat("ru-RU").format(Number(value || 0)) + " ₽";
  const currentHero = () => cartHeroes.find(hero => hero.id === state.primaryId);
  const secondOptions = [...cartForm.querySelectorAll("[data-cart-second-option]")];
  const primaryName = cartForm.querySelector("[data-cart-primary-name]");
  const primaryPrice = cartForm.querySelector("[data-cart-primary-price]");
  const secondItem = cartForm.querySelector("[data-cart-second-item]");
  const secondName = cartForm.querySelector("[data-cart-second-name]");
  const secondPrice = cartForm.querySelector("[data-cart-second-price]");
  const total = cartForm.querySelector("[data-cart-total]");
  const summary = cartForm.querySelector("[data-cart-summary]");
  const secondHeroPrice = Number(heroCart.dataset.secondHeroPrice || 0);

  const syncSecondHeroOptions = () => {
    secondOptions.forEach(option => {
      const isPrimary = option.dataset.cartSecondOption === state.primaryId;
      const isSelected = option.dataset.cartSecondOption === state.secondaryId;
      option.hidden = isPrimary;
      option.classList.toggle("is-selected", isSelected);
      option.setAttribute("aria-pressed", String(isSelected));
    });
  };

  const updateCart = () => {
    const hero = currentHero();
    const dayLabel = state.day === "weekend" ? "Выходные" : "Будни";
    const basePrice = hero ? hero[state.day === "weekend" ? "weekendPrice" : "weekdayPrice"] : 0;
    const secondHero = cartHeroes.find(item => item.id === state.secondaryId && item.id !== state.primaryId);
    const hasSecond = Boolean(secondHero);

    primaryName.textContent = hero?.name || "Выберите героя";
    primaryPrice.textContent = hero ? money(basePrice) : "—";
    if (secondItem) secondItem.hidden = !hasSecond;
    if (hasSecond) {
      secondName.textContent = secondHero.name;
      secondPrice.textContent = `+ ${money(secondHeroPrice)}`;
    }
    total.textContent = hero ? money(basePrice + (hasSecond ? secondHeroPrice : 0)) : "—";
    summary.textContent = !hero
      ? "Выберите главного героя."
      : !hasSecond
        ? "Выберите второго героя для акции."
        : `${dayLabel} · ${hasSecond ? "два героя" : "один герой"}.`;

    cartForm.dataset.primaryHeroName = hero?.name || "";
    cartForm.dataset.secondHeroName = hasSecond ? secondHero.name : "";
    cartForm.dataset.dayLabel = dayLabel;
    cartForm.dataset.total = String(basePrice + (hasSecond ? secondHeroPrice : 0));
    cartForm.dataset.ready = String(Boolean(hero && hasSecond));
    cartCards.forEach(card => card.classList.toggle("is-in-cart", card.dataset.heroId === state.primaryId));
    syncSecondHeroOptions();
  };

  const setPrimaryHero = heroId => {
    state.primaryId = heroId;
    if (state.secondaryId === heroId) state.secondaryId = "";
    updateCart();
  };

  const clearCartSelection = () => {
    state.primaryId = "";
    state.secondaryId = "";
    updateCart();
  };

  const openQuickHeroLead = () => {
    const hero = currentHero();
    if (!hero || !dialog) return;
    const service = `Аниматор ${hero.name}`;
    const message = `Хочу заказать аниматора ${hero.name}.`;
    heroChoice?.close();
    clearCartSelection();
    dialog.querySelector('[name="service"]').value = service;
    dialog.querySelector('[name="message"]').value = message;
    const comment = dialog.querySelector('[name="comment"]');
    if (comment) comment.value = message;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[name="name"]')?.focus();
    metrikaGoal("form_open", { form: "dialog" });
  };

  const openHeroCart = () => {
    heroChoice?.close();
    if (!heroCart.open) heroCart.showModal();
    secondOptions.find(option => !option.hidden)?.focus();
  };

  const openHeroChoice = heroId => {
    setPrimaryHero(heroId);
    const hero = currentHero();
    if (!hero) return;
    if (!heroChoice) {
      openQuickHeroLead();
      return;
    }
    heroChoice.querySelector("[data-choice-hero-name]").textContent = hero.name;
    if (!heroChoice.open) heroChoice.showModal();
    heroChoice.querySelector("[data-choice-no]")?.focus();
  };

  document.querySelectorAll("[data-add-hero]").forEach(button => {
    button.addEventListener("click", () => {
      openHeroChoice(button.closest("[data-hero-card]")?.dataset.heroId || "");
    });
  });
  cartForm.querySelectorAll("[data-cart-day]").forEach(button => {
    button.addEventListener("click", () => {
      state.day = button.dataset.cartDay;
      cartForm.querySelectorAll("[data-cart-day]").forEach(item => {
        const selected = item === button;
        item.classList.toggle("is-selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
      updateCart();
    });
  });
  secondOptions.forEach(option => option.addEventListener("click", () => {
    state.secondaryId = option.dataset.cartSecondOption || "";
    updateCart();
  }));
  heroChoice?.querySelector("[data-choice-no]")?.addEventListener("click", openQuickHeroLead);
  heroChoice?.querySelector("[data-choice-yes]")?.addEventListener("click", openHeroCart);
  heroChoice?.querySelector("[data-close-hero-choice]")?.addEventListener("click", () => {
    heroChoice.close();
    clearCartSelection();
  });
  heroChoice?.addEventListener("click", event => {
    if (event.target !== heroChoice) return;
    heroChoice.close();
    clearCartSelection();
  });
  heroCart.querySelector("[data-close-hero-cart]")?.addEventListener("click", () => heroCart.close());
  heroCart.addEventListener("click", event => { if (event.target === heroCart) heroCart.close(); });
  updateCart();
}

dialog?.querySelector(".dialog-close")?.addEventListener("click", () => dialog.close());
dialog?.addEventListener("click", event => {
  if (event.target === dialog) dialog.close();
});

document.querySelectorAll("[data-lead-form]").forEach(form => {
  let started = false;
  form.addEventListener("input", () => {
    if (started) return;
    started = true;
    metrikaGoal("form_start", { form: form.matches("[data-hero-cart-form]") ? "hero_cart" : form.matches("[data-party-form]") ? "planner" : "dialog" });
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const status = form.querySelector(".form-status");
    if (form.matches("[data-hero-cart-form]")) {
      if (form.dataset.ready !== "true") {
        status.textContent = "Выберите главного героя и, если включили акцию, второго героя.";
        return;
      }
      const secondHero = form.dataset.secondHeroName;
      const total = new Intl.NumberFormat("ru-RU").format(Number(form.dataset.total || 0)) + " ₽";
      form.elements.service.value = `Аниматоры · ${form.dataset.primaryHeroName}${secondHero ? ` + ${secondHero}` : ""}`;
      form.elements.message.value = [
        `Главный герой: ${form.dataset.primaryHeroName}`,
        `День: ${form.dataset.dayLabel}`,
        secondHero ? `Второй герой по акции: ${secondHero}` : "",
        `Итого: ${total}`
      ].filter(Boolean).join(". ") + ".";
      const comment = form.querySelector('[name="comment"]')?.value.trim();
      if (comment) form.elements.message.value += ` Комментарий: ${comment}`;
    } else if (form.matches("[data-party-form]")) {
      form.elements.service.value = "Подбор праздника";
      form.elements.message.value = "Хочу обсудить праздник по телефону.";
      const comment = form.querySelector('[name="comment"]')?.value.trim();
      if (comment) form.elements.message.value += ` Комментарий: ${comment}`;
    } else if (form.elements.comment?.value.trim()) {
      form.elements.message.value = form.elements.comment.value.trim();
    }
    if (!form.checkValidity()) {
      form.reportValidity();
      status.textContent = "Проверьте обязательные поля.";
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "ОТПРАВЛЯЕМ…";
    status.textContent = "";
    const payload = Object.fromEntries(new FormData(form));
    payload.consent = form.elements.consent.checked;
    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Ошибка отправки");
      status.textContent = result.message;
      form.reset();
      metrikaGoal("form_submit", { form: form.matches("[data-hero-cart-form]") ? "hero_cart" : form.matches("[data-party-form]") ? "planner" : "dialog" });
      const formDialog = form.closest("dialog");
      if (formDialog?.open) setTimeout(() => formDialog.close(), 1800);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
});

document.querySelectorAll('a[href^="tel:"]').forEach(link => link.addEventListener("click", () => metrikaGoal("phone_click")));

const mediaLightboxDialog = document.querySelector("[data-media-lightbox]");
const mediaLightboxContent = document.querySelector("[data-media-lightbox-content]");
if (mediaLightboxDialog && mediaLightboxContent) {
  const clearMediaLightbox = () => {
    mediaLightboxContent.querySelector("video")?.pause();
    mediaLightboxContent.replaceChildren();
  };
  const closeMediaLightbox = () => {
    if (mediaLightboxDialog.open) mediaLightboxDialog.close();
  };

  document.querySelectorAll("[data-open-media]").forEach(trigger => trigger.addEventListener("click", () => {
    const isVideo = trigger.dataset.mediaType === "video";
    const media = document.createElement(isVideo ? "video" : "img");
    media.src = trigger.dataset.mediaSrc || "";
    if (isVideo) {
      media.controls = true;
      media.playsInline = true;
      media.preload = "metadata";
      media.setAttribute("aria-label", trigger.dataset.mediaAlt || "Видео программы");
      if (trigger.dataset.mediaPoster) media.poster = trigger.dataset.mediaPoster;
    } else {
      media.alt = trigger.dataset.mediaAlt || "";
    }
    mediaLightboxContent.replaceChildren(media);
    mediaLightboxDialog.showModal();
  }));

  mediaLightboxDialog.querySelector("[data-close-media]")?.addEventListener("click", closeMediaLightbox);
  mediaLightboxDialog.addEventListener("click", event => {
    if (event.target === mediaLightboxDialog) closeMediaLightbox();
  });
  mediaLightboxDialog.addEventListener("close", clearMediaLightbox);
}
