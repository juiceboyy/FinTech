let activeDraftBatch = null;
let availableCategories = [];

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

function updateStagingSummary() {
  if (!activeDraftBatch) return;
  let selectedCount = 0;
  let skippedCount = 0;
  let totalExpenseCents = 0;

  activeDraftBatch.items.forEach((item) => {
    if (item.selected) {
      selectedCount += 1;
      if (item.direction === 'expense') {
        totalExpenseCents += parseEurToCents(item.amount);
      }
    } else {
      skippedCount += 1;
    }
  });

  const selEl = document.getElementById('importer-stats-selected');
  const totEl = document.getElementById('importer-stats-total');
  const skipEl = document.getElementById('importer-stats-skipped');
  const commitBtn = document.getElementById('importer-commit-btn');

  if (selEl) selEl.textContent = `${selectedCount} selected`;
  if (totEl) totEl.textContent = `EUR ${formatCentsToEur(totalExpenseCents)} outflow`;
  if (skipEl) skipEl.textContent = `${skippedCount} skipped`;
  if (commitBtn) commitBtn.disabled = selectedCount === 0;
}

function formatItemStatus(item) {
  if (item.state === 'SETTLED') return 'SETTLED';
  if (item.state === 'FAILED') return `FAILED (${item.error || 'Error'})`;
  if (item.isDuplicate) return 'DUPLICATE - SKIP';
  if (item.isRepayment) return 'REPAYMENT - SKIP';
  return item.state || 'DRAFT';
}

function bindStagingTableEvents(tbody) {
  tbody.addEventListener('change', (e) => {
    const target = e.target;
    const idx = parseInt(target.getAttribute('data-index'), 10);
    if (Number.isNaN(idx) || !activeDraftBatch || !activeDraftBatch.items[idx]) return;

    if (target.classList.contains('importer-row-check')) {
      activeDraftBatch.items[idx].selected = target.checked;
      const tr = target.closest('tr');
      if (tr) tr.classList.toggle('importer-row-skipped', !target.checked);
      updateStagingSummary();
    } else if (target.classList.contains('importer-cat-select')) {
      activeDraftBatch.items[idx].categoryId = target.value || undefined;
    }
  });

  tbody.addEventListener('input', (e) => {
    const target = e.target;
    const idx = parseInt(target.getAttribute('data-index'), 10);
    if (Number.isNaN(idx) || !activeDraftBatch || !activeDraftBatch.items[idx]) return;

    if (target.classList.contains('importer-payee-input')) {
      activeDraftBatch.items[idx].payee = target.value;
    } else if (target.classList.contains('importer-comment-input')) {
      activeDraftBatch.items[idx].comment = target.value;
    }
  });
}

function renderStagingTable(batch, accounts, categories) {
  activeDraftBatch = batch;
  availableCategories = categories || [];

  const stagingBox = document.getElementById('importer-staging');
  const accountSelect = document.getElementById('importer-account-select');
  const tbody = document.getElementById('importer-tbody');
  if (!stagingBox || !accountSelect || !tbody) return;

  stagingBox.style.display = 'block';
  accountSelect.innerHTML = (accounts || [])
    .map(
      (acc) =>
        `<option value="${escapeHtml(acc.id)}" ${acc.id === batch.targetAccountId ? 'selected' : ''}>${escapeHtml(acc.title)} (${escapeHtml(acc.type)})</option>`
    )
    .join('');

  tbody.innerHTML = batch.items
    .map((item, idx) => {
      const catOptions = [
        '<option value="">Uncategorized</option>',
        ...availableCategories.map(
          (c) => `<option value="${escapeHtml(c.id)}" ${c.id === item.categoryId ? 'selected' : ''}>${escapeHtml(c.title)}</option>`
        ),
      ].join('');
      const sign = item.direction === 'expense' ? '-' : '+';
      const amtClass = item.direction === 'expense' ? 'amount-expense' : 'amount-income';
      const rowClass = !item.selected ? 'importer-row-skipped' : '';

      return `
        <tr data-index="${idx}" class="${rowClass}">
          <td class="col-check"><input type="checkbox" class="importer-row-check" data-index="${idx}" ${item.selected ? 'checked' : ''}></td>
          <td>${escapeHtml(item.date)}</td>
          <td><input type="text" class="table-input importer-payee-input" data-index="${idx}" value="${escapeHtml(item.payee)}"></td>
          <td><select class="form-select importer-cat-select" data-index="${idx}">${catOptions}</select></td>
          <td><input type="text" class="table-input importer-comment-input" data-index="${idx}" value="${escapeHtml(item.comment || '')}" placeholder="Optional note"></td>
          <td>${escapeHtml(formatItemStatus(item))}</td>
          <td class="text-right ${amtClass}">${sign}${escapeHtml(item.amount)}</td>
        </tr>`;
    })
    .join('');

  updateStagingSummary();
}

