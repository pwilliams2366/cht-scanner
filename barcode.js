/* Code 128 (set C, numeric) barcode as SVG, for printing bulk-tank labels.
   Pattern table: standard Code 128 bar/space widths. */
(function (global) {
  "use strict";
  const P = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"];
  function modules(digits) {
    if (!/^\d+$/.test(digits) || digits.length % 2) throw new Error("Tank codes must be an even number of digits");
    const vals = [105];
    for (let i = 0; i < digits.length; i += 2) vals.push(Number(digits.slice(i, i + 2)));
    let sum = 105;
    for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
    vals.push(sum % 103, 106);
    return vals.map((v) => P[v]).join("");
  }
  function svg(digits, moduleWidth = 2.4, height = 90) {
    const widths = modules(digits);
    const quiet = 12;
    let x = quiet, rects = "";
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]) * moduleWidth;
      if (i % 2 === 0) rects += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}"/>`;
      x += w;
    }
    const total = x + quiet * moduleWidth;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total.toFixed(2)} ${height}" width="${total.toFixed(0)}" height="${height}" shape-rendering="crispEdges" fill="#000">${rects}</svg>`;
  }
  // ---- Printable label sheet as a PDF (iPad Home Screen apps can't use window.print) ----
  function pdfText(str) {
    return String(str).replace(/[^\x20-\x7E]/g, "-").replace(/([\\()])/g, "\\$1");
  }
  function clip(str, max) { str = String(str); return str.length > max ? str.slice(0, max - 1) + "." : str; }

  function labelsPdf(tanks) {
    const PW = 612, PH = 792, M = 36, GAP = 18, COLS = 2, ROWS = 4;
    const LW = (PW - 2 * M - (COLS - 1) * GAP) / COLS;
    const LH = (PH - 2 * M - (ROWS - 1) * GAP) / ROWS;
    const perPage = COLS * ROWS;
    const pages = [];
    for (let i = 0; i < tanks.length; i += perPage) pages.push(tanks.slice(i, i + perPage));

    const streams = pages.map((group) => {
      let c = "";
      group.forEach((t, k) => {
        const col = k % COLS, row = Math.floor(k / COLS);
        const x0 = M + col * (LW + GAP);
        const yTop = PH - M - row * (LH + GAP);
        const y0 = yTop - LH;
        const pad = 12;
        c += `1.5 w 0 0 0 RG ${x0.toFixed(2)} ${y0.toFixed(2)} ${LW.toFixed(2)} ${LH.toFixed(2)} re S\n`;
        const txt = (font, size, x, y, str) => { c += `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfText(str)}) Tj ET\n`; };
        txt("F2", 7.5, x0 + pad, yTop - 16, "CHAPEL HILL TIRE  -  BULK TANK");
        txt("F2", 14, x0 + pad, yTop - 34, clip(t.name, 30));
        txt("F1", 8.5, x0 + pad, yTop - 48, clip(`Part ${t.part}  -  ${t.store}`, 52));
        // barcode
        const widths = modules(t.code);
        const total = [...widths].reduce((n, d) => n + Number(d), 0);
        const mw = Math.min(2.0, (LW - 2 * pad - 20) / total);
        const bh = 52;
        let bx = x0 + (LW - total * mw) / 2;
        const by = y0 + 34;
        c += "0 0 0 rg\n";
        for (let i = 0; i < widths.length; i++) {
          const w = Number(widths[i]) * mw;
          if (i % 2 === 0) c += `${bx.toFixed(3)} ${by.toFixed(2)} ${w.toFixed(3)} ${bh} re f\n`;
          bx += w;
        }
        txt("F3", 11, x0 + (LW - t.code.length * 6.6) / 2, y0 + 21, t.code);
        txt("F1", 7, x0 + pad, y0 + 8, "Scan, then enter the gallons shown on the tank gauge");
      });
      return c;
    });

    // Assemble PDF objects: 1 catalog, 2 pages, 3-5 fonts, then page/content pairs
    const objs = [];
    const pageIds = pages.map((_, i) => 6 + i * 2);
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => id + " 0 R").join(" ")}] /Count ${pages.length} >>`;
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>";
    streams.forEach((st, i) => {
      const pid = pageIds[i], cid = pid + 1;
      objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${cid} 0 R >>`;
      objs[cid] = `<< /Length ${st.length} >>\nstream\n${st}endstream`;
    });
    let out = "%PDF-1.4\n";
    const offsets = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Blob([out], { type: "application/pdf" });
  }

  global.CHTBarcode = { modules, svg, labelsPdf, _labelsPdfText: (t) => labelsPdf(t) };
})(typeof window !== "undefined" ? window : globalThis);
