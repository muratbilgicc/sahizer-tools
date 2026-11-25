(function () {
  'use strict';

  const engine = window.SinifNetleriEngine;
  const get = id => document.getElementById(id);
  const target = get('target');
  const reportInput = get('report');
  const reportDrop = get('report-drop');
  const targetPicker = get('choose-target');
  const templateDownload = get('download-template');
  const templateReset = get('reset-template');
  const trialFields = get('trial-fields');
  const trials = get('trials');
  const preview = get('preview');
  const results = get('results');
  const exportButton = get('export');
  const status = get('status');
  const errorBox = get('transfer-error');
  const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const downloadStatus = get('download-status');
  const format = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 });
  let report = null;
  let prepared = null;
  let revision = 0;
  let reportRevision = 0;
  let exporting = false;

  function message(value, error = false) {
    status.textContent = error ? 'Dosyanı kontrol edip tekrar deneyebilirsin.' : value;
    get('error-message').textContent = error ? value : '';
    errorBox.hidden = !error;
  }

  function setStep(number) {
    document.querySelectorAll('.step').forEach((step, index) => {
      step.classList.toggle('active', index <= number);
      if (index === number) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
  }

  function invalidate() {
    revision++;
    prepared = null;
    results.hidden = true;
    downloadStatus.textContent = '';
    downloadStatus.removeAttribute('data-error');
    preview.disabled = !report;
    setStep(0);
  }

  function showReadiness() {
    message(report ? `${report.sessions.join(' / ')} raporu hazır. Deneme satırını kontrol edip aktarımı önizle.`
      : 'Başlamak için YKS veya LGS raporunu seç.');
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

  function showReport(file, detail) {
    get('report-info').hidden = !file;
    get('report-filename').textContent = file?.name || '';
    get('report-type').textContent = detail;
    reportDrop.classList.toggle('has-file', Boolean(report));
    get('report-title').textContent = report ? 'Rapor seçildi' : 'Raporu buraya sürükle';
    get('report-subtitle').textContent = report ? 'Değiştirmek için tıkla veya sürükle' : 'veya Excel dosyası seç';
  }

  async function chooseReport(file) {
    const request = ++reportRevision;
    report = null;
    invalidate();
    trials.replaceChildren();
    trialFields.hidden = true;
    showReport(file, file ? 'Okunuyor…' : '');
    if (!file) {
      showReadiness();
      return;
    }
    message('Rapor okunuyor…');
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('Lütfen .xlsx uzantılı bir rapor seç.');
      const data = await engine.readReport(await file.arrayBuffer());
      if (request !== reportRevision) return;
      report = data;
      showReport(file, data.sessions.join(' / ') + ' · ' + data.classes.size + ' şube');
      showTrialInputs(data);
      invalidate();
      showReadiness();
    } catch (error) {
      if (request !== reportRevision) return;
      showReport(file, 'Rapor okunamadı');
      message(error.message, true);
    }
  }

  reportInput.addEventListener('change', () => {
    if (reportInput.files.length) chooseReport(reportInput.files[0]);
  });
  reportDrop.addEventListener('click', () => reportInput.click());
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    reportDrop.addEventListener(type, event => {
      event.preventDefault();
      reportDrop.classList.toggle('dragging', type === 'dragenter' || type === 'dragover');
      if (type === 'drop' && event.dataTransfer?.files.length) {
        reportInput.value = '';
        chooseReport(event.dataTransfer.files[0]);
      }
    });
  }
  get('remove-report').addEventListener('click', () => {
    reportInput.value = '';
    chooseReport(null);
    reportDrop.focus();
  });

  function updateTarget() {
    const file = target.files[0];
    get('target-title').textContent = file?.name || 'SINIF DERS NETLERİ';
    get('target-subtitle').textContent = file ? 'Kendi takip dosyan seçili' : 'Yerleşik boş şablon seçili';
    templateReset.hidden = !file;
    invalidate();
    if (report || errorBox.hidden) showReadiness();
  }

  targetPicker.addEventListener('click', () => target.click());
  target.addEventListener('change', updateTarget);
  templateReset.addEventListener('click', () => {
    target.value = '';
    updateTarget();
    targetPicker.focus();
  });
  templateDownload.addEventListener('click', () => {
    const blob = new Blob([window.SinifNetleriTemplate()], { type: workbookType });
    download(blob, 'SINIF DERS NETLERİ - Şablon.xlsx');
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
    if (!report) return;
    invalidate();
    const request = revision;
    const currentReport = report;
    const selected = Object.fromEntries([...trials.querySelectorAll('input')].map(input => [input.name, input.valueAsNumber]));
    preview.disabled = true;
    message('Önizleme hazırlanıyor…');
    try {
      const file = target.files[0];
      if (file && !/\.xlsx$/i.test(file.name)) throw new Error('Lütfen .xlsx uzantılı bir takip dosyası seç.');
      const targetBytes = file ? await file.arrayBuffer() : window.SinifNetleriTemplate();
      const data = await engine.prepare(targetBytes, currentReport, selected);
      if (request !== revision) return;
      prepared = data;
      render(data);
      message('Önizleme hazır.');
      setStep(1);
      results.focus({ preventScroll: true });
      results.scrollIntoView({ block: 'start' });
    } catch (error) {
      if (request === revision) message(error.message, true);
    } finally {
      if (request === revision) preview.disabled = false;
    }
  });

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  exportButton.addEventListener('click', async () => {
    if (!prepared || exporting) return;
    const current = prepared;
    const filename = (target.files[0]?.name.replace(/\.xlsx$/i, '') || 'SINIF DERS NETLERİ') + ' - Güncel.xlsx';
    exporting = true;
    exportButton.disabled = true;
    downloadStatus.removeAttribute('data-error');
    downloadStatus.textContent = 'Excel hazırlanıyor…';
    try {
      const blob = await current.generate();
      if (prepared !== current) return;
      download(blob, filename);
      setStep(2);
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
  for (const control of [target, reportInput, reportDrop, targetPicker, templateDownload]) control.disabled = false;
  setStep(0);
})();
