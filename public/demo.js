// Demo page: live index stats and "try asking" buttons.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ask]');
  if (b && window.HomeFinder) window.HomeFinder.ask(b.dataset.ask);
});

function ago(iso) {
  if (!iso) return 'not yet';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

fetch('/api/health')
  .then((r) => r.json())
  .then((h) => {
    document.getElementById('s-homes').textContent = h.index.homes.toLocaleString('en-GB');
    document.getElementById('s-devs').textContent = h.index.developments.toLocaleString('en-GB');
    document.getElementById('s-age').textContent = ago(h.index.builtAt);
    document.getElementById('site-name').textContent = h.site.name;
  })
  .catch(() => {});
