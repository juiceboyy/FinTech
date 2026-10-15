function renderMarkdown(md) {
  if (!md) return '<p class="empty-state">No report content.</p>';
  let html = md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
    .replace(/\n\n+/g, '<p></p>');

  html = html.replace(/(<li>.*<\/li>)/gis, '<ul>$1</ul>');
  return html;
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    
    const mcpPill = document.getElementById('mcp-pill');
    if (data.mcp.connected) {
      mcpPill.textContent = 'MCP: Live';
      mcpPill.className = 'status-pill status-live';
    } else {
      mcpPill.textContent = 'MCP: Mock Mode';
      mcpPill.className = 'status-pill status-mock';
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
    cronPill.textContent = data.cron.active ? 'Cron: Active (1st & 15th)' : 'Cron: Inactive';
  } catch (err) {
    console.error('Error fetching system status:', err);
  }
}

async function fetchFinancialSummary() {
  try {
    const res = await fetch('/api/financial-summary?days=15');
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

    document.getElementById('ledger-range').textContent = `${data.startDate} to ${data.endDate}`;

    // Categories
    const catList = document.getElementById('category-list');
    if (data.categoryBreakdown && data.categoryBreakdown.length > 0) {
      catList.innerHTML = data.categoryBreakdown.slice(0, 6).map((c) => `
        <div class="category-item">
          <span class="category-name">${c.category}</span>
          <span class="category-stats">EUR ${c.amount.toFixed(2)} (${c.percentage.toFixed(1)}%)</span>
        </div>
      `).join('');
    } else {
      catList.innerHTML = '<p class="empty-state">No category expenditures in range.</p>';
    }

    // Anomalies
    const anomalyList = document.getElementById('anomaly-list');
    if (data.topAnomalies && data.topAnomalies.length > 0) {
      anomalyList.innerHTML = data.topAnomalies.map((a) => `
        <div class="anomaly-item">
          <div class="anomaly-title">
            <span>${a.payee}</span>
            <span>EUR ${a.amount.toFixed(2)}</span>
          </div>
          <div class="anomaly-desc">${a.date} - ${a.reason}</div>
        </div>
      `).join('');
    } else {
      anomalyList.innerHTML = '<p class="empty-state">No transaction anomalies detected.</p>';
    }

    // Transactions Table
    const tbody = document.getElementById('transactions-body');
    if (data.recentTransactions && data.recentTransactions.length > 0) {
      tbody.innerHTML = data.recentTransactions.map((tx) => `
        <tr>
          <td>${tx.date}</td>
          <td>${tx.payee || tx.comment || 'Transaction'}</td>
          <td>${tx.categoryTitle || tx.category || 'General'}</td>
          <td class="text-right amount-income">${tx.income > 0 ? `+${tx.income.toFixed(2)}` : '-'}</td>
          <td class="text-right amount-expense">${tx.outcome > 0 ? `-${tx.outcome.toFixed(2)}` : '-'}</td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No recent transactions recorded.</td></tr>';
    }
  } catch (err) {
    console.error('Error fetching summary:', err);
  }
}

async function fetchLatestReport() {
  try {
    const res = await fetch('/api/reports/latest');
    if (!res.ok) {
      document.getElementById('report-container').innerHTML = '<p class="empty-state">No report generated yet. Click "Run Health Check Now" to produce your initial audit.</p>';
      return;
    }
    const report = await res.json();
    renderReport(report);
  } catch (err) {
    console.error('Error fetching latest report:', err);
  }
}

function renderReport(report) {
  document.getElementById('report-timestamp').textContent = new Date(report.createdAt).toLocaleString();
  document.getElementById('report-source-tag').textContent = `Engine: ${report.generatedBy}`;
  document.getElementById('report-container').innerHTML = renderMarkdown(report.markdownContent);
}

async function fetchHistory() {
  try {
    const res = await fetch('/api/reports');
    const reports = await res.json();
    const list = document.getElementById('history-list');
    if (!reports || reports.length === 0) {
      list.innerHTML = '<p class="empty-state">No past reports archived.</p>';
      return;
    }
    list.innerHTML = reports.map((r) => `
      <div class="history-item" data-id="${r.id}">
        <span>${new Date(r.createdAt).toLocaleDateString()}</span>
        <span>Flow: EUR ${r.netCashFlow.toFixed(2)}</span>
      </div>
    `).join('');

    list.querySelectorAll('.history-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = item.getAttribute('data-id');
        const detailRes = await fetch(`/api/reports/${id}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          renderReport(detail);
        }
      });
    });
  } catch (err) {
    console.error('Error fetching history:', err);
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
      renderReport(data.report);
      await fetchFinancialSummary();
      await fetchHistory();
      await fetchStatus();
    }
  } catch (err) {
    console.error('Error running audit:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run Health Check Now';
  }
}

function init() {
  fetchStatus();
  fetchFinancialSummary();
  fetchLatestReport();
  fetchHistory();

  const auditBtn = document.getElementById('run-audit-btn');
  if (auditBtn) {
    auditBtn.addEventListener('click', triggerHealthCheck);
  }
}

// Global DOMContentLoaded Guard
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
