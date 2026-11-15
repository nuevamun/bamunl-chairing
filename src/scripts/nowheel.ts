// Scrolling the page with the pointer over a focused number box used to change its value (a time slipping from 10 to 7).
// Letting go of the box first means the wheel scrolls the page and nothing else.
document.addEventListener('wheel', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement && t.type === 'number' && document.activeElement === t) t.blur();
}, { passive: true });
