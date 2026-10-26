(function () {
  let pendingBudgetItems = [];
  let currentSavingsPlan = null;

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showFeedback(message, type = 'info') {
    const el = document.getElementById('budget-sync-feedback');
    if (!el) return;

    if (!message) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }

    el.style.display = 'block';
    el.textContent = message;
    if (type === 'error') {
      el.style.borderLeftColor = 'var(--negative, #f85149)';
      el.style.color = 'var(--negative, #f85149)';
    } else if (type === 'success') {
      el.style.borderLeftColor = 'var(--positive, #3fb950)';
      el.style.color = 'var(--positive, #3fb950)';
    } else {
      el.style.borderLeftColor = 'var(--accent, #58a6ff)';
      el.style.color = 'var(--text-main)';
    }
  }

  function openConfirmModal(items, note) {
    if (!items || items.length === 0) {
      showFeedback('Geen geldige budgetdoelen gevonden om door te voeren.', 'error');
      return;
    }

    pendingBudgetItems = items;
    const modal = document.getElementById('budget-confirm-modal');
    const tbody = document.getElementById('budget-confirm-tbody');
    const noteEl = document.getElementById('budget-confirm-note');
    const confirmBtn = document.getElementById('budget-modal-confirm-btn');

    if (!modal || !tbody) return;

    tbody.innerHTML = items
      .map((item) => {
        const curText =
          item.currentBudget !== null && item.currentBudget !== undefined
            ? `EUR ${Number(item.currentBudget).toFixed(2)}`
            : 'Niet ingesteld';
        const newText = `EUR ${Number(item.amount).toFixed(2)}`;
        return `
          <tr>
            <td><strong>${escapeHtml(item.categoryTitle || item.category || 'Categorie')}</strong></td>
            <td class="text-right text-muted">${curText}</td>
            <td class="text-right"><strong>${newText}</strong></td>
          </tr>
        `;
      })
      .join('');

    if (noteEl) {
      noteEl.textContent =
        note ||
        `${items.length} categorie-budget(ten) worden direct opgeslagen in Zenmoney met status vergrendeld (outcomeLock).`;
    }

    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Bevestig & Doorgeven';
    }

    modal.style.display = 'flex';
  }

  function closeConfirmModal() {
    const modal = document.getElementById('budget-confirm-modal');
    if (modal) {
      modal.style.display = 'none';
    }
    pendingBudgetItems = [];
  }

  async function executeBudgetSync() {
    if (pendingBudgetItems.length === 0) {
      closeConfirmModal();
      return;
    }

    const confirmBtn = document.getElementById('budget-modal-confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Doorgeven aan Zenmoney...';
    }

    try {
      const payload = {
        budgets: pendingBudgetItems.map((item) => ({
          categoryId: item.categoryId,
          categoryTitle: item.categoryTitle || item.category,
          amount: Number(item.amount),
        })),
      };

      const res = await fetch('/api/advisor/apply-budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Fout bij opslaan in Zenmoney');
      }

      closeConfirmModal();
      showFeedback(
        `${data.appliedCount} budgetdoel(en) succesvol ingesteld en vergrendeld in Zenmoney.`,
        'success'
      );

      if (data.savingsPlan && window.AdvisorUI && typeof window.AdvisorUI.renderSavingsPlan === 'function') {
        window.AdvisorUI.renderSavingsPlan(data.savingsPlan);
      } else if (window.AdvisorUI && typeof window.AdvisorUI.fetchSavingsPlan === 'function') {
        window.AdvisorUI.fetchSavingsPlan();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Opnieuw Proberen';
      }
      showFeedback(`Synchronisatiefout Zenmoney: ${msg}`, 'error');
    }
  }

  function getEligibleGoals(plan) {
    if (!plan || !Array.isArray(plan.categoryPlans)) return [];
    return plan.categoryPlans
      .filter((c) => c.categoryId && (c.needsNewZenmoneyGoal || c.zenmoneyBudget !== c.recommendedMonthlyBudget))
      .map((c) => ({
        categoryId: c.categoryId,
        categoryTitle: c.category,
        currentBudget: c.zenmoneyBudget,
        amount: c.recommendedMonthlyBudget,
      }));
  }

  function setCurrentPlan(plan) {
    currentSavingsPlan = plan;
    const applyAllBtn = document.getElementById('apply-all-budgets-btn');
    if (!applyAllBtn) return;

    const eligible = getEligibleGoals(plan);
    if (eligible.length > 0) {
      applyAllBtn.style.display = 'inline-block';
      applyAllBtn.textContent = `Doelen Doorgeven aan Zenmoney (${eligible.length})`;
    } else {
      applyAllBtn.style.display = 'none';
    }
  }

  function applySingleGoal(categoryId, categoryTitle, amount, currentBudget) {
    openConfirmModal(
      [
        {
          categoryId,
          categoryTitle,
          amount,
          currentBudget,
        },
      ],
      `Budget voor ${categoryTitle} instellen op EUR ${Number(amount).toFixed(2)} in Zenmoney.`
    );
  }

  function applyAllGoals() {
    const eligible = getEligibleGoals(currentSavingsPlan);
    if (eligible.length === 0) {
      showFeedback('Alle Zenmoney budgetten zijn al in overeenstemming met de doelen.', 'info');
      return;
    }
    openConfirmModal(
      eligible,
      `In totaal ${eligible.length} categorie-budgetten doorvoeren naar Zenmoney.`
    );
  }

  function initBudgetSyncUI() {
    const applyAllBtn = document.getElementById('apply-all-budgets-btn');
    const closeBtn = document.getElementById('budget-modal-close-btn');
    const cancelBtn = document.getElementById('budget-modal-cancel-btn');
    const confirmBtn = document.getElementById('budget-modal-confirm-btn');
    const modal = document.getElementById('budget-confirm-modal');

    if (applyAllBtn) {
      applyAllBtn.addEventListener('click', applyAllGoals);
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', closeConfirmModal);
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', closeConfirmModal);
    }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', executeBudgetSync);
    }
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeConfirmModal();
      });
    }

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-apply-goal');
      if (btn) {
        const catId = btn.getAttribute('data-cat-id');
        const catTitle = btn.getAttribute('data-category');
        const amount = parseFloat(btn.getAttribute('data-amount') || '0');
        const curRaw = btn.getAttribute('data-current');
        const currentBudget = curRaw !== '' && curRaw !== null ? parseFloat(curRaw) : null;
        if (catId) {
          applySingleGoal(catId, catTitle, amount, currentBudget);
        }
      }

      const chatBtn = e.target.closest('.chat-apply-budgets-btn');
      if (chatBtn) {
        applyAllGoals();
      }
    });
  }

  window.BudgetSyncUI = {
    setCurrentPlan,
    applyAllGoals,
    applySingleGoal,
    openConfirmModal,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBudgetSyncUI);
  } else {
    initBudgetSyncUI();
  }
})();
