# KeepLocal — Copilot Instructions

## Project Overview

KeepLocal is a Google Keep-inspired Single Page Application (SPA) for secure, 100% offline, encrypted note-taking. It also ships as a Chrome Extension (Manifest V3, zero permissions).

**Repository:** `git@github.com:rramires/keep_local.git` (branch `master`)

## Tech Stack

- **HTML5 + CSS (native nesting) + Vanilla JS (ES modules)** — No bundler, no npm, no framework
- **Web Crypto API:** PBKDF2 (600K iterations) + AES-256-GCM (12-byte IV per record)
- **IndexedDB:** Database `KeepLocalDB` v1, stores: `notes`, `meta`
- **Vendor libs (local copies in `lib/`):** marked.js v15.0.12, DOMPurify v3.3.3
- **Chrome Extension:** Manifest V3, zero permissions, `minimum_chrome_version: "120"`
- **Environment:** Ubuntu on WSL2, Node.js v22, zip installed, no sudo needed

## Project Structure

```
.github/copilot-instructions.md   ← this file
index.html                         ← SPA entry point
css/
  variables.css                    ← CSS custom properties, color palette, themes
  base.css                         ← Reset, typography, scrollbar
  layout.css                       ← Header, sidebar, main grid
  cards.css                        ← Note cards, drag & drop
  modal.css                        ← Text/todo modal, color picker
  auth.css                         ← Auth view, import dropzone
  components.css                   ← Toast, confirm dialog, buttons
js/
  app.js                           ← Bootstrap, SPA router, views, modals, CRUD, drag & drop (~1970 lines)
  auth.js                          ← Password creation/validation, session management, auth UI (~450 lines)
  backup.js                        ← Export/import encrypted backups (~110 lines)
  crypto.js                        ← Web Crypto wrappers (PBKDF2, AES-256-GCM, hashing)
  db.js                            ← IndexedDB open/CRUD (notes + meta stores)
  history.js                       ← Undo/redo stack for editors
  i18n.js                          ← Internationalization EN/PT-BR (~350 lines)
  icons.js                         ← Material Design SVG icons (~31 icons)
  theme.js                         ← Dark/light theme toggle, persists in IndexedDB
  utils.js                         ← UUID generation, debounce, deepClone
lib/
  marked.min.js                    ← Markdown parser (local copy)
  purify.min.js                    ← HTML sanitizer (local copy)
chrome-extension/
  manifest.json                    ← MV3 manifest with _locales i18n
  service-worker.js                ← Empty SW (required by MV3)
  privacy.html                     ← Privacy policy (bilingual EN/PT)
  icons/                           ← 16/48/128 PNG icons
  _locales/en/ & _locales/pt_BR/   ← Chrome manifest i18n
  (js/, css/, lib/ are copied by build script)
build-extension.sh                 ← Copies app files → chrome-extension/, creates ZIP in dist/
```

## Architecture & Conventions

### General
- Pure vanilla JS with ES modules (`import`/`export`). No transpilation.
- All JS files use `type="module"` in the HTML script tag.
- No external CDN — all dependencies are local copies in `lib/`.
- App is 100% offline, no network requests whatsoever.

### Encryption
- User creates a password → PBKDF2 derives a CryptoKey → notes are individually AES-256-GCM encrypted.
- Each note record in IndexedDB stores: `{ id, iv (base64), ciphertext (base64), updatedAt }`.
- Password hash (for verification only) is stored in the `meta` store.
- Session key is stored in `sessionStorage` with 5-minute inactivity timeout.

### i18n
- `js/i18n.js` exports: `t(key, params?)`, `tp(key, count, params?)`, `getLang()`, `setLang(lang)`, `initI18n()`
- Two languages: `en` (English) and `pt-BR` (Brazilian Portuguese)
- Flat dot-notation keys (e.g., `sidebar.notes`, `toast.noteArchived`)
- `tp()` handles plurals by appending `Plural` to the key when count ≠ 1
- Language is auto-detected from `navigator.language` and persisted in IndexedDB `meta` store
- Language toggle button (globe icon) in the header re-renders the entire app via `showApp()`

### CSS
- Uses native CSS nesting (no preprocessor)
- Theme via CSS custom properties in `variables.css` (`[data-theme="dark"]` / `[data-theme="light"]`)
- 12 note colors defined as CSS variables (`--note-coral`, `--note-peach`, etc.)
- Mobile-first responsive with sidebar collapse at 768px

### Notes Data Model
```js
{
  id: string (UUID),
  type: 'text' | 'todo',
  title: string,
  content: string,          // text notes only
  tasks: Task[],            // todo notes only — { id, text, done, order, parentId }
  color: string,            // 'default' | 'coral' | 'peach' | ...
  pinned: boolean,
  labels: string[],
  createdAt: number,
  updatedAt: number,
  deletedAt: number | null,
  archivedAt: number | null,
  order: number
}
```

### Chrome Extension
- Build with `bash build-extension.sh` → produces `dist/keep_local_extension_v1.0.0.zip`
- The script copies `css/`, `js/`, `lib/`, `index.html`, `_locales/` into `chrome-extension/` then zips
- Extension uses zero permissions — everything runs locally

## Coding Style

- **Language:** User communicates in Brazilian Portuguese
- **Commits:** Conventional commits in English (`feat:`, `fix:`, `refactor:`, etc.)
- **Strings:** All user-facing strings go through `t()` or `tp()` from `i18n.js` — never hardcode
- **No npm/node_modules** — this is a zero-dependency browser app
- **Icons:** SVG icons are defined as template literals in `js/icons.js`
- **Error handling:** Only at system boundaries (user input, crypto operations, file parsing)
- **No comments on obvious code** — only where logic isn't self-evident
