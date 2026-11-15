// The browser's own validation bubble ("Please enter a valid value…") is replaced by a message in the site's style,
// shown under the field. Forms still refuse to submit, the first bad field gets focus, and the message goes
// away as soon as the person edits the field.
const label = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
  const v = el.validity;
  const input = el as HTMLInputElement;
  if (v.valueMissing) return 'Fill this in.';
  if (v.rangeUnderflow) return `Enter ${input.min} or more.`;
  if (v.rangeOverflow) return `Enter ${input.max} or less.`;
  if (v.stepMismatch) return 'Enter a whole number.';
  if (v.tooShort) return `Use at least ${input.minLength} characters.`;
  if (v.typeMismatch || v.patternMismatch || v.badInput) return 'Enter a valid value.';
  return el.validationMessage || 'Enter a valid value.';
};

function clear(el: Element) {
  el.removeAttribute('aria-invalid');
  const noteId = el.getAttribute('data-err-id');
  if (noteId) document.getElementById(noteId)?.remove();
  el.removeAttribute('data-err-id');
}

let n = 0;
document.addEventListener('invalid', (e) => {
  e.preventDefault();                                           // no browser bubble
  const el = e.target as HTMLInputElement;
  clear(el);
  const id = `err-${++n}`;
  const note = document.createElement('p');
  note.id = id; note.className = 'field-err'; note.setAttribute('role', 'alert');
  note.textContent = label(el);
  el.setAttribute('aria-invalid', 'true'); el.setAttribute('data-err-id', id); el.setAttribute('aria-describedby', id);
  (el.closest('.field, .combo') ?? el).append(note);
  if (!document.querySelector('[aria-invalid="true"]:focus')) (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
}, true);

document.addEventListener('input', (e) => { if ((e.target as HTMLElement).getAttribute?.('aria-invalid')) clear(e.target as Element); }, true);
