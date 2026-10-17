// Financial Report UI Controller: Markdown rendering, report display, history list, and backup actions
(function (global) {
  'use strict';

  function renderMarkdown(md) {
    if (!md) return '<p class="empty-state">No report content.</p>';
    var html = md
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

  function renderReport(report) {
    if (!report) return;
    var timestampEl = document.getElementById('report-timestamp');
    var tagEl = document.getElementById('report-source-tag');
    var containerEl = document.getElementById('report-container');

    if (timestampEl) timestampEl.textContent = new Date(report.createdAt).toLocaleString();
    if (tagEl) tagEl.textContent = 'Engine: ' + (report.generatedBy || 'Zenmoney Intelligence');
    if (containerEl) containerEl.innerHTML = renderMarkdown(report.markdownContent);
  }

  function renderHistoryList(reports) {
    var list = document.getElementById('history-list');
    if (!list) return;

    if (!reports || reports.length === 0) {
      list.innerHTML = '<p class="empty-state">No past reports archived.</p>';
      return;
    }

    list.innerHTML = reports
      .map(function (r) {
        var dateStr = new Date(r.createdAt).toLocaleDateString();
        var flowStr = typeof r.netCashFlow === 'number' ? r.netCashFlow.toFixed(2) : '--.--';
        return (
          '<div class="history-item" data-id="' +
          r.id +
          '">' +
          '<span>' +
          dateStr +
          '</span>' +
          '<span>Flow: EUR ' +
          flowStr +
          '</span>' +
          '</div>'
        );
      })
      .join('');

    list.querySelectorAll('.history-item').forEach(function (item) {
      item.addEventListener('click', async function () {
        var id = item.getAttribute('data-id');
        if (global.ReportStore) {
          var cached = await global.ReportStore.getReportById(id);
          if (cached && cached.markdownContent) {
            renderReport(cached);
            return;
          }
        }
        try {
          var detailRes = await fetch('/api/reports/' + id);
          if (detailRes.ok) {
            var detail = await detailRes.json();
            renderReport(detail);
            if (global.ReportStore) {
              await global.ReportStore.saveReport(detail);
            }
          }
        } catch (fetchErr) {
          console.warn('Error fetching report detail:', fetchErr);
        }
      });
    });
  }

  async function fetchLatestReport() {
    // 1. Instant optimistic render from local IndexedDB
    if (global.ReportStore) {
      try {
        var localReports = await global.ReportStore.getAllReports();
        if (localReports.length > 0 && localReports[0].markdownContent) {
          renderReport(localReports[0]);
        }
      } catch (e) {
        // Non-fatal
      }
    }

    // 2. Fetch fresh latest from server
    try {
      var res = await fetch('/api/reports/latest');
      if (!res.ok) {
        var currentContainer = document.getElementById('report-container');
        if (!currentContainer.hasChildNodes() || currentContainer.querySelector('.empty-state')) {
          currentContainer.innerHTML =
            '<p class="empty-state">No report generated yet. Click "Run Health Check Now" to produce your initial audit.</p>';
        }
        return;
      }
      var report = await res.json();
      renderReport(report);
      if (global.ReportStore) {
        await global.ReportStore.saveReport(report);
      }
    } catch (err) {
      console.error('Error fetching latest report from server:', err);
    }
  }

  async function fetchHistory() {
    // 1. Instant local render from IndexedDB
    if (global.ReportStore) {
      try {
        var localReports = await global.ReportStore.getAllReports();
        if (localReports.length > 0) {
          renderHistoryList(localReports);
        }
      } catch (e) {
        // Non-fatal
      }

      // 2. Background reconcile with server
      try {
        var reconciled = await global.ReportStore.syncWithServer();
        renderHistoryList(reconciled);
        return;
      } catch (syncErr) {
        console.warn('Sync with server error, falling back to direct API fetch:', syncErr);
      }
    }

    // 3. Fallback direct API fetch
    try {
      var res = await fetch('/api/reports');
      var reports = await res.json();
      renderHistoryList(reports);
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  }

  function initReportActions() {
    var exportBtn = document.getElementById('export-reports-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (global.ReportStore) global.ReportStore.exportReportsAsJson();
      });
    }

    var importBtn = document.getElementById('import-reports-btn');
    var importInput = document.getElementById('import-reports-file-input');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', function () {
        importInput.click();
      });

      importInput.addEventListener('change', async function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file || !global.ReportStore) return;
        try {
          var count = await global.ReportStore.importReportsFromJsonFile(file);
          alert('Successfully imported and synchronized ' + count + ' archived reports.');
          await fetchHistory();
          await fetchLatestReport();
        } catch (importErr) {
          alert('Import error: ' + (importErr.message || String(importErr)));
        } finally {
          importInput.value = '';
        }
      });
    }
  }

  global.ReportUI = {
    renderMarkdown: renderMarkdown,
    renderReport: renderReport,
    renderHistoryList: renderHistoryList,
    fetchLatestReport: fetchLatestReport,
    fetchHistory: fetchHistory,
    initReportActions: initReportActions,
  };
})(window);
