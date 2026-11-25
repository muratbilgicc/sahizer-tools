(function () {
  'use strict';

  const engine = window.SinifNetleriEngine;
  const get = id => document.getElementById(id);
  const target = get('target');
  const reportInput = get('report');
  const trialFields = get('trial-fields');
  const trials = get('trials');
  const preview = get('preview');
  const results = get('results');
  const exportButton = get('export');
  const status = get('status');
  const downloadStatus = get('download-status');
  const format = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 });
  let report = null;
  let prepared = null;
  let revision = 0;
  let reportRevision = 0;
  let exporting = false;

  function message(value, error = false) {
    status.textContent = value;
    status.hidden = !value;
    status.toggleAttribute('data-error', error);
  }

  function invalidate() {
    revision++;
    prepared = null;
    results.hidden = true;
    downloadStatus.textContent = '';
    downloadStatus.removeAttribute('data-error');
    preview.disabled = !report || !target.files.length;
  }

  function showReadiness() {
    if (!report) {
      message(target.files.length ? 'Şimdi YKS veya LGS raporunu seç.' : 'Önizleme için iki Excel dosyasını da seç.');
      return;
    }
    const type = report.sessions.join(' / ');
    message(target.files.length
      ? `${type} raporu hazır. Hedef deneme satırını kontrol edip aktarımı önizle.`
      : `${type} raporu hazır. Ana takip dosyasını seç.`);
  }

  function showTrialInputs(data) {
    for (const session of data.sessions) {
      const wrapper = document.createElement('div');
      wrapper.className = 'trial';
      const label = document.createElement('label');
      label.htmlFor = 'trial-' + session;
      label.textContent = session;
      const input = document.createElement('input');
      input.id = label.htmlFor;
      input.name = session;
      input.type = 'number';
      input.min = '1';
      input.step = '1';
      input.required = true;
      const number = data.numbers[session];
      const pairedTytNumber = session === 'AYT' && data.sessions.includes('TYT') ? data.numbers.TYT : null;
      if (pairedTytNumber || number) input.value = pairedTytNumber || number;
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.id = 'hint-' + session;
      input.setAttribute('aria-describedby', hint.id);
      hint.textContent = number ? `Rapordaki deneme numarası ${number}.` : 'Raporda deneme numarası belirlenemedi.';
      if (pairedTytNumber) hint.textContent += ' Birleşik YKS raporunda TYT ile aynı hedef satır önerilir.';
      label.append(input);
      wrapper.append(label, hint);
      trials.append(wrapper);
    }
    trialFields.hidden = false;
  }

  reportInput.addEventListener('change', async () => {
    const request = ++reportRevision;
    report = null;
    invalidate();
    trials.replaceChildren();
    trialFields.hidden = true;
    const file = reportInput.files[0];
    if (!file) {
      showReadiness();
      return;
    }
    message('Rapor okunuyor…');
    try {
      const data = await engine.readReport(await file.arrayBuffer());
      if (request !== reportRevision) return;
      report = data;
      showTrialInputs(data);
      invalidate();
      showReadiness();
    } catch (error) {
      if (request === reportRevision) message(error.message, true);
    }
  });

  target.addEventListener('change', () => {
    invalidate();
    if (report || !reportInput.files.length) showReadiness();
  });
  trials.addEventListener('input', () => {
    invalidate();
    showReadiness();
  });

  function render(data) {
    get('summary').textContent = `${data.changes.length} hücre doldurulacak · ${data.preserved} dolu hücre korunacak · ${data.empty} eksik net`;
    const warnings = get('warnings');
    warnings.replaceChildren();
    for (const [label, values] of [
      ['Ana dosyada karşılığı bulunmayan şubeler', data.unmatched],
      ['Raporda karşılığı bulunmayan şubeler', data.missingClasses],
      ['Ana dosyada bulunmayan deneme satırları', data.missingRows]
    ]) {
      if (!values.length) continue;
      const item = document.createElement('li');
      item.textContent = label + ' — ' + values.join(', ');
      warnings.append(item);
    }
    warnings.hidden = !warnings.childElementCount;

    const rows = document.createDocumentFragment();
    for (const change of data.changes) {
      const row = document.createElement('tr');
      for (const value of [change.sheet, change.label, change.session, change.trial, change.subject, change.cell, format.format(Number(change.value))]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      rows.append(row);
    }
    get('changes').replaceChildren(rows);
    get('changes-table').hidden = !data.changes.length;
    if (!data.changes.length) downloadStatus.textContent = 'Bu seçimde doldurulacak boş hücre bulunamadı.';
    exportButton.disabled = exporting || !data.changes.length;
    results.hidden = false;
  }

  get('transfer').addEventListener('submit', async event => {
    event.preventDefault();
    if (!report || !target.files[0]) return;
    invalidate();
    const request = revision;
    const currentReport = report;
    const selected = Object.fromEntries([...trials.querySelectorAll('input')].map(input => [input.name, input.valueAsNumber]));
    preview.disabled = true;
    message('Önizleme hazırlanıyor…');
    try {
      const data = await engine.prepare(await target.files[0].arrayBuffer(), currentReport, selected);
      if (request !== revision) return;
      prepared = data;
      render(data);
      message('Önizleme hazır.');
      results.focus({ preventScroll: true });
      results.scrollIntoView({ block: 'start' });
    } catch (error) {
      if (request === revision) message(error.message, true);
    } finally {
      if (request === revision) preview.disabled = false;
    }
  });

  exportButton.addEventListener('click', async () => {
    if (!prepared || exporting) return;
    const current = prepared;
    const filename = target.files[0].name.replace(/\.xlsx$/i, '') + ' - Güncel.xlsx';
    exporting = true;
    exportButton.disabled = true;
    downloadStatus.removeAttribute('data-error');
    downloadStatus.textContent = 'Excel hazırlanıyor…';
    try {
      const blob = await current.generate();
      if (prepared !== current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      downloadStatus.textContent = 'Güncel Excel indirildi.';
    } catch (error) {
      if (prepared === current) {
        downloadStatus.setAttribute('data-error', '');
        downloadStatus.textContent = 'Excel indirilemedi. ' + error.message;
      }
    } finally {
      exporting = false;
      exportButton.disabled = !prepared?.changes.length;
    }
  });
  target.disabled = false;
  reportInput.disabled = false;
})();
