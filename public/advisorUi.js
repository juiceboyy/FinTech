(function () {
  const CHAT_STORAGE_KEY = 'fintech_advisor_chat_v1';
  let chatHistory = [];

  function loadStoredHistory() {
    try {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          chatHistory = parsed.slice(-20);
        }
      }
    } catch (e) {
      console.warn('Could not read chat history from localStorage:', e);
    }
  }

  function saveStoredHistory() {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatHistory.slice(-20)));
    } catch (e) {
      console.warn('Could not save chat history:', e);
    }
  }

  function formatMarkdownSimple(md) {
    if (!md) return '';
    if (window.ReportUI && typeof window.ReportUI.formatMarkdown === 'function') {
      return window.ReportUI.formatMarkdown(md);
    }
    const escaped = String(md)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '<br><br>');
  }

  function renderChatThread() {
    const thread = document.getElementById('chat-thread');
    if (!thread) return;

    if (chatHistory.length === 0) {
      thread.innerHTML = `
        <div class="chat-msg chat-msg-assistant">
          <span class="chat-msg-role">AI Financiele Coach</span>
          <div class="report-content">
            Stel een vraag over je financien. Alle Zenmoney rekeningen, budgetten, geplande afschrijvingen en transacties gaan direct mee in de prompt, met focus op hoeveel je per dag en per soort uitgave kunt besparen.
          </div>
        </div>
      `;
      return;
    }

    thread.innerHTML = chatHistory
      .map((item) => {
        const isUser = item.role === 'user';
        const roleLabel = isUser ? 'Jij' : 'AI Financiele Coach';
        const cls = isUser ? 'chat-msg chat-msg-user' : 'chat-msg chat-msg-assistant';
        let bodyHtml = isUser
          ? String(item.content).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          : `<div class="report-content">${formatMarkdownSimple(item.content)}</div>`;

        if (!isUser && item.eligibleBudgetCount && item.eligibleBudgetCount > 0) {
          bodyHtml += `
            <div class="chat-budget-actions">
              <div class="chat-budget-info">
                <strong>Voorgestelde Zenmoney Budgetten (${item.eligibleBudgetCount})</strong>
                <span>Geef deze nieuwe doelen direct met één druk op de knop door aan Zenmoney.</span>
              </div>
              <button type="button" class="btn btn-secondary btn-sm chat-apply-budgets-btn">Doelen Doorgeven</button>
            </div>
          `;
        }

        return `
          <div class="${cls}">
            <span class="chat-msg-role">${roleLabel}</span>
            ${bodyHtml}
          </div>
        `;
      })
      .join('');

    thread.scrollTop = thread.scrollHeight;
  }

  function renderSavingsPlan(plan) {
    if (!plan) return;

    if (window.BudgetSyncUI && typeof window.BudgetSyncUI.setCurrentPlan === 'function') {
      window.BudgetSyncUI.setCurrentPlan(plan);
    }

    const todaySaveEl = document.getElementById('goal-today-save');
    const todayLimitEl = document.getElementById('goal-today-limit');
    const weekSaveEl = document.getElementById('goal-week-save');
    const weekLimitEl = document.getElementById('goal-week-limit');
    const monthSaveEl = document.getElementById('goal-month-save');
    const monthLimitEl = document.getElementById('goal-month-limit');
    const metaEl = document.getElementById('savings-plan-meta');

    if (todaySaveEl) todaySaveEl.textContent = `Bespaar EUR ${Number(plan.todayTargetSavingsAmount).toFixed(2)} / dag`;
    if (todayLimitEl) todayLimitEl.textContent = `Max variabele uitgaven vandaag: EUR ${Number(plan.todayTargetVariableSpendLimit).toFixed(2)}`;

    if (weekSaveEl) weekSaveEl.textContent = `Bespaar EUR ${Number(plan.weekTargetSavingsAmount).toFixed(2)} / week`;
    if (weekLimitEl) weekLimitEl.textContent = `Max weekbudget variabel: EUR ${Number(plan.weekTargetVariableSpendLimit).toFixed(2)}`;

    if (monthSaveEl) monthSaveEl.textContent = `Maanddoel: EUR ${Number(plan.targetMonthlySavingsAmount).toFixed(2)}`;
    if (monthLimitEl) {
      monthLimitEl.textContent = `Resterend variabel (${plan.daysRemainingInMonth}d): EUR ${Number(plan.restOfMonthVariableSpendLimit).toFixed(2)}`;
    }
    if (metaEl) {
      metaEl.textContent = `Extra besparingspotentie: EUR ${Number(plan.potentialExtraDailySavings).toFixed(2)}/dag (EUR ${Number(plan.potentialExtraMonthlySavings).toFixed(2)}/mnd)`;
    }

    const tbody = document.getElementById('savings-category-tbody');
    if (!tbody) return;

    const categories = plan.categoryPlans || [];
    if (categories.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Geen categorie-uitgaven gevonden.</td></tr>';
      return;
    }

    tbody.innerHTML = categories
      .slice(0, 15)
      .map((c) => {
        const zmBudgetText = c.zenmoneyBudget !== null ? `EUR ${Number(c.zenmoneyBudget).toFixed(2)}` : 'Niet ingesteld';
        const recText = `EUR ${Number(c.recommendedMonthlyBudget).toFixed(2)}`;
        const dailySaveText =
          Number(c.potentialDailySavings) > 0
            ? `<span class="amount-income">+EUR ${Number(c.potentialDailySavings).toFixed(2)}/dag</span>`
            : 'EUR 0.00/dag';
        const dailyAllowText = `EUR ${Number(c.dailyAllowanceRestOfMonth).toFixed(2)}/dag (EUR ${Number(c.weeklyAllowance).toFixed(2)}/wk)`;

        let actionHtml = '<span class="text-muted">-</span>';
        if (c.needsNewZenmoneyGoal && c.categoryId) {
          actionHtml = `<button type="button" class="btn btn-secondary btn-apply-goal" data-category="${c.category}" data-cat-id="${c.categoryId}" data-amount="${c.recommendedMonthlyBudget}" data-current="${c.zenmoneyBudget !== null ? c.zenmoneyBudget : ''}">Instellen</button>`;
        } else if (c.zenmoneyBudget !== null && Math.abs(c.zenmoneyBudget - c.recommendedMonthlyBudget) < 0.01) {
          actionHtml = '<span class="badge-synced">Actueel</span>';
        } else if (c.categoryId) {
          actionHtml = `<button type="button" class="btn-text-action btn-apply-goal" data-category="${c.category}" data-cat-id="${c.categoryId}" data-amount="${c.recommendedMonthlyBudget}" data-current="${c.zenmoneyBudget !== null ? c.zenmoneyBudget : ''}">Bijwerken</button>`;
        }

        return `
          <tr>
            <td><strong>${c.category}</strong></td>
            <td class="text-right">EUR ${Number(c.spentMonthToDate).toFixed(2)}</td>
            <td class="text-right">${zmBudgetText}</td>
            <td class="text-right"><strong>${recText}</strong></td>
            <td class="text-right">${dailyAllowText}</td>
            <td class="text-right">${dailySaveText}</td>
            <td class="text-right">${actionHtml}</td>
          </tr>
        `;
      })
      .join('');
  }

  async function fetchSavingsPlan() {
    try {
      const res = await fetch('/api/advisor/savings-plan');
      if (!res.ok) return;
      const plan = await res.json();
      renderSavingsPlan(plan);
    } catch (err) {
      console.error('Error fetching savings plan:', err);
    }
  }

  async function sendChatMessage(customMessage) {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const message = (customMessage !== undefined ? customMessage : input?.value || '').trim();
    if (!message) return;

    if (input && customMessage === undefined) {
      input.value = '';
    }

    const priorHistory = chatHistory.slice(-10);
    chatHistory.push({ role: 'user', content: message });
    saveStoredHistory();
    renderChatThread();

    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Analyseren...';
    }

    try {
      const res = await fetch('/api/advisor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: priorHistory,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        chatHistory.push({
          role: 'assistant',
          content: `Fout bij ophalen AI-antwoord: ${data.error || 'Onbekende fout'}`,
        });
      } else {
        const eligibleCount = (data.savingsPlan?.categoryPlans || []).filter(
          (c) => c.categoryId && (c.needsNewZenmoneyGoal || c.zenmoneyBudget !== c.recommendedMonthlyBudget)
        ).length;
        chatHistory.push({
          role: 'assistant',
          content: data.reply,
          eligibleBudgetCount: eligibleCount,
        });
        if (data.savingsPlan) {
          renderSavingsPlan(data.savingsPlan);
        }
      }
      saveStoredHistory();
      renderChatThread();
    } catch (err) {
      chatHistory.push({
        role: 'assistant',
        content: `Netwerkfout: ${err.message || String(err)}`,
      });
      renderChatThread();
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Verstuur Vraag';
      }
    }
  }

  async function triggerMorningDigest() {
    const btn = document.getElementById('send-morning-email-btn');
    const previewBox = document.getElementById('morning-digest-preview');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Ochtendmail Genereren...';
    }

    try {
      const res = await fetch('/api/advisor/morning-digest', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.digest) {
        const digest = data.digest;
        if (digest.savingsPlan) {
          renderSavingsPlan(digest.savingsPlan);
        }
        if (previewBox) {
          const emailStatusMsg = digest.emailResult?.sent
            ? `Ochtendmail verzonden naar ${digest.emailResult.recipient}`
            : `Ochtendplan gegenereerd (${digest.emailResult?.error || 'E-mail niet verzonden'})`;
          previewBox.style.display = 'block';
          previewBox.innerHTML = `
            <div class="anomaly-title">
              <span><strong>${digest.subject}</strong></span>
              <span>${emailStatusMsg}</span>
            </div>
            <div class="report-content" style="margin-top:10px;">
              ${formatMarkdownSimple(digest.markdownContent)}
            </div>
          `;
        }
      }
    } catch (err) {
      console.error('Error triggering morning digest:', err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Stuur Ochtendmail Nu';
      }
    }
  }

  function initAdvisorUI() {
    loadStoredHistory();
    renderChatThread();
    fetchSavingsPlan();

    const sendBtn = document.getElementById('chat-send-btn');
    const chatInput = document.getElementById('chat-input');
    const clearBtn = document.getElementById('chat-clear-btn');
    const morningBtn = document.getElementById('send-morning-email-btn');

    if (sendBtn) sendBtn.addEventListener('click', () => sendChatMessage());
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage();
        }
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        chatHistory = [];
        saveStoredHistory();
        renderChatThread();
      });
    }
    if (morningBtn) morningBtn.addEventListener('click', triggerMorningDigest);

    document.querySelectorAll('.prompt-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const q = chip.getAttribute('data-prompt');
        if (q) sendChatMessage(q);
      });
    });
  }

  window.AdvisorUI = { fetchSavingsPlan, renderSavingsPlan };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdvisorUI);
  } else {
    initAdvisorUI();
  }
})();
