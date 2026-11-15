// One styled "are you sure?" dialog. Text goes in as text nodes only.
import { h } from './ui';

let box: HTMLDialogElement | null = null;
export function askConfirm(title: string, message: string, label = 'Yes', danger = false): Promise<boolean> {
  if (!box) { box = h('dialog', { class: 'modal', 'aria-labelledby': 'cf-title' }) as HTMLDialogElement; document.body.append(box); }
  const d = box;
  return new Promise((resolve) => {
    const done = (ok: boolean) => { d.removeEventListener('close', onClose); if (d.open) d.close(); resolve(ok); };
    const onClose = () => done(false);                                  // Esc
    d.addEventListener('close', onClose);
    d.onclick = (e) => { if (e.target === d) done(false); };            // a click outside the card
    const no = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => done(false) }, 'Cancel');
    d.replaceChildren(h('h2', { id: 'cf-title' }, title), h('p', null, message),
      h('div', { class: 'form-actions' }, no, h('button', { type: 'button', class: 'btn btn--sm ' + (danger ? 'btn--danger' : 'btn--primary'), onclick: () => done(true) }, label)));
    d.showModal();
    no.focus();                                                         // a stray Enter cancels instead of confirming
  });
}
