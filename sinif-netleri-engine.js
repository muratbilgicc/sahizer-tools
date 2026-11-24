(function (root) {
  'use strict';

  const { AktarimHatasi, normalize, trialNumber, numericString, loadWorkbook, patchSheetXml, exportWorkbook } = root.NetWorkbook;

  const tyt = [
    ['TÜRKÇE', 'TÜRKÇE(T)'], ['TARİH', 'TARİH(T)'], ['COĞ', 'COĞRAFYA(T)'],
    ['FELSEFE', 'FELSEFE(T)'], ['MAT 1', 'T.MATEMATİK(T)'], ['GEO', 'GEOMETRİ(T)']
  ];
  const science = [['FİZİK', 'FİZİK(T)'], ['KİMYA', 'KİMYA(T)']];
  const aytMath = [['MAT 2', 'MATEMATİK(A)'], ['GEO 2', 'GEOMETRİ(A)']];
  const groups = {
    TYT: { TYT: [...tyt, ...science, ['BİYO', 'BİYOLOJİ(T)']] },
    TM: {
      TYT: tyt,
      AYT: [...aytMath, ['EDEBİYAT', 'TÜRK DİLİ VE EDEBİYATI(A)'], ['TAR 1', 'TARİH-1(A)'], ['COĞ 1', 'COĞRAFYA-1(A)']]
    },
    MF: {
      TYT: [tyt[0], ['MATEMATİK', tyt[4][1]], ['GEOMETRİ', tyt[5][1]], ...science, ['BİYOLOJİ', 'BİYOLOJİ(T)']],
      AYT: [...aytMath, ['FİZİK 2', 'FİZİK(A)'], ['KİMYA 2', 'KİMYA(A)'], ['BİYO 2', 'BİYOLOJİ(A)']]
    },
    LGS: { LGS: [
      ['TÜRKÇE', 'TÜRKÇE'], ['MAT', 'MATEMATİK'], ['FEN BİL.', 'FEN BİLİMLERİ'],
      ['İNK. TARİH', 'T.C. İNKILAP TARİHİ VE ATATÜRKÇÜLÜK'], ['İNG.', 'YABANCI DİL']
    ] }
  };

  function classKey(value, lgs) {
    const label = String(value).trim().replace(/^12\s*\/\s*12(?=\s|[A-Z])/i, '12');
    const key = normalize(label);
    if (lgs) return key.replace(/^8(?=[A-Z])/, '');
    return key.replace(/^M(?:ZN)?(?=(?:MF|TM|TYT|TS)[A-Z0-9]+$)/, 'MZN');
  }

  function headerColumns(sheet, row, firstColumn, lastColumn) {
    const columns = new Map();
    for (const [reference, value] of sheet.cells) {
      const [, column, number] = /^([A-Z]+)(\d+)$/.exec(reference) || [];
      const index = column && Array.from(column).reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0);
      if (Number(number) !== row || index < firstColumn || index > lastColumn || !value) continue;
      const key = normalize(value);
      if (columns.has(key)) throw new AktarimHatasi(`Yinelenen ders başlığı: ${value}.`);
      columns.set(key, column);
    }
    return columns;
  }

  function examNumbers(workbook, sessions) {
    const found = Object.fromEntries(sessions.map(session => [session, new Set()]));
    for (const sheet of Object.values(workbook.sheets)) {
      const title = String(sheet.cells.get('D5') || '').toUpperCase();
      for (const [, session, number] of title.matchAll(/(?:^|[^A-Z0-9])(LGS|TYT|AYT)[\s_-]*(\d+)(?![A-Z0-9])/g)) {
        if (found[session]) found[session].add(Number(number));
      }
    }
    return Object.fromEntries(sessions.map(session => {
      if (found[session].size > 1) throw new AktarimHatasi(`Rapor birden fazla ${session} denemesi içeriyor. Tek denemelik rapor seç.`);
      return [session, [...found[session]][0] || null];
    }));
  }

  async function readReport(bytes) {
    const workbook = await loadWorkbook(bytes);
    const sheet = Object.entries(workbook.sheets).find(([name]) => normalize(name) === 'GENELISTATISTIKLER')?.[1];
    if (!sheet || normalize(sheet.cells.get('A2')) !== 'SUBE') {
      throw new AktarimHatasi('Raporda Genel İstatistikler sayfası ve ŞUBE başlığı bulunamadı.');
    }
    const columns = headerColumns(sheet, 2, 2, Infinity);
    const isLgs = columns.has('FENBILIMLERI') && columns.has('TURKCE');
    const sessions = isLgs ? ['LGS'] : ['TYT', 'AYT'].filter(session =>
      Object.values(groups).some(group => group[session]?.some(([, header]) => columns.has(normalize(header))))
    );
    if (!sessions.length) throw new AktarimHatasi('Raporda YKS veya LGS ders başlıkları bulunamadı.');

    const classes = new Map();
    for (const [reference, label] of sheet.cells) {
      if (!/^A\d+$/.test(reference) || Number(reference.slice(1)) < 3 || !label.trim()) continue;
      const key = classKey(label, isLgs);
      const valid = isLgs ? /^8\s*[A-ZÇĞİÖŞÜ]/i.test(label.trim()) : /^(?:12|MZN)(?:MF|TM|TYT|TS)[A-Z0-9]+$/.test(key);
      if (!valid) continue;
      if (classes.has(key)) throw new AktarimHatasi(`Raporda aynı şube birden fazla kez yer alıyor: ${label}.`);
      classes.set(key, { label, row: reference.slice(1) });
    }
    if (!classes.size) throw new AktarimHatasi('Raporda aktarılabilir şube bulunamadı.');
    return { sheet, columns, classes, sessions, numbers: examNumbers(workbook, sessions) };
  }

  function findTargetRows(sheet, isLgs) {
    const rows = new Map();
    const classLabels = new Map();
    const positions = [...sheet.cells.keys()].filter(ref => /^[AB]\d+$/.test(ref))
      .map(ref => Number(ref.slice(1))).filter(row => row > 3);
    let current = null;
    for (const row of [...new Set(positions)].sort((a, b) => a - b)) {
      const label = sheet.cells.get('A' + row);
      if (label?.trim()) {
        current = classKey(label, isLgs);
        if (classLabels.has(current)) throw new AktarimHatasi(`Ana dosyada şube tekrarlanıyor: ${label.trim()}.`);
        classLabels.set(current, label.trim());
      }
      const trial = trialNumber(sheet.cells.get('B' + row));
      if (!current || trial === null) continue;
      const key = current + '|' + trial;
      if (rows.has(key)) throw new AktarimHatasi(`Ana dosyada deneme satırı tekrarlanıyor: ${classLabels.get(current)}, ${trial}. deneme.`);
      rows.set(key, row);
    }
    return { rows, classLabels };
  }

  async function prepare(targetBytes, report, trials) {
    for (const session of report.sessions) {
      if (!Number.isInteger(trials[session]) || trials[session] < 1) {
        throw new AktarimHatasi(`${session} için hedef deneme numarasını gir.`);
      }
    }

    const target = await loadWorkbook(targetBytes);
    const changes = [];
    const missingRows = [];
    const missingClasses = [];
    const matched = new Set();
    const patches = new Map();
    let preserved = 0;
    let empty = 0;

    for (const [name, sessions] of Object.entries(groups)) {
      const active = report.sessions.filter(session => sessions[session]);
      if (!active.length) continue;
      const sheet = target.sheets[name];
      if (!sheet || normalize(sheet.cells.get('A3')) !== 'SINIF') {
        throw new AktarimHatasi(`Ana dosyada ${name} sınıf tablosu bulunamadı.`);
      }

      const { rows, classLabels } = findTargetRows(sheet, name === 'LGS');
      const subjectCount = Object.values(sessions).reduce((count, subjects) => count + subjects.length, 0);
      const columns = headerColumns(sheet, 3, 3, 2 + subjectCount);
      const updates = new Map();

      for (const session of active) {
        const subjects = sessions[session].map(([label, heading]) => {
          const sourceColumn = report.columns.get(normalize(heading));
          const targetColumn = columns.get(normalize(label));
          if (!sourceColumn || !targetColumn) throw new AktarimHatasi(`${name} / ${session} ders başlığı eksik: ${!sourceColumn ? heading : label}.`);
          return { label, sourceColumn, targetColumn };
        });

        for (const [key, label] of classLabels) {
          const source = report.classes.get(key);
          if (!source) {
            if (!missingClasses.includes(label)) missingClasses.push(label);
            continue;
          }
          matched.add(key);
          const trial = trials[session];
          const row = rows.get(key + '|' + trial);
          if (!row) {
            missingRows.push(`${label} · ${session} · ${trial}. Deneme`);
            continue;
          }

          for (const { label: subject, sourceColumn, targetColumn } of subjects) {
            const cell = targetColumn + row;
            if (sheet.occupied.has(cell)) {
              preserved++;
              continue;
            }
            const value = numericString(report.sheet.cells.get(sourceColumn + source.row));
            if (value === null) {
              empty++;
              continue;
            }
            updates.set(cell, value);
            changes.push({ sheet: name, label, session, trial, subject, cell, value });
          }
        }
      }
      if (updates.size) patches.set(sheet.path, patchSheetXml(sheet.xml, updates, name));
    }

    const unmatched = [...report.classes].filter(([key]) => !matched.has(key)).map(([, entry]) => entry.label);
    return { changes, preserved, empty, unmatched, missingRows, missingClasses, generate: () => exportWorkbook(target, patches) };
  }

  root.SinifNetleriEngine = { readReport, prepare };
})(globalThis);
