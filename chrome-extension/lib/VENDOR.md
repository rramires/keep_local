# Local vendor provenance

Retrieved 2026-11-17 over HTTPS from official npm publications. Tarball bytes
were checked against npm metadata SHA-512 integrity before extracting only the
listed JS files (no installer, dependency execution or runtime package manager).
DOMPurify bytes additionally match the pinned upstream GitHub tag. SHA256SUMS
locks the extracted files; the Node unit gate verifies both hashes.

- dompurify 3.4.18: https://registry.npmjs.org/dompurify/-/dompurify-3.4.18.tgz
  - Member: `package/dist/purify.min.js`; local: `purify.min.js`.
  - npm integrity: `sha512-ofe3wI/uNm68HInABYFJYqQxRw1EaKAjNdrFVKqjUY+UZurvNd2L/HuQe097s/4RivWiZyP6tT7aoT8atjfhwg==`.
- marked 18.2.1: https://registry.npmjs.org/marked/-/marked-18.2.1.tgz
  - Member: `package/lib/marked.umd.js`; local: `marked.min.js`.
  - npm integrity: `sha512-ii4bxCTCqqwpT86XZWgJNs+ZnAIZksmLGYMViWA7PDIXYIeNo1x6cDdX3JOip9NM/cI6p8z57FxliACboTruMA==`.

Release review: https://github.com/cure53/DOMPurify/releases/tag/3.4.18
and https://github.com/markedjs/marked/releases/tag/v18.2.1 . Marked major release
notes reviewed: v16.0.0 (UMD path replaces marked.min.js, Node 20 minimum),
v17.0.0 (list/checkbox token changes), v18.0.0 (blank-line token changes, TS 6).
KeepLocal uses the browser UMD bundle, retains the local filename for script-path
compatibility, and overrides only HTML/image rendering. Browser regression tests
cover headings, emphasis, lists, task lists, tables, links, fenced code, escaping
and sanitizer absence; no runtime imports from npm or a CDN are introduced.
