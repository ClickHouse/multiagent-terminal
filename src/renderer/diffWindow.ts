// Import diff2html assets as raw strings — bundled locally, no CDN needed.
import diff2htmlCSS from 'diff2html/bundles/css/diff2html.min.css?raw'
import diff2htmlJS  from 'diff2html/bundles/js/diff2html.min.js?raw'

export function openDiffWindow(diffText: string, agentName: string, worktreePath: string): void {
  const w = window.open('', '_blank', 'width=1300,height=800,menubar=no,toolbar=no,location=no')
  if (!w) return

  w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Diff — ${agentName}</title>
  <style>${diff2htmlCSS}</style>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
           background: #f8fafc; color: #0d1117; }
    header { padding: 12px 20px; background: #fff; border-bottom: 1px solid #dde3ea;
             display: flex; align-items: center; gap: 12px;
             position: sticky; top: 0; z-index: 10; }
    header h1 { font-size: 14px; font-weight: 600; }
    header span { font-size: 12px; color: #5a6a7e; font-family: monospace; }
    .empty { display: flex; align-items: center; justify-content: center;
             height: calc(100vh - 49px); color: #5a6a7e; font-size: 15px; }
    #diff-container { padding: 16px 20px; }
    .d2h-wrapper { border-radius: 8px; overflow: hidden; border: 1px solid #dde3ea; }
    .d2h-file-header { background: #f1f5f9 !important; }
    .d2h-ins { background-color: #dcfce7 !important; }
    .d2h-ins .d2h-code-linenumber { background-color: #bbf7d0 !important; color: #166534 !important; }
    .d2h-del { background-color: #fee2e2 !important; }
    .d2h-del .d2h-code-linenumber { background-color: #fecaca !important; color: #991b1b !important; }
    .d2h-diff-table td { font-size: 12px; font-family: "JetBrains Mono", "Fira Code", monospace; }
    .d2h-code-side-linenumber { font-size: 11px; min-width: 36px; }
  </style>
</head>
<body>
  <header>
    <h1>Changes — ${agentName}</h1>
    <span>${worktreePath}</span>
  </header>
  <div id="diff-container"></div>
  <script>${diff2htmlJS}</script>
  <script>
    var rawDiff = ${JSON.stringify(diffText)};
    var container = document.getElementById('diff-container');
    if (!rawDiff.trim()) {
      container.innerHTML = '<div class="empty">No changes in this worktree.</div>';
    } else {
      var diffHtml = Diff2Html.html(Diff2Html.parse(rawDiff), {
        drawFileList: true,
        matching: 'lines',
        outputFormat: 'side-by-side',
      });
      container.innerHTML = '<div class="d2h-wrapper">' + diffHtml + '</div>';
    }
  </script>
</body>
</html>`)
  w.document.close()
}
