// Deleting needs the signed-in person's password, typed again. Stops a stray click, or someone at an unlocked laptop.
// (A UI guard: the database itself still lets a signed-in user delete their own school's rows.)
import { h } from './ui';
import { verifyPassword } from './sync';

let box: HTMLDialogElement | null = null;
export function askDelete(title: string, message: string, label = 'Delete'): Promise<boolean> {
  if (!box) { box = h('dialog', { class: 'modal', 'aria-labelledby': 'dg-title' }) as HTMLDialogElement; document.body.append(box); }
  const d = box;
  return new Promise((resolve) => {
    const done = (ok: boolean) => { d.removeEventListener('close', onClose); if (d.open) d.close(); resolve(ok); };
    const onClose = () => done(false);
    d.addEventListener('close', onClose);
    d.onclick = (e) => { if (e.target === d) done(false); };
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Your password' }) as HTMLInputElement;
    const err = h('p', { class: 'flash flash--err', role: 'alert', hidden: true });
    const go = h('button', { class: 'btn btn--danger btn--sm' }, label) as HTMLButtonElement;
    const form = h('form', { class: 'form', onsubmit: async (e: Event) => {
      e.preventDefault();
      go.disabled = true;
      const m = await verifyPassword(pw.value);
      if (!m) return done(true);
      err.textContent = m; err.hidden = false; go.disabled = false; pw.select();
    } },
      h('label', { class: 'field' }, h('span', null, 'Enter your password to continue'), pw), err,
      h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => done(false) }, 'Cancel'), go));
    d.replaceChildren(h('h2', { id: 'dg-title' }, title), h('p', null, message), form);
    d.showModal();
    pw.focus();
  });
}
