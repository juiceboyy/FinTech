let activeDraftBatch = null;
let availableCategories = [];


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

  const uncommittedSelected = activeDraftBatch.items.filter(
    (item) => item.selected && item.state !== 'SETTLED'
  );

  const selEl = document.getElementById('importer-stats-selected');
  const totEl = document.getElementById('importer-stats-total');
  const skipEl = document.getElementById('importer-stats-skipped');
  const commitBtn = document.getElementById('importer-commit-btn');

  if (selEl) selEl.textContent = `${selectedCount} selected`;
  if (totEl) totEl.textContent = `EUR ${formatCentsToEur(totalExpenseCents)} outflow`;
  if (skipEl) skipEl.textContent = `${skippedCount} skipped`;
  if (commitBtn) commitBtn.disabled = uncommittedSelected.length === 0;
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
      const isSettled = item.state === 'SETTLED';
      const sign = item.direction === 'expense' ? '-' : '+';
      const amtClass = item.direction === 'expense' ? 'amount-expense' : 'amount-income';
      const rowClass = isSettled ? 'importer-row-settled' : !item.selected ? 'importer-row-skipped' : '';
      const statusText = escapeHtml(formatItemStatus(item));
      const statusMarkup = isSettled
        ? `<span class="status-settled">${statusText}</span>`
        : statusText;

      return `
        <tr data-index="${idx}" class="${rowClass}">
          <td class="col-check">
            <input type="checkbox" class="importer-row-check" data-index="${idx}" ${item.selected ? 'checked' : ''} ${isSettled ? 'disabled' : ''}>
          </td>
          <td>${escapeHtml(item.date)}</td>
          <td><input type="text" class="table-input importer-payee-input" data-index="${idx}" value="${escapeHtml(item.payee)}" ${isSettled ? 'disabled' : ''}></td>
          <td><select class="form-select importer-cat-select" data-index="${idx}" ${isSettled ? 'disabled' : ''}>${catOptions}</select></td>
          <td><input type="text" class="table-input importer-comment-input" data-index="${idx}" value="${escapeHtml(item.comment || '')}" placeholder="Optional note" ${isSettled ? 'disabled' : ''}></td>
          <td>${statusMarkup}</td>
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

    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await res.json()
      : { success: false, error: await res.text() };

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

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      throw new Error(`Server returned status ${res.status}: ${text.slice(0, 120)}`);
    }

    if (!res.ok || !data.success) {
      showFeedback(data.error || 'Failed to commit transactions to Zenmoney.', 'error');
      return;
    }

    const s = data.summary;
    activeDraftBatch.items = s.items;
    renderStagingTable(
      activeDraftBatch,
      [{ id: targetAccountId, title: activeDraftBatch.targetAccountTitle, type: 'ccard' }],
      availableCategories
    );

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
    updateStagingSummary();
    if (commitBtn) commitBtn.textContent = 'Confirm & Sync Selected to Zenmoney';
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
