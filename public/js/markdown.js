/* ═══════════════════════════════════════════════════════════════════════════
   Lightweight Markdown Renderer
   Converts markdown text to HTML. Handles: headings, bold, italic, code
   blocks, inline code, links, images, lists, blockquotes, tables, and hrs.
   ═══════════════════════════════════════════════════════════════════════════ */

window.MarkdownRenderer = (() => {

  /**
   * Render a markdown string to HTML.
   * @param {string} md - Raw markdown text
   * @returns {string} HTML string
   */
  function render(md) {
    if (!md) return '';

    // Normalize line endings
    md = md.replace(/\r\n/g, '\n');

    // Extract fenced code blocks first (to avoid processing their content)
    const codeBlocks = [];
    md = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || 'plaintext', code: escapeHtml(code.replace(/\n$/, '')) });
      return `\x00CODEBLOCK_${idx}\x00`;
    });

    // Process blocks
    const lines = md.split('\n');
    let html = '';
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Code block placeholder
      const cbMatch = line.match(/^\x00CODEBLOCK_(\d+)\x00$/);
      if (cbMatch) {
        const cb = codeBlocks[parseInt(cbMatch[1])];
        html += renderCodeBlock(cb.lang, cb.code);
        i++;
        continue;
      }

      // Table
      if (isTableStart(lines, i)) {
        const result = parseTable(lines, i);
        html += result.html;
        i = result.nextIndex;
        continue;
      }

      // Headings
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        html += `<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`;
        i++;
        continue;
      }

      // Horizontal rule
      if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
        html += '<hr>';
        i++;
        continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        let quoteLines = [];
        while (i < lines.length && lines[i].startsWith('> ')) {
          quoteLines.push(lines[i].slice(2));
          i++;
        }
        html += `<blockquote>${render(quoteLines.join('\n'))}</blockquote>`;
        continue;
      }

      // Unordered list
      if (/^\s*[\*\-\+]\s+/.test(line)) {
        let listItems = [];
        while (i < lines.length && /^\s*[\*\-\+]\s+/.test(lines[i])) {
          listItems.push(inlineMarkdown(lines[i].replace(/^\s*[\*\-\+]\s+/, '')));
          i++;
        }
        html += `<ul>${listItems.map(li => `<li>${li}</li>`).join('')}</ul>`;
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        let listItems = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          listItems.push(inlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, '')));
          i++;
        }
        html += `<ol>${listItems.map(li => `<li>${li}</li>`).join('')}</ol>`;
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Paragraph
      let paraLines = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*#{1,6}\s/.test(lines[i]) &&
        !/^\s*(\*{3,}|-{3,}|_{3,})\s*$/.test(lines[i]) && !lines[i].trim().startsWith('>') &&
        !/^\s*[\*\-\+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^\x00CODEBLOCK_\d+\x00$/.test(lines[i]) && !isTableStart(lines, i)) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        html += `<p>${inlineMarkdown(paraLines.join('\n'))}</p>`;
      }
    }

    return html;
  }

  /**
   * Process inline markdown elements.
   */
  function inlineMarkdown(text) {
    // Inline code (must be first so other patterns don't match inside it)
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold + italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Strikethrough
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Images
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;">');

    // Links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Line breaks
    text = text.replace(/\n/g, '<br>');

    return text;
  }

  /**
   * Detect if the current line starts a markdown table.
   */
  function isTableStart(lines, i) {
    if (i + 1 >= lines.length) return false;
    return /\|/.test(lines[i]) && /^\|?\s*[-:]+[-| :]*$/.test(lines[i + 1]);
  }

  /**
   * Parse a markdown table starting at line index i.
   * Returns { html, nextIndex }.
   */
  function parseTable(lines, i) {
    const headerCells = parseTableRow(lines[i]);
    i++; // skip separator line
    i++;

    const rows = [];
    while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
      rows.push(parseTableRow(lines[i]));
      i++;
    }

    let html = '<table><thead><tr>';
    headerCells.forEach(c => { html += `<th>${inlineMarkdown(c)}</th>`; });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
      html += '<tr>';
      row.forEach(c => { html += `<td>${inlineMarkdown(c)}</td>`; });
      html += '</tr>';
    });
    html += '</tbody></table>';

    return { html, nextIndex: i };
  }

  function parseTableRow(line) {
    return line.split('|').map(c => c.trim()).filter((_, idx, arr) => {
      // Remove empty leading/trailing cells from leading/trailing pipes
      if (idx === 0 && arr[idx] === '') return false;
      if (idx === arr.length - 1 && arr[idx] === '') return false;
      return true;
    });
  }

  /**
   * Render a fenced code block with header and copy button.
   */
  function renderCodeBlock(lang, codeHtml) {
    return `<div class="code-block">
      <div class="code-block-header">
        <span class="code-block-lang">${escapeHtml(lang)}</span>
        <button class="copy-code-btn" onclick="window.copyCodeBlock(this)">
          <i class="fa-regular fa-copy"></i> Copy
        </button>
      </div>
      <div class="code-block-body">
        <code class="code-block-code">${codeHtml}</code>
      </div>
    </div>`;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  return { render };
})();

/**
 * Global helper to copy code block contents.
 */
window.copyCodeBlock = function(btn) {
  const codeEl = btn.closest('.code-block').querySelector('.code-block-code');
  const text = codeEl.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
};
