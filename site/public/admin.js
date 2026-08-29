const dialog = document.querySelector('.create-dialog');
document.querySelector('[data-open-create]')?.addEventListener('click', () => dialog.showModal());
document.querySelector('.create-dialog__close')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

const map = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
const slugify = value => value.toLowerCase().replace(/[а-яё]/g, letter => map[letter] || '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const title = document.querySelector('[data-title]');
const slug = document.querySelector('[data-slug]');
let slugTouched = false;
slug?.addEventListener('input', () => { slugTouched = true; });
title?.addEventListener('input', () => { if (!slugTouched) slug.value = slugify(title.value); });

document.querySelectorAll('input[type="file"]').forEach(input => input.addEventListener('change', () => {
  const file = input.files?.[0];
  const hint = input.parentElement.querySelector('span');
  if (file && hint) hint.textContent = file.name + ' · ' + (file.size / 1048576).toFixed(1) + ' МБ';
  const key = input.dataset.photoInput;
  const editor = input.closest('.photo-editor');
  if (file && key && editor) {
    let preview = editor.querySelector('img');
    if (!preview) {
      preview = document.createElement('img');
      preview.dataset.cropPreview = key;
      editor.querySelector('i')?.replaceWith(preview);
    }
    preview.src = URL.createObjectURL(file);
    updateCrop(key);
  }
}));

const updateCrop = key => {
  const preview = document.querySelector('[data-crop-preview="' + key + '"]');
  const editor = document.querySelector('[data-fit-preview="' + key + '"]');
  const fit = document.querySelector('[data-image-fit="' + key + '"]');
  const x = document.querySelector('[data-crop-x="' + key + '"]');
  const y = document.querySelector('[data-crop-y="' + key + '"]');
  const scale = document.querySelector('[data-crop-scale="' + key + '"]');
  const output = document.querySelector('[data-scale-output="' + key + '"]');
  const isPoster = fit?.value === 'poster';
  editor?.classList.toggle('is-poster', isPoster);
  if (preview && x && y && scale) {
    preview.style.objectPosition = x.value + '% ' + y.value + '%';
    preview.style.transformOrigin = x.value + '% ' + y.value + '%';
    preview.style.transform = isPoster ? 'none' : 'scale(' + Number(scale.value) / 100 + ')';
  }
  if (output && scale) output.textContent = scale.value + '%';
};
document.querySelectorAll('[data-crop-x],[data-crop-y],[data-crop-scale]').forEach(input => {
  input.addEventListener('input', () => updateCrop(input.dataset.cropX || input.dataset.cropY || input.dataset.cropScale));
});
document.querySelectorAll('[data-image-fit]').forEach(select => {
  select.addEventListener('change', () => updateCrop(select.dataset.imageFit));
});

/* Admin overhaul: unsaved changes */
(() => {
  const forms = [...document.querySelectorAll('[data-admin-form]')];
  const state = new WeakMap();

  const setDirty = (form, dirty) => {
    const current = state.get(form) || {};
    current.dirty = dirty;
    state.set(form, current);
    form.dataset.dirty = dirty ? 'true' : 'false';
    const status = form.querySelector('[data-save-status]');
    const reset = form.querySelector('[data-reset-form]');
    if (status) {
      status.textContent = dirty ? 'Есть несохранённые изменения' : 'Изменений нет';
      status.classList.toggle('is-dirty', dirty);
    }
    if (reset) reset.hidden = !dirty;
  };

  const hasUnsavedChanges = () => forms.some(form => state.get(form)?.dirty);

  forms.forEach(form => {
    state.set(form, { dirty:false });
    form.addEventListener('input', () => setDirty(form, true));
    form.addEventListener('change', () => setDirty(form, true));
    form.addEventListener('submit', () => setDirty(form, false));
    form.querySelector('[data-reset-form]')?.addEventListener('click', () => {
      if (window.confirm('Отменить все несохранённые изменения на этой странице?')) window.location.reload();
    });
  });

  window.addEventListener('beforeunload', event => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download') || !hasUnsavedChanges()) return;
    if (!window.confirm('Есть несохранённые изменения. Перейти и потерять их?')) event.preventDefault();
  });
})();

/* Admin overhaul: upload feedback */
(() => {
  const formatSize = files => (files.reduce((sum, file) => sum + file.size, 0) / 1048576).toFixed(1);
  const renderQueue = (input, files) => {
    const field = input.closest('.upload-field');
    if (!field) return;
    let queue = field.querySelector('.admin-upload-queue');
    if (!queue) {
      queue = document.createElement('span');
      queue.className = 'admin-upload-queue';
      field.append(queue);
    }
    queue.replaceChildren(...files.map(file => {
      const chip = document.createElement('i');
      chip.textContent = file.name;
      chip.title = file.name;
      return chip;
    }));
  };

  document.querySelectorAll('input[type="file"]').forEach(input => input.addEventListener('change', () => {
    const files = [...(input.files || [])];
    const hint = input.closest('.upload-field')?.querySelector(':scope > span:not(.admin-upload-queue)');
    if (!files.length) return;
    const total = formatSize(files);
    if (input.name === 'galleryMedia') {
      const editor = input.closest('.admin-gallery-editor');
      const existing = editor?.querySelectorAll('.admin-gallery-item').length || 0;
      const available = Math.max(0, 12 - existing);
      const maximum = Math.min(8, available);
      const valid = files.length <= maximum;
      input.setCustomValidity(valid ? '' : `Можно добавить максимум ${maximum} файлов: сейчас в карточке ${existing} из 12 материалов.`);
      if (hint) hint.textContent = `${files.length} файлов · ${total} МБ · максимум ${maximum} за это сохранение`;
      renderQueue(input, files);
      return;
    }
    if (hint) hint.textContent = `${files[0].name} · ${total} МБ`;
  }));
})();

/* FAQ editors: add and remove question-answer pairs without leaving the page */
(() => {
  const refreshNumbers = list => list.querySelectorAll('[data-faq-row]').forEach((row, index) => {
    const number = row.querySelector('[data-faq-number]');
    if (number) number.textContent = String(index + 1);
  });
  const markDirty = list => list.closest('form')?.dispatchEvent(new Event('input', { bubbles:true }));

  document.querySelectorAll('[data-faq-list]').forEach(refreshNumbers);
  document.addEventListener('click', event => {
    const add = event.target.closest('[data-faq-add]');
    if (add) {
      const editor = add.closest('[data-faq-editor]');
      const list = editor?.querySelector('[data-faq-list]');
      const template = editor?.querySelector('[data-faq-template]');
      if (!list || !template) return;
      const index = Number(list.dataset.faqNextIndex || list.querySelectorAll('[data-faq-row]').length);
      list.insertAdjacentHTML('beforeend', template.innerHTML.replaceAll('__INDEX__', String(index)));
      list.dataset.faqNextIndex = String(index + 1);
      refreshNumbers(list);
      markDirty(list);
      list.querySelector('[data-faq-row]:last-child input, [data-faq-row]:last-child textarea')?.focus();
      return;
    }
    const remove = event.target.closest('[data-faq-remove]');
    if (!remove) return;
    const row = remove.closest('[data-faq-row]');
    const list = row?.closest('[data-faq-list]');
    row?.remove();
    if (list) {
      refreshNumbers(list);
      markDirty(list);
    }
  });
})();
