/* Minimal, dependency-free XLSX + ZIP writer for the CHT Inventory Scanner.
   Produces the same workbook layout as excel_report.py (Windows app). */
(function (global) {
  "use strict";

  // ---------- ZIP (store method, no compression) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    // files: [{name, data: Uint8Array}]
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // store
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, f.data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, dosTime, true);
      cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, size, true);
      cen.setUint32(24, size, true);
      cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);

      offset += 30 + nameBytes.length + size;
    }

    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  // ---------- XML helpers ----------
  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function colLetter(n) {
    // 1-based
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  // ---------- Styles (fixed palette matching excel_report.py) ----------
  const NAVY = "FF17324D", BLUE = "FFDCEAF7", GREEN = "FFE2F2EA", RED = "FFFCE4E4", WHITE = "FFFFFFFF";
  const NUM = 164, CUR = 165;
  // cellXfs indexes
  const S = { normal: 0, header: 1, title: 2, bold: 3, num: 4, cur: 5, note: 6, group: 7, boldNum: 8, done: 9 };

  const STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2">' +
    `<numFmt numFmtId="${NUM}" formatCode="#,##0.00"/>` +
    `<numFmt numFmtId="${CUR}" formatCode="&quot;$&quot;#,##0.00;[Red]-&quot;$&quot;#,##0.00"/>` +
    "</numFmts>" +
    '<fonts count="4">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    `<font><b/><sz val="11"/><color rgb="${WHITE}"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="16"/><color rgb="${WHITE}"/><name val="Calibri"/><family val="2"/></font>` +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    "</fonts>" +
    '<fills count="5">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    `<fill><patternFill patternType="solid"><fgColor rgb="${NAVY}"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="${BLUE}"/><bgColor indexed="64"/></patternFill></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D6"/><bgColor indexed="64"/></patternFill></fill>` +
    "</fills>" +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FF9FB3C8"/></left><right style="thin"><color rgb="FF9FB3C8"/></right><top style="thin"><color rgb="FF9FB3C8"/></top><bottom style="thin"><color rgb="FF9FB3C8"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="10">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    `<xf numFmtId="${NUM}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="${CUR}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '<dxfs count="2">' +
    `<dxf><fill><patternFill patternType="solid"><fgColor rgb="${RED}"/><bgColor rgb="${RED}"/></patternFill></fill></dxf>` +
    `<dxf><fill><patternFill patternType="solid"><fgColor rgb="${GREEN}"/><bgColor rgb="${GREEN}"/></patternFill></fill></dxf>` +
    "</dxfs>" +
    "</styleSheet>";

  // ---------- Sheet model ----------
  class Sheet {
    constructor(name) {
      this.name = name;
      this.cells = new Map(); // "r,c" -> {v, f, s}
      this.maxRow = 0;
      this.maxCol = 0;
      this.widths = {};
      this.merges = [];
      this.freeze = null; // row number to freeze above, e.g. 2
      this.autoFilter = null;
      this.gridLines = true;
      this.condFormats = []; // {ref, rules:[{op, value, dxf}]}
    }
    set(r, c, value, style) {
      const key = r + "," + c;
      const cell = this.cells.get(key) || {};
      if (value !== undefined) {
        if (value && typeof value === "object" && "f" in value) {
          cell.f = value.f.replace(/^=/, "");
          cell.cv = value.v;
          cell.v = undefined;
        } else if (typeof value === "string" && value.startsWith("=")) {
          cell.f = value.slice(1);
          cell.v = undefined;
        } else {
          cell.v = value;
          cell.f = undefined;
        }
      }
      if (style !== undefined) cell.s = style;
      this.cells.set(key, cell);
      this.maxRow = Math.max(this.maxRow, r);
      this.maxCol = Math.max(this.maxCol, c);
    }
    style(r, c, style) {
      this.set(r, c, undefined, style);
    }
    get(r, c) {
      return this.cells.get(r + "," + c);
    }
    appendRow(values, style) {
      const r = this.maxRow + 1;
      values.forEach((v, i) => this.set(r, i + 1, v === null ? undefined : v, style));
      if (!values.length) this.maxRow = r;
      return r;
    }
    toXml() {
      const parts = [];
      parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
      parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
      const dim = this.maxRow && this.maxCol ? `A1:${colLetter(this.maxCol)}${this.maxRow}` : "A1";
      parts.push(`<dimension ref="${dim}"/>`);
      let view = `<sheetView workbookViewId="0"${this.gridLines ? "" : ' showGridLines="0"'}>`;
      if (this.freeze) {
        view += `<pane ySplit="${this.freeze - 1}" topLeftCell="A${this.freeze}" activePane="bottomLeft" state="frozen"/>`;
        view += `<selection pane="bottomLeft" activeCell="A${this.freeze}" sqref="A${this.freeze}"/>`;
      }
      view += "</sheetView>";
      parts.push(`<sheetViews>${view}</sheetViews>`);
      parts.push('<sheetFormatPr defaultRowHeight="15"/>');
      const colKeys = Object.keys(this.widths).map(Number).sort((a, b) => a - b);
      if (colKeys.length) {
        parts.push("<cols>");
        for (const c of colKeys) parts.push(`<col min="${c}" max="${c}" width="${this.widths[c]}" customWidth="1"/>`);
        parts.push("</cols>");
      }
      parts.push("<sheetData>");
      const byRow = new Map();
      for (const [key, cell] of this.cells) {
        const [r, c] = key.split(",").map(Number);
        if (!byRow.has(r)) byRow.set(r, []);
        byRow.get(r).push([c, cell]);
      }
      for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
        const cells = byRow.get(r).sort((a, b) => a[0] - b[0]);
        parts.push(`<row r="${r}">`);
        for (const [c, cell] of cells) {
          const ref = colLetter(c) + r;
          const s = cell.s ? ` s="${cell.s}"` : "";
          if (cell.f !== undefined) {
            const cv = cell.cv;
            if (typeof cv === "number" && isFinite(cv)) parts.push(`<c r="${ref}"${s}><f>${esc(cell.f)}</f><v>${cv}</v></c>`);
            else if (typeof cv === "string") parts.push(`<c r="${ref}"${s} t="str"><f>${esc(cell.f)}</f><v>${esc(cv)}</v></c>`);
            else parts.push(`<c r="${ref}"${s}><f>${esc(cell.f)}</f></c>`);
          } else if (typeof cell.v === "number" && isFinite(cell.v)) {
            parts.push(`<c r="${ref}"${s}><v>${cell.v}</v></c>`);
          } else if (typeof cell.v === "boolean") {
            parts.push(`<c r="${ref}"${s} t="b"><v>${cell.v ? 1 : 0}</v></c>`);
          } else if (cell.v !== undefined && cell.v !== null) {
            parts.push(`<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`);
          } else {
            parts.push(`<c r="${ref}"${s}/>`);
          }
        }
        parts.push("</row>");
      }
      parts.push("</sheetData>");
      if (this.autoFilter) parts.push(`<autoFilter ref="${this.autoFilter}"/>`);
      if (this.merges.length) {
        parts.push(`<mergeCells count="${this.merges.length}">`);
        for (const m of this.merges) parts.push(`<mergeCell ref="${m}"/>`);
        parts.push("</mergeCells>");
      }
      let priority = 1;
      for (const cf of this.condFormats) {
        parts.push(`<conditionalFormatting sqref="${cf.ref}">`);
        for (const rule of cf.rules) {
          parts.push(`<cfRule type="cellIs" dxfId="${rule.dxf}" priority="${priority++}" operator="${rule.op}"><formula>${esc(rule.value)}</formula></cfRule>`);
        }
        parts.push("</conditionalFormatting>");
      }
      parts.push('<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>');
      parts.push("</worksheet>");
      return parts.join("");
    }
  }

  function buildWorkbook(sheets) {
    const enc = new TextEncoder();
    const files = [];
    const ct =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      "</Types>";
    files.push({ name: "[Content_Types].xml", data: enc.encode(ct) });
    files.push({
      name: "_rels/.rels",
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>"
      ),
    });
    const defined = sheets
      .map((s, i) => (s.autoFilter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!${s.autoFilter.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2")}</definedName>` : ""))
      .join("");
    const wb =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      "</sheets>" +
      (defined ? `<definedNames>${defined}</definedNames>` : "") +
      '<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>' +
      "</workbook>";
    files.push({ name: "xl/workbook.xml", data: enc.encode(wb) });
    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      "</Relationships>";
    files.push({ name: "xl/_rels/workbook.xml.rels", data: enc.encode(rels) });
    files.push({ name: "xl/styles.xml", data: enc.encode(STYLES_XML) });
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(s.toXml()) }));
    return zip(files);
  }

  // Python str() of a value, used only to size columns like openpyxl _fit_columns
  function pyLen(v, isInt) {
    if (v === undefined || v === null) return 0;
    if (typeof v === "number") return (Number.isInteger(v) && !isInt ? v + ".0" : String(v)).length;
    return String(v).length;
  }

  function fitColumns(sheet, minimum = 10, maximum = 34, intCols = new Set()) {
    for (let c = 1; c <= sheet.maxCol; c++) {
      let width = 0;
      for (let r = 1; r <= sheet.maxRow; r++) {
        const cell = sheet.get(r, c);
        if (!cell) continue;
        if (cell.noFit) continue;
        const val = cell.f !== undefined ? "=" + cell.f : cell.v;
        width = Math.max(width, pyLen(val, intCols.has(c)));
      }
      sheet.widths[c] = Math.min(Math.max(width + 2, minimum), maximum);
    }
  }

  // ---------- Report (mirror of excel_report.export_excel_report) ----------
  function buildInventoryReport(rows, storeName, countTimestamp, countMode, countScope) {
    const summary = new Sheet("Summary");
    const details = new Sheet("Count Details");
    const exceptions = new Sheet("Exceptions and WIP");

    const detailHeaders = [
      "Store", "Count Timestamp", "Part Number", "Part Name", "Brand", "BIN#", "Part Type",
      "Count Scope", "Included", "Tekmetric In-Stock", "WIP", "Available", "Net",
      "Physical Count", "Difference", "Unit Cost", "Retail", "Value Impact", "Counted Value", "Status",
      "Reconciliation Note",
    ];
    details.appendRow(detailHeaders, S.header);

    const calc = rows.map((row) => {
      const diff = row.included ? row.physical_count - row.in_stock : "";
      const impact = row.included ? diff * row.cost : 0;
      // Excel treats "" in O as text: comparisons with numbers make it greater than any number
      const status = !row.included ? "EXCLUDED" : diff < 0 ? "SHORT" : diff > 0 ? "OVER" : "MATCH";
      return { diff, impact, status };
    });
    rows.forEach((row, i) => {
      const n = i + 2, k = calc[i];
      details.appendRow([
        row.store, row.count_timestamp, row.part_number, row.name, row.brand, row.bin,
        row.part_type, row.count_scope, row.included ? "Yes" : "No", row.in_stock, row.wip,
        row.available, row.net, row.physical_count,
        { f: `=IF(I${n}="Yes",N${n}-J${n},"")`, v: k.diff },
        row.cost, row.retail,
        { f: `=IF(I${n}="Yes",O${n}*P${n},0)`, v: k.impact },
        { f: `=N${n}*P${n}`, v: row.physical_count * row.cost },
        { f: `=IF(I${n}="No","EXCLUDED",IF(O${n}<0,"SHORT",IF(O${n}>0,"OVER","MATCH")))`, v: k.status },
        row.note,
      ]);
    });

    const last = Math.max(details.maxRow, 2);
    details.freeze = 2;
    details.autoFilter = `A1:U${last}`;
    details.gridLines = false;
    for (const c of [10, 11, 12, 13, 14, 15]) for (let r = 2; r <= last; r++) details.style(r, c, S.num);
    for (const c of [16, 17, 18, 19]) for (let r = 2; r <= last; r++) details.style(r, c, S.cur);
    details.condFormats.push({
      ref: `R2:R${last}`,
      rules: [{ op: "lessThan", value: "0", dxf: 0 }],
    });
    details.condFormats.push({
      ref: `R2:R${last}`,
      rules: [{ op: "greaterThan", value: "0", dxf: 1 }],
    });

    summary.set(1, 1, "Inventory Count Value Summary", S.title);
    for (let c = 2; c <= 4; c++) summary.style(1, c, S.title);
    summary.merges.push("A1:D1");
    [["Store", storeName], ["Count timestamp", countTimestamp], ["Count mode", countMode], ["Count scope", countScope]]
      .forEach(([label, value], i) => {
        summary.set(3 + i, 1, label, S.bold);
        summary.set(3 + i, 2, value);
      });
    const L = last;
    const inc = rows.map((r, i) => [r, calc[i]]).filter(([r]) => r.included);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const metrics = [
      ["Physical items counted", `=SUMIF('Count Details'!I2:I${L},"Yes",'Count Details'!N2:N${L})`, sum(inc.map(([r]) => r.physical_count))],
      ["Products physically counted", `=COUNTIFS('Count Details'!I2:I${L},"Yes",'Count Details'!N2:N${L},">0")`, inc.filter(([r]) => r.physical_count > 0).length],
      ["Differences", `=COUNTIFS('Count Details'!I2:I${L},"Yes",'Count Details'!O2:O${L},"<>0")`, inc.filter(([, k]) => k.diff !== 0).length],
      ["Increased", `=COUNTIFS('Count Details'!I2:I${L},"Yes",'Count Details'!O2:O${L},">0")`, inc.filter(([, k]) => k.diff > 0).length],
      ["Decreased", `=COUNTIFS('Count Details'!I2:I${L},"Yes",'Count Details'!O2:O${L},"<0")`, inc.filter(([, k]) => k.diff < 0).length],
      ["Excluded records", `=COUNTIF('Count Details'!I2:I${L},"No")`, rows.length - inc.length],
      ["Records with WIP", `=COUNTIFS('Count Details'!I2:I${L},"Yes",'Count Details'!K2:K${L},">0")`, inc.filter(([r]) => r.wip > 0).length],
      ["Positive value impact", `=SUMIF('Count Details'!R2:R${L},">0",'Count Details'!R2:R${L})`, sum(calc.map((k) => k.impact).filter((v) => v > 0))],
      ["Negative value impact", `=SUMIF('Count Details'!R2:R${L},"<0",'Count Details'!R2:R${L})`, sum(calc.map((k) => k.impact).filter((v) => v < 0))],
      ["Net value change", `=SUM('Count Details'!R2:R${L})`, sum(calc.map((k) => k.impact))],
    ];
    summary.set(8, 1, "Metric", S.header);
    summary.set(8, 2, "Result", S.header);
    metrics.forEach(([label, formula, value], i) => {
      const r = 9 + i;
      summary.set(r, 1, label);
      summary.set(r, 2, { f: formula, v: value }, label.toLowerCase().includes("value") ? S.cur : undefined);
    });
    // Inventory value at unit cost (included items only)
    const D = (col) => `'Count Details'!${col}2:${col}${L}`;
    const isTire = (r) => r.part_type.trim().toLowerCase() === "tire";
    const valueRows = [
      ["Tires counted (units)", `=SUMIFS(${D("N")},${D("I")},"Yes",${D("G")},"Tire")`,
        sum(inc.filter(([r]) => isTire(r)).map(([r]) => r.physical_count)), false],
      ["Tires counted value", `=SUMIFS(${D("S")},${D("I")},"Yes",${D("G")},"Tire")`,
        sum(inc.filter(([r]) => isTire(r)).map(([r]) => r.physical_count * r.cost)), true],
      ["Tires value in Tekmetric", `=SUMPRODUCT((${D("I")}="Yes")*(${D("G")}="Tire")*${D("J")}*${D("P")})`,
        sum(inc.filter(([r]) => isTire(r)).map(([r]) => r.in_stock * r.cost)), true],
      ["All other items counted value", `=SUMIFS(${D("S")},${D("I")},"Yes",${D("G")},"<>Tire")`,
        sum(inc.filter(([r]) => !isTire(r)).map(([r]) => r.physical_count * r.cost)), true],
      ["Total counted value", `=SUMIFS(${D("S")},${D("I")},"Yes")`,
        sum(inc.map(([r]) => r.physical_count * r.cost)), true],
    ];
    summary.set(20, 1, "Inventory Value (unit cost)", S.header);
    summary.set(20, 2, "Result", S.header);
    valueRows.forEach(([label, formula, value, money], i) => {
      summary.set(21 + i, 1, label, label.startsWith("Total") ? S.bold : undefined);
      summary.set(21 + i, 2, { f: formula, v: value }, money ? S.cur : undefined);
    });

    summary.set(27, 1, "Important", S.bold);
    summary.set(
      28, 1,
      "Value impact and counted value use Tekmetric unit cost. Excluded inventory contributes $0. " +
        "WIP is shown for review and does not automatically change the variance. " +
        "In a Partial or Test count, only scanned items are included in these totals.",
      S.note
    );
    for (const [r, c] of [[28, 2], [28, 3], [28, 4], [29, 1], [29, 2], [29, 3], [29, 4], [30, 1], [30, 2], [30, 3], [30, 4]]) summary.style(r, c, S.note);
    summary.merges.push("A28:D30");
    summary.gridLines = false;

    const exceptionHeaders = [
      "Part Number", "Part Name", "Part Type", "BIN#", "In-Stock", "WIP", "Physical Count",
      "Difference", "Value Impact", "Status", "Reconciliation Note",
    ];
    exceptions.appendRow(exceptionHeaders, S.header);
    for (const row of rows) {
      if (!row.included) continue;
      const difference = row.physical_count - row.in_stock;
      if (difference === 0 && row.wip === 0) continue;
      const status = difference < 0 ? "SHORT" : difference > 0 ? "OVER" : "MATCH";
      const r = exceptions.appendRow([
        row.part_number, row.name, row.part_type, row.bin, row.in_stock, row.wip,
        row.physical_count, difference, difference * row.cost, status, row.note,
      ]);
      exceptions.style(r, 9, S.cur);
    }
    exceptions.freeze = 2;
    exceptions.autoFilter = `A1:K${Math.max(exceptions.maxRow, 2)}`;
    exceptions.gridLines = false;

    const changes = buildChangesSheet(rows, storeName, countTimestamp, countMode);

    fitColumns(summary, 10, 42);
    fitColumns(details, 10, 34, new Set([14]));
    fitColumns(exceptions, 10, 34, new Set([7]));
    summary.widths[1] = 30;
    summary.widths[2] = 24;

    return buildWorkbook([summary, changes, details, exceptions]);
  }

  // ---------- "Tekmetric Changes" worksheet ----------
  // Shelf areas, in the order a technician would work through them.
  const AREAS = [
    { name: "Tires", test: (r) => /^tire$/i.test(r.part_type) },
    { name: "Oil Filters & Drain Plugs", bins: ["OLF"] },
    { name: "Air & Cabin Filters", bins: ["AF"] },
    { name: "Motor Oil (Bottles & Bulk)", bins: ["OSYN", "OSB", "OMOB", "OD", "FLUID", "GOIL"] },
    { name: "Transmission Fluids", bins: ["TRN", "OTRAN"] },
    { name: "Chemicals & BG Products", bins: ["CH", "SS"] },
    { name: "A/C", bins: ["AC"] },
    { name: "Wiper Blades", bins: ["WWB"] },
    { name: "Bulbs", bins: ["BLB"] },
    { name: "Batteries & Battery Parts", bins: ["BAT", "BATMI"], test: (r) => /^battery$/i.test(r.part_type) },
    { name: "Brakes, Steering & Suspension", bins: ["BRA", "CHA", "SUSP", "BK"] },
    { name: "Non-Stock Items (fees, credits) – check before changing", bins: ["TWC", "UNI", "VR"],
      test: (r) => /\b(SHIPPING|DELIVERY CHARGE|WARRANTY CREDIT|REBATE|UNIFORMS?)\b/i.test(r.name || "") },
    { name: "Other Parts (by BIN)", other: true },
  ];
  function areaIndex(row) {
    const bin = String(row.bin || "").trim().toUpperCase();
    const nonStock = AREAS.length - 2;
    if (AREAS[nonStock].test(row) || AREAS[nonStock].bins.includes(bin)) return nonStock;
    for (let i = 0; i < AREAS.length; i++) {
      const a = AREAS[i];
      if (a.other) return i;
      if ((a.test && a.test(row)) || (a.bins && a.bins.includes(bin))) return i;
    }
    return AREAS.length - 1;
  }
  const round2 = (x) => Math.round(x * 100) / 100;

  function buildChangesSheet(rows, storeName, countTimestamp, countMode) {
    const ws = new Sheet("Tekmetric Changes");
    const items = rows
      .filter((r) => r.included && round2(r.physical_count - r.in_stock) !== 0)
      .map((r) => ({ r, area: areaIndex(r), diff: round2(r.physical_count - r.in_stock) }));
    items.sort((a, b) =>
      a.area - b.area ||
      String(a.r.bin || "~").localeCompare(String(b.r.bin || "~")) ||
      String(a.r.part_number).localeCompare(String(b.r.part_number), undefined, { numeric: true }));

    ws.set(1, 1, `Tekmetric Changes – ${storeName}`, S.bold);
    ws.set(2, 1, `Counted ${countTimestamp} (${countMode}). ${items.length} parts need their Tekmetric quantity changed. ` +
      'Type the number in "Set Tekmetric To" for each part, then mark Done.');
    const head = ["BIN#", "Part Number", "Description", "Tekmetric Qty", "Counted", "Difference", "Set Tekmetric To", "Status", "Note", "Done"];
    const H = 4;
    head.forEach((h, i) => ws.set(H, i + 1, h, S.header));
    let r = H;
    let currentArea = -1;
    for (const it of items) {
      if (it.area !== currentArea) {
        currentArea = it.area;
        const count = items.filter((x) => x.area === currentArea).length;
        r++;
        ws.set(r, 1, `${AREAS[currentArea].name.toUpperCase()}  (${count})`, S.group);
        for (let c = 2; c <= head.length; c++) ws.style(r, c, S.group);
        ws.get(r, 1).noFit = true;
      }
      const row = it.r;
      const desc = [row.brand, row.name].filter(Boolean).join(" – ") || "—";
      let note = "";
      if (row.physical_count === 0 && row.in_stock > 0) note = "Not scanned – confirm it's really gone before setting to 0";
      else if (row.wip !== 0) note = "Has WIP – check the open repair order first";
      r++;
      ws.set(r, 1, row.bin || "");
      ws.set(r, 2, row.part_number);
      ws.set(r, 3, desc);
      ws.set(r, 4, round2(row.in_stock));
      ws.set(r, 5, round2(row.physical_count));
      ws.set(r, 6, it.diff);
      ws.set(r, 7, round2(row.physical_count), S.boldNum);
      ws.set(r, 8, it.diff < 0 ? "SHORT" : "OVER");
      ws.set(r, 9, note);
      ws.set(r, 10, "", S.done);
    }
    if (!items.length) ws.set(H + 1, 1, "No changes needed – every counted part matches Tekmetric.");
    ws.freeze = H + 1;
    ws.gridLines = true;
    ws.condFormats.push({ ref: `F${H + 1}:F${Math.max(r, H + 1)}`, rules: [{ op: "lessThan", value: "0", dxf: 0 }] });
    ws.condFormats.push({ ref: `F${H + 1}:F${Math.max(r, H + 1)}`, rules: [{ op: "greaterThan", value: "0", dxf: 1 }] });
    ws.get(1, 1).noFit = true;
    ws.get(2, 1).noFit = true;
    fitColumns(ws, 8, 46);
    ws.widths[10] = 8;
    return ws;
  }

  global.CHTXlsx = { buildInventoryReport, Sheet, buildWorkbook, zip, crc32 };
})(typeof window !== "undefined" ? window : globalThis);
