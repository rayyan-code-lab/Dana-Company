/**
 * Bulletproof Printing Utility for Modals & Dialogs
 * Clones content into an isolated iframe to bypass Radix Dialog transforms,
 * view clipping, and dark-mode overrides, guaranteeing complete printable / PDF output.
 */
export function printHtmlContent(element, documentTitle = 'DANA COMPANY Document') {
  if (!element) return;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();

  // Collect parent stylesheets and style tags
  const headStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((el) => el.outerHTML)
    .join('\n');

  doc.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${documentTitle}</title>
        ${headStyles}
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 15mm;
          }
          *, *::before, *::after {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
            box-sizing: border-box;
          }
          html, body {
            background: #ffffff !important;
            background-color: #ffffff !important;
            color: #0f172a !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          .no-print {
            display: none !important;
          }
        </style>
      </head>
      <body class="bg-white text-slate-900">
        <div style="width: 100%; max-width: 820px; margin: 0 auto; padding: 12px;">
          ${element.innerHTML}
        </div>
      </body>
    </html>
  `);
  doc.close();

  // Allow styles and layout to render, then invoke native print
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (err) {
      console.error('Print failed:', err);
      window.print();
    } finally {
      setTimeout(() => {
        try {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        } catch {}
      }, 2000);
    }
  }, 350);
}

