async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    const mcpPill = document.getElementById('mcp-pill');
    const authBanner = document.getElementById('auth-banner');
    if (data.mcp.connected) {
      mcpPill.textContent = 'MCP: Live';
      mcpPill.className = 'status-pill status-live';
      if (authBanner) authBanner.style.display = 'none';
    } else {
      mcpPill.textContent = 'MCP: Disconnected';
      mcpPill.className = 'status-pill status-mock';
      if (authBanner) authBanner.style.display = 'block';
    }

    const geminiPill = document.getElementById('gemini-pill');
    if (data.gemini.available) {
      geminiPill.textContent = `Gemini: ${data.gemini.model}`;
      geminiPill.className = 'status-pill status-live';
    } else {
      geminiPill.textContent = 'Gemini: Rule Engine';
      geminiPill.className = 'status-pill status-mock';
    }

    const cronPill = document.getElementById('cron-pill');
    cronPill.textContent = data.cron.active ? 'Cron: 07:30 Daily & 1st/15th' : 'Cron: Inactive';
  } catch (err) {
    console.error('Error fetching system status:', err);
  }
}

async function fetchFinancialSummary() {
  try {
    const res = await fetch('/api/financial-summary?days=15');
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      document.getElementById('kpi-cashflow').textContent = 'EUR --.--';
      document.getElementById('kpi-cashflow-sub').textContent = errData.error || 'Zenmoney connection required';
      return;
    }
    const data = await res.json();

    // Render KPIs
    const cashflowEl = document.getElementById('kpi-cashflow');
    const cashflowSubEl = document.getElementById('kpi-cashflow-sub');
    cashflowEl.textContent = `EUR ${data.netCashFlow.toFixed(2)}`;
    cashflowEl.style.color = data.netCashFlow >= 0 ? 'var(--positive)' : 'var(--negative)';
    cashflowSubEl.textContent = `EUR ${data.totalIncome.toFixed(2)} in / EUR ${data.totalExpenses.toFixed(2)} out`;

    document.getElementById('kpi-savings-rate').textContent = `${data.savingsRatePercentage.toFixed(1)}%`;
    document.getElementById('kpi-expenses').textContent = `EUR ${data.totalExpenses.toFixed(2)}`;
    document.getElementById('kpi-tx-count').textContent = `${data.transactionsCount} recorded events`;
    document.getElementById('kpi-liquid').textContent = `EUR ${data.totalLiquidBalance.toFixed(2)}`;

    // Categories
    const catList = document.getElementById('category-list');
    catList.innerHTML = data.categoryBreakdown?.length
      ? data.categoryBreakdown
          .slice(0, 6)
          .map(
            (c) => `
        <div class="category-item">
          <span class="category-name">${c.category}</span>
          <span class="category-stats">EUR ${c.amount.toFixed(2)} (${c.percentage.toFixed(1)}%)</span>
        </div>`
          )
          .join('')
      : '<p class="empty-state">No category expenditures in range.</p>';

    // Anomalies
    const anomalyList = document.getElementById('anomaly-list');
    anomalyList.innerHTML = data.topAnomalies?.length
      ? data.topAnomalies
          .map(
            (a) => `
        <div class="anomaly-item">
          <div class="anomaly-title"><span>${a.payee}</span><span>EUR ${a.amount.toFixed(2)}</span></div>
          <div class="anomaly-desc">${a.date} - ${a.reason}</div>
        </div>`
          )
          .join('')
      : '<p class="empty-state">No transaction anomalies detected.</p>';

    // Planned Schedule
    const plannedList = document.getElementById('planned-list');
    if (plannedList) {
      const items = data.plannedSchedule?.items || [];
      const alerts = data.plannedSchedule?.liquidityAlerts || [];
      if (items.length > 0 || alerts.length > 0) {
        const alertHtml = alerts
          .map(
            (al) => `
          <div class="anomaly-item">
            <div class="anomaly-title"><span>Shortfall: ${al.accountTitle}</span><span class="amount-expense">-EUR ${al.shortfallAmount.toFixed(2)}</span></div>
            <div class="anomaly-desc">Balance EUR ${al.currentBalance.toFixed(2)} vs EUR ${al.plannedOutflows.toFixed(2)} scheduled debits</div>
          </div>`
          )
          .join('');
        const itemsHtml = items
          .slice(0, 8)
          .map((pt) => {
            const isInc = !pt.isTransfer && pt.income > 0;
            const amt = (pt.outcome > 0 ? pt.outcome : pt.income).toFixed(2);
            const sign = pt.isTransfer ? '' : isInc ? '+' : '-';
            const cls = pt.isTransfer ? '' : isInc ? 'amount-income' : 'amount-expense';
            return `<div class="category-item"><span class="category-name">${pt.date} - ${pt.payee}</span><span class="category-stats ${cls}">${sign}EUR ${amt}</span></div>`;
          })
          .join('');
        plannedList.innerHTML = alertHtml + itemsHtml;
      } else {
        plannedList.innerHTML = '<p class="empty-state">No planned transactions in next 30 days.</p>';
      }
    }
  } catch (err) {
    console.error('Error fetching summary:', err);
  }
}

async function triggerHealthCheck() {
  const btn = document.getElementById('run-audit-btn');
  btn.disabled = true;
  btn.textContent = 'Analyzing Financial State...';

  try {
    const res = await fetch('/api/trigger-analysis', { method: 'POST' });
    const data = await res.json();
    if (data.success && data.report) {
      if (window.ReportStore) {
        await window.ReportStore.saveReport(data.report);
      }
      if (window.ReportUI) {
        window.ReportUI.renderReport(data.report);
        await window.ReportUI.fetchHistory();
      }
      await fetchFinancialSummary();
      await fetchStatus();
    }
  } catch (err) {
    console.error('Error running audit:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Health Check Now';
  }
}

async function connectToken() {
  const input = document.getElementById('token-input');
  const errBox = document.getElementById('auth-error');
  const btn = document.getElementById('save-token-btn');
  const token = input ? input.value.trim() : '';

  if (!token) {
    if (errBox) {
      errBox.textContent = 'Please enter a valid Zenmoney token.';
      errBox.style.display = 'block';
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Connecting...';
  if (errBox) errBox.style.display = 'none';

  try {
    const res = await fetch('/api/set-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (data.connected) {
      input.value = '';
      await fetchStatus();
      await fetchFinancialSummary();
      if (window.AdvisorUI) {
        await window.AdvisorUI.fetchSavingsPlan();
      }
    } else {
      if (errBox) {
        errBox.textContent = data.status?.error || 'Could not authenticate token with Zenmoney MCP.';
        errBox.style.display = 'block';
      }
    }
  } catch (err) {
    if (errBox) {
      errBox.textContent = 'Connection error: ' + (err.message || String(err));
      errBox.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect Live';
  }
}

function init() {
  fetchStatus();
  fetchFinancialSummary();

  if (window.ReportUI) {
    window.ReportUI.fetchLatestReport();
    window.ReportUI.fetchHistory();
    window.ReportUI.initReportActions();
  }

  const auditBtn = document.getElementById('run-audit-btn');
  if (auditBtn) {
    auditBtn.addEventListener('click', triggerHealthCheck);
  }

  const saveTokenBtn = document.getElementById('save-token-btn');
  if (saveTokenBtn) {
    saveTokenBtn.addEventListener('click', connectToken);
  }
}

// Global DOMContentLoaded Guard
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
