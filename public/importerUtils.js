function parseEurToCents(amountStr) {
  const parts = String(amountStr || '0.00').trim().split('.');
  const euros = parseInt(parts[0] || '0', 10);
  const cents = parseInt((parts[1] || '00').padEnd(2, '0').slice(0, 2), 10);
  return euros * 100 + cents;
}

function formatCentsToEur(totalCents) {
  const absCents = Math.abs(totalCents);
  return `${Math.floor(absCents / 100)}.${String(absCents % 100).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showFeedback(message, type) {
  const box = document.getElementById('importer-feedback');
  if (!box) return;
  box.style.display = 'block';
  box.textContent = message;
  box.style.borderLeftColor =
    type === 'error' ? 'var(--negative)' : type === 'success' ? 'var(--positive)' : 'var(--border-light)';
}

function hideFeedback() {
  const box = document.getElementById('importer-feedback');
  if (box) box.style.display = 'none';
}

function formatItemStatus(item) {
  if (item.state === 'SETTLED') return 'SETTLED';
  if (item.state === 'FAILED') return `FAILED (${item.error || 'Error'})`;
  if (item.isDuplicate) return 'DUPLICATE - SKIP';
  if (item.isRepayment) return 'REPAYMENT - SKIP';
  return item.state || 'DRAFT';
}