async function handleCsvFileSelection(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  showFeedback(`Reading and analyzing ${file.name} against Zenmoney MCP...`, 'info');

  try {
    const csvContent = await file.text();
    const res = await fetch('/api/import/ing-csv/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvContent, fileName: file.name }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showFeedback(data.error || 'Failed to parse ING CSV file.', 'error');
      return;
    }

    renderStagingTable(data.batch, data.accounts, data.categories);
    showFeedback(
      `Staged ${data.batch.totalRows} rows from ${file.name} in DRAFT state. Review categories and click Confirm to sync to Zenmoney.`,
      'info'
    );
  } catch (err) {
    showFeedback(`CSV upload error: ${err.message || String(err)}`, 'error');
  } finally {
    event.target.value = '';
  }
}

async function commitSelectedTransactions() {
  if (!activeDraftBatch) return;
  const accountSelect = document.getElementById('importer-account-select');
  const commitBtn = document.getElementById('importer-commit-btn');
  const targetAccountId = accountSelect ? accountSelect.value : activeDraftBatch.targetAccountId;

  commitBtn.disabled = true;
  commitBtn.textContent = 'Syncing to Zenmoney...';

  try {
    const payload = {
      batchId: activeDraftBatch.batchId,
      accountId: targetAccountId,
      items: activeDraftBatch.items.map((item) => ({
        idempotencyKey: item.idempotencyKey,
        selected: Boolean(item.selected),
        date: item.date,
        payee: item.payee.trim() || item.rawPayee,
        amount: item.amount,
        direction: item.direction,
        categoryId: item.categoryId || undefined,
        comment: item.comment || undefined,
      })),
    };

    const res = await fetch('/api/import/ing-csv/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showFeedback(data.error || 'Failed to commit transactions to Zenmoney.', 'error');
      return;
    }

    const s = data.summary;
    activeDraftBatch.items = s.items;
    renderStagingTable(activeDraftBatch, [{ id: targetAccountId, title: activeDraftBatch.targetAccountTitle, type: 'ccard' }], availableCategories);
    showFeedback(
      `Sync complete: ${s.settledCount} settled (EUR ${s.settledExpenseTotal} outflow), ${s.skippedCount} skipped, ${s.failedCount} failed.`,
      s.failedCount > 0 ? 'error' : 'success'
    );

    if (typeof fetchFinancialSummary === 'function') {
      await fetchFinancialSummary();
    }
  } catch (err) {
    showFeedback(`Commit error: ${err.message || String(err)}`, 'error');
  } finally {
    commitBtn.disabled = false;
    commitBtn.textContent = 'Confirm & Sync Selected to Zenmoney';
  }
}

function initImporter() {
  const fileInput = document.getElementById('ing-csv-input');
  if (fileInput) fileInput.addEventListener('change', handleCsvFileSelection);

  const tbody = document.getElementById('importer-tbody');
  if (tbody) bindStagingTableEvents(tbody);

  const cancelBtn = document.getElementById('importer-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      activeDraftBatch = null;
      const stagingBox = document.getElementById('importer-staging');
      if (stagingBox) stagingBox.style.display = 'none';
      hideFeedback();
    });
  }

  const commitBtn = document.getElementById('importer-commit-btn');
  if (commitBtn) commitBtn.addEventListener('click', commitSelectedTransactions);

  const selectAllChk = document.getElementById('importer-select-all');
  if (selectAllChk) {
    selectAllChk.addEventListener('change', (e) => {
      if (!activeDraftBatch) return;
      const checked = e.target.checked;
      activeDraftBatch.items.forEach((item) => {
        if (!item.isDuplicate && !item.isRepayment) item.selected = checked;
      });
      if (tbody) {
        tbody.querySelectorAll('.importer-row-check').forEach((chk) => {
          const idx = parseInt(chk.getAttribute('data-index'), 10);
          const item = activeDraftBatch.items[idx];
          if (item && !item.isDuplicate && !item.isRepayment) {
            chk.checked = checked;
            const tr = chk.closest('tr');
            if (tr) tr.classList.toggle('importer-row-skipped', !checked);
          }
        });
      }
      updateStagingSummary();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initImporter);
} else {
  initImporter();
}
