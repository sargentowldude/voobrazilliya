const menuButton = document.querySelector(".menu-button");
const menu = document.querySelector(".site-menu");
const dialog = document.querySelector(".lead-dialog");

const revealItems = document.querySelectorAll(".section-heading, .service-card, .photo-story__intro, .story-shot, .landing-intro, .character-card, .landing-facts, .hero-catalog__heading, .hero-program-card, .show-console, .show-round, .show-catalog__heading, .show-offer-card, .theater-stage, .playbill-card, .poster-card, .contact-form__planner-intro, .contact-form__step, .contact > div, .contact-form");
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
    window.ym?.(window.YANDEX_METRIKA_ID, "reachGoal", "form_open");
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

document.querySelectorAll("[data-party-builder]").forEach(builder => {
  const updateSummary = () => {
    const age = builder.querySelector('[name="childAge"]')?.value;
    const format = builder.querySelector('[name="partyFormat"]')?.value;
    const summary = builder.querySelector("[data-builder-summary]");
    if (!summary) return;

    const complete = Boolean(age && format);
    summary.classList.toggle("is-ready", complete);
    summary.textContent = complete
      ? `Ваш план: ${age} · ${format}`
      : "Выберите возраст и формат — добавим их к заявке.";
  };

  const setChoice = (selector, inputName, button) => {
    builder.querySelectorAll(selector).forEach(item => {
      const active = item === button;
      item.classList.toggle("is-selected", active);
      item.setAttribute("aria-pressed", String(active));
    });
    builder.querySelector(`[name="${inputName}"]`).value = button.dataset[inputName === "childAge" ? "builderAge" : "builderFormat"];
    updateSummary();
  };

  builder.querySelectorAll("[data-builder-age]").forEach(button => {
    button.addEventListener("click", () => setChoice("[data-builder-age]", "childAge", button));
  });
  builder.querySelectorAll("[data-builder-format]").forEach(button => {
    button.addEventListener("click", () => setChoice("[data-builder-format]", "partyFormat", button));
  });

  updateSummary();
});

document.querySelectorAll("[data-lead-form]").forEach(form => {
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
    } else if (form.matches("[data-party-builder]")) {
      const age = form.querySelector('[name="childAge"]').value;
      const format = form.querySelector('[name="partyFormat"]').value;
      if (!age || !format) {
        status.textContent = "Сначала выберите возраст и формат праздника.";
        return;
      }
      form.elements.service.value = `Подбор праздника · ${format}`;
      form.elements.message.value = `Возраст ребёнка: ${age}. Формат: ${format}.`;
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
      if (form.matches("[data-party-builder]")) {
        form.querySelectorAll(".is-selected").forEach(button => {
          button.classList.remove("is-selected");
          button.setAttribute("aria-pressed", "false");
        });
        const summary = form.querySelector("[data-builder-summary]");
        if (summary) {
          summary.classList.remove("is-ready");
          summary.textContent = "Выберите возраст и формат — добавим их к заявке.";
        }
      }
      window.ym?.(window.YANDEX_METRIKA_ID, "reachGoal", "form_submit");
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

document.querySelectorAll('a[href^="tel:"]').forEach(link => link.addEventListener("click", () => window.ym?.(window.YANDEX_METRIKA_ID, "reachGoal", "phone_click")));
