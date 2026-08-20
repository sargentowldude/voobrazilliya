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
