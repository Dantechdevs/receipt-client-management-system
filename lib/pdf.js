const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { fmtMoney } = require('./helpers');
const { amountInWordsLine } = require('./number-to-words');

const NAVY = '#0f2a5c';
const ORANGE = '#f7941d';
const GRAY_LINE = '#94a3b8';
const BORDER = '#1e293b';
const TEXT_DARK = '#1e293b';
const TEXT_MUTED = '#64748b';

function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB');
}

async function buildDocumentPDF({ res, company, doc, items, baseUrl, duplicate = false, docType, config, clauses = [], parties = [], stream = true }) {
  const pdf = new PDFDocument({ size: 'A4', margin: 0 });

  if (stream) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.doc_number}.pdf"`);
    pdf.pipe(res);
  }

  const pageW = pdf.page.width;
  const pageH = pdf.page.height;
  const margin = 36;
  const contentW = pageW - margin * 2;
  const FOOTER_H = 46;

  function drawFooterBand() {
    const bandTop = pageH - FOOTER_H;
    pdf.rect(0, bandTop, pageW, FOOTER_H).fill(NAVY);
    pdf.save();
    pdf.moveTo(pageW * 0.62, bandTop)
      .lineTo(pageW, bandTop)
      .lineTo(pageW, bandTop + FOOTER_H)
      .lineTo(pageW * 0.72, bandTop + FOOTER_H)
      .closePath()
      .fill(ORANGE);
    pdf.restore();
    if (company.footer_message) {
      pdf.font('Helvetica').fontSize(8).fillColor('#ffffff')
        .text(company.footer_message, margin, bandTop + FOOTER_H / 2 - 5, { width: pageW * 0.55, align: 'left' });
    }
  }
  drawFooterBand();

  function newPage() {
    pdf.addPage();
    drawFooterBand();
  }

  let y = 30;
  const logoSize = 56;
  if (company.logo_path) {
    const logoFile = path.join(__dirname, '..', 'public', company.logo_path);
    if (fs.existsSync(logoFile)) {
      try {
        pdf.save();
        pdf.circle(margin + logoSize / 2, y + logoSize / 2, logoSize / 2).clip();
        pdf.image(logoFile, margin, y, { width: logoSize, height: logoSize });
        pdf.restore();
      } catch (e) {}
    }
  }
  const nameX = margin + logoSize + 14;
  const nameW = contentW * 0.5;
  pdf.font('Helvetica-Bold').fontSize(17).fillColor(NAVY).text((company.name || 'Company Name').toUpperCase(), nameX, y, { width: nameW });

  const contactW = 220;
  const contactX = margin + contentW - contactW;
  let cY = y;
  pdf.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED);
  if (company.phone) { pdf.text(`Tel: ${company.phone}`, contactX, cY, { width: contactW, align: 'right' }); cY = pdf.y + 1; }
  if (company.email) { pdf.text(company.email, contactX, cY, { width: contactW, align: 'right' }); cY = pdf.y + 1; }
  if (company.address) { pdf.text(company.address, contactX, cY, { width: contactW, align: 'right' }); cY = pdf.y + 1; }

  y += logoSize + 10;
  pdf.moveTo(margin, y).lineTo(margin + contentW, y).lineWidth(2).strokeColor(NAVY).stroke();
  y += 10;

  const barH = 26;
  const barLabel = duplicate ? `DUPLICATE ${config.label.toUpperCase()}` : config.label.toUpperCase();
  pdf.rect(margin, y, contentW, barH).lineWidth(1).strokeColor(BORDER).stroke();
  pdf.font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text(barLabel, margin, y + 7, { width: contentW, align: 'center' });
  y += barH;

  const infoH = 22;
  const thirdW = contentW / 3;
  pdf.rect(margin, y, contentW, infoH).lineWidth(1).strokeColor(BORDER).stroke();
  pdf.moveTo(margin + thirdW, y).lineTo(margin + thirdW, y + infoH).stroke();
  pdf.moveTo(margin + thirdW * 2, y).lineTo(margin + thirdW * 2, y + infoH).stroke();
  pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(TEXT_DARK);
  pdf.text(`${config.label.toUpperCase()} NO: ${doc.doc_number}`, margin + 8, y + 7, { width: thirdW - 16 });
  pdf.text(`PHONE: ${doc.customer_phone || '—'}`, margin + thirdW + 8, y + 7, { width: thirdW - 16 });
  pdf.text(`DATE: ${fmtDate(doc.issue_date)}`, margin + thirdW * 2 + 8, y + 7, { width: thirdW - 16 });
  y += infoH;

  const fieldH = 20;
  pdf.rect(margin, y, contentW, fieldH).lineWidth(1).strokeColor(BORDER).stroke();
  pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(TEXT_DARK).text('NAME: ', margin + 8, y + 6, { continued: true }).font('Helvetica').text(doc.customer_name);
  y += fieldH;
  pdf.rect(margin, y, contentW, fieldH).lineWidth(1).strokeColor(BORDER).stroke();
  pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(TEXT_DARK).text('ADDRESS: ', margin + 8, y + 6, { continued: true }).font('Helvetica').text(doc.customer_address || '—');
  y += fieldH;

  const metaBits = [`Verification Code: ${doc.verification_code}`, `Status: ${doc.status.toUpperCase()}`];
  if (config.hasValidUntil && doc.valid_until) metaBits.push(`Valid Until: ${fmtDate(doc.valid_until)}`);
  if (config.hasDueDate && doc.due_date) metaBits.push(`Due: ${fmtDate(doc.due_date)}`);
  if (config.hasPaymentStatus && doc.payment_status) metaBits.push(`Payment: ${doc.payment_status.toUpperCase()}`);
  if (config.hasPaymentMethod && doc.payment_method) metaBits.push(`Method: ${doc.payment_method}`);
  if (docType === 'agreement' && doc.effective_date) metaBits.push(`Effective: ${fmtDate(doc.effective_date)}`);
  pdf.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED).text(metaBits.join('   |   '), margin, y + 4, { width: contentW });
  y += 16;

  y += 10;

  if (items && items.length) {
    const colQtyW = 55;
    const colPriceW = 95;
    const colAmtW = 100;
    const colQtyX = margin;
    const colDescX = colQtyX + colQtyW;
    const colDescW = contentW - colQtyW - colPriceW - colAmtW;
    const colPriceX = colDescX + colDescW;
    const colAmtX = colPriceX + colPriceW;

    function drawTableHeader(yy) {
      pdf.rect(margin, yy, contentW, 22).fillAndStroke(ORANGE, BORDER);
      pdf.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
      pdf.text('QTY.', colQtyX, yy + 7, { width: colQtyW, align: 'center' });
      pdf.text('DESCRIPTION', colDescX + 6, yy + 7, { width: colDescW - 10 });
      pdf.text('PRICE', colPriceX, yy + 7, { width: colPriceW - 8, align: 'right' });
      pdf.text('AMOUNT', colAmtX, yy + 7, { width: colAmtW - 8, align: 'right' });
      pdf.lineWidth(1).strokeColor(BORDER);
      pdf.moveTo(colDescX, yy).lineTo(colDescX, yy + 22).stroke();
      pdf.moveTo(colPriceX, yy).lineTo(colPriceX, yy + 22).stroke();
      pdf.moveTo(colAmtX, yy).lineTo(colAmtX, yy + 22).stroke();
      return yy + 22;
    }

    y = drawTableHeader(y);
    pdf.font('Helvetica').fontSize(9).fillColor(TEXT_DARK);

    items.forEach((item) => {
      const descH = pdf.heightOfString(item.description, { width: colDescW - 10, font: 'Helvetica', fontSize: 9 });
      const rowHeight = Math.max(20, descH + 10);

      if (y + rowHeight > pageH - FOOTER_H - 230) {
        newPage();
        y = 40;
        y = drawTableHeader(y);
        pdf.font('Helvetica').fontSize(9).fillColor(TEXT_DARK);
      }
      pdf.rect(margin, y, contentW, rowHeight).lineWidth(0.75).strokeColor(GRAY_LINE).stroke();
      pdf.moveTo(colDescX, y).lineTo(colDescX, y + rowHeight).stroke();
      pdf.moveTo(colPriceX, y).lineTo(colPriceX, y + rowHeight).stroke();
      pdf.moveTo(colAmtX, y).lineTo(colAmtX, y + rowHeight).stroke();

      pdf.font('Helvetica').fontSize(9).fillColor(TEXT_DARK);
      pdf.text(String(item.quantity), colQtyX, y + 5, { width: colQtyW, align: 'center' });
      pdf.text(item.description, colDescX + 6, y + 5, { width: colDescW - 10 });
      pdf.text(fmtMoney(item.unit_price), colPriceX, y + 5, { width: colPriceW - 8, align: 'right' });
      pdf.font('Helvetica-Bold').text(fmtMoney(item.line_total), colAmtX, y + 5, { width: colAmtW - 8, align: 'right' });
      y += rowHeight;
    });

    const hasTax = doc.tax_rate && doc.tax_rate > 0;
    const totalsW = 220;
    const totalsX = margin + contentW - totalsW;
    const rowH = 20;
    let rows = 1;
    if (hasTax) rows = 3;

    pdf.rect(totalsX, y, totalsW, rowH * rows).lineWidth(1).strokeColor(BORDER).stroke();
    pdf.moveTo(totalsX + 110, y).lineTo(totalsX + 110, y + rowH * rows).lineWidth(1).strokeColor(BORDER).stroke();

    let ty = y;
    if (hasTax) {
      pdf.font('Helvetica').fontSize(9).fillColor(TEXT_DARK);
      pdf.text('Subtotal', totalsX + 8, ty + 6, { width: 100 });
      pdf.text(fmtMoney(doc.subtotal), totalsX + 114, ty + 6, { width: totalsW - 122, align: 'right' });
      pdf.moveTo(totalsX, ty + rowH).lineTo(totalsX + totalsW, ty + rowH).lineWidth(0.5).strokeColor(GRAY_LINE).stroke();
      ty += rowH;
      pdf.text(`${doc.tax_label || 'Tax'} (${doc.tax_rate}%)`, totalsX + 8, ty + 6, { width: 100 });
      pdf.text(fmtMoney(doc.tax_amount), totalsX + 114, ty + 6, { width: totalsW - 122, align: 'right' });
      pdf.moveTo(totalsX, ty + rowH).lineTo(totalsX + totalsW, ty + rowH).lineWidth(0.5).strokeColor(GRAY_LINE).stroke();
      ty += rowH;
    }
    pdf.font('Helvetica-Bold').fontSize(10).fillColor(NAVY);
    pdf.text('TOTAL', totalsX + 8, ty + 6, { width: 100 });
    pdf.text(`${company.currency || 'KES'} ${fmtMoney(doc.total)}`, totalsX + 114, ty + 6, { width: totalsW - 122, align: 'right' });
    y += rowH * rows + 12;

    pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(TEXT_DARK).text('Amount in Words: ', margin, y, { continued: true })
      .font('Helvetica-Oblique').fillColor(TEXT_MUTED).text(amountInWordsLine(doc.total, company.currency));
    y = pdf.y + 10;

    if (docType === 'quotation') {
      const disclaimer = doc.valid_until
        ? `This is a quotation only, not a tax invoice. Prices valid until ${fmtDate(doc.valid_until)}.`
        : 'This is a quotation only, not a tax invoice.';
      pdf.font('Helvetica-Oblique').fontSize(8).fillColor(TEXT_MUTED).text(disclaimer, margin, y, { width: contentW });
      y = pdf.y + 8;
    }
  }

  if (clauses && clauses.length) {
    pdf.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text('TERMS & CLAUSES', margin, y);
    y += 16;
    clauses.forEach((clause, idx) => {
      const titleText = `${idx + 1}. ${clause.title || 'Clause'}`;
      const bodyH = pdf.heightOfString(clause.body || '', { width: contentW, font: 'Helvetica', fontSize: 9 });
      const blockH = 16 + bodyH + 8;
      if (y + blockH > pageH - FOOTER_H - 230) {
        newPage();
        y = 40;
      }
      pdf.font('Helvetica-Bold').fontSize(9.5).fillColor(NAVY).text(titleText, margin, y, { width: contentW });
      y = pdf.y + 3;
      pdf.font('Helvetica').fontSize(9).fillColor(TEXT_DARK).text(clause.body || '', margin, y, { width: contentW });
      y = pdf.y + 8;
    });
    y += 4;
  }

  if (doc.notes) {
    pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text('Notes: ', margin, y, { continued: true })
      .font('Helvetica').fillColor(TEXT_MUTED).text(doc.notes);
    y = pdf.y + 10;
  }

  const verifyUrl = `${baseUrl}/verify?code=${doc.verification_code}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 300 });
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  if (docType === 'agreement' && parties && parties.length) {
    const rows = Math.ceil(parties.length / 3);
    const perPartyH = 78;
    const blockH = rows * perPartyH + 30;
    if (y + blockH > pageH - FOOTER_H - 10) { newPage(); y = 40; }

    const colWidth = contentW / 3;
    parties.forEach((party, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const colX = margin + col * colWidth;
      const rowY = y + row * perPartyH;
      const lineW = colWidth - 20;
      pdf.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text((party.role || 'Party').toUpperCase(), colX, rowY, { width: lineW });
      pdf.font('Helvetica').fontSize(9).fillColor(TEXT_DARK).text(party.name || '', colX, rowY + 12, { width: lineW });
      const afterNameY = pdf.y + 2;
      if (party.phone) pdf.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED).text(party.phone, colX, afterNameY, { width: lineW });
      const sigLineY = Math.max(rowY + 46, pdf.y + 12);
      pdf.moveTo(colX, sigLineY).lineTo(colX + lineW, sigLineY).strokeColor(BORDER).lineWidth(1).stroke();
      pdf.font('Helvetica').fontSize(7.5).fillColor(TEXT_MUTED).text('Signature & Date', colX, sigLineY + 4, { width: lineW });
    });
    y += rows * perPartyH + 16;

    pdf.image(qrBuffer, margin, y, { fit: [42, 42] });
    pdf.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED).text(`Scan to verify · Code: ${doc.verification_code}`, margin + 50, y + 15, { width: 220 });
    y += 50;
  } else {
    const blockH = 90;
    if (y + blockH > pageH - FOOTER_H - 10) { newPage(); y = 40; }

    const halfW = contentW / 2;
    const sigLineY = y + 40;
    pdf.moveTo(margin + 10, sigLineY).lineTo(margin + halfW - 20, sigLineY).strokeColor(BORDER).lineWidth(1).stroke();
    pdf.font('Helvetica').fontSize(8.5).fillColor(TEXT_DARK).text("Customer's Signature", margin + 10, sigLineY + 4, { width: halfW - 30 });

    const rightSigX = margin + halfW + 10;
    if (company.signature_path) {
      const sigFile = path.join(__dirname, '..', 'public', company.signature_path);
      if (fs.existsSync(sigFile)) {
        try { pdf.image(sigFile, rightSigX, y, { fit: [halfW - 30, 36] }); } catch (e) {}
      }
    }
    pdf.moveTo(rightSigX, sigLineY).lineTo(margin + contentW - 10, sigLineY).strokeColor(BORDER).lineWidth(1).stroke();
    pdf.font('Helvetica').fontSize(8.5).fillColor(TEXT_DARK).text('Authorized Signature', rightSigX, sigLineY + 4, { width: halfW - 30 });

    y = sigLineY + 20;

    if (company.stamp_path) {
      const stampFile = path.join(__dirname, '..', 'public', company.stamp_path);
      if (fs.existsSync(stampFile)) {
        try { pdf.image(stampFile, margin + contentW - 70, y - 78, { fit: [60, 60] }); } catch (e) {}
      }
    }

    pdf.image(qrBuffer, margin, y, { fit: [40, 40] });
    pdf.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED)
      .text('Scan to verify authenticity', margin + 48, y + 6, { width: 220 })
      .text(`Code: ${doc.verification_code}`, margin + 48, y + 17, { width: 220 });
    y += 46;
  }

  pdf.end();
  return pdf;
}

module.exports = { buildDocumentPDF };
