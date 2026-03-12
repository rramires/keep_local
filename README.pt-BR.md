# 📝 KeepLocal — Notas Seguras Offline

> 🇺🇸 [Read in English](README.md)

Uma SPA de notas e listas de tarefas inspirada no Google Keep, 100% client-side com criptografia AES-256-GCM. Nenhum dado sai do seu navegador.

## ✨ Funcionalidades

- **Notas de texto** com suporte a Markdown (rendering + preview)
- **Listas de tarefas** com subitens (1 nível), drag & drop para reordenar e mover entre pendentes/concluídas
- **Criptografia AES-256-GCM** via Web Crypto API — cada registro criptografado individualmente no IndexedDB
- **100% offline** — nenhuma requisição externa, todas as dependências são locais
- **Temas** dark e light
- **Cores** nas notas (12 opções inspiradas no Google Keep)
- **Labels** para organização
- **Pin** para fixar notas importantes
- **Arquivo** para guardar notas sem deletar
- **Lixeira** com purge automático após 7 dias
- **Busca** por título e conteúdo
- **Duplicar** notas
- **Undo/Redo** nos modais de edição (Ctrl+Z / Ctrl+Y)
- **Drag & drop** para reordenar cards na grade
- **Backup** — exportar/importar dados criptografados (JSON)
- **Sessão segura** — timeout de 5 minutos de inatividade, chave mantida apenas em sessionStorage

## 🔐 Segurança

| Aspecto | Implementação |
|---|---|
| Derivação de chave | PBKDF2 — 600.000 iterações, SHA-256 |
| Criptografia | AES-256-GCM — IV aleatório de 12 bytes por registro |
| Armazenamento | IndexedDB — apenas dados cifrados persistem |
| Sessão | CryptoKey exportada como JWK em sessionStorage |
| Sanitização | DOMPurify aplicado em todo output Markdown |
| Senha | Mínimo 8 caracteres, 1 maiúscula, 1 caractere especial |
| Sem recuperação | Não existe "esqueci a senha" — sem backdoors |

## 🚀 Como usar

Não requer build, bundler, nem instalação de dependências. Basta servir os arquivos:

```bash
# Com Python
python3 -m http.server 8080

# Com Node.js
npx serve .

# Ou qualquer servidor HTTP estático
```

Acesse `http://localhost:8080` e crie sua senha na primeira utilização.

## 🧩 Extensão Chrome

Também disponível como extensão Chrome (Manifest V3):

```bash
# Gerar o pacote
./build-extension.sh

# Ou carregar manualmente:
# 1. Abra chrome://extensions
# 2. Ative "Modo desenvolvedor"
# 3. Clique "Carregar sem compactação"
# 4. Selecione a pasta chrome-extension/
```

## 📁 Estrutura do projeto

```
keep_local/
├── index.html              # Entry point
├── css/
│   ├── variables.css       # Tokens de tema (dark/light, cores)
│   ├── base.css            # Reset, tipografia, botões
│   ├── auth.css            # Tela de login/cadastro
│   ├── layout.css          # Sidebar, header, grid
│   ├── cards.css           # Cards de notas (masonry)
│   ├── modal.css           # Modais de edição
│   └── components.css      # Checkbox, toast, tooltip
├── js/
│   ├── app.js              # Bootstrap, SPA router, views, modais
│   ├── auth.js             # Autenticação, sessão, timer
│   ├── crypto.js           # PBKDF2, AES-256-GCM, import/export
│   ├── db.js               # IndexedDB wrapper
│   ├── backup.js           # Export/import de backups
│   ├── theme.js            # Dark/light toggle
│   ├── history.js          # Undo/redo stack
│   ├── icons.js            # Ícones SVG inline
│   └── utils.js            # UUID, debounce, formatDate, etc.
├── lib/
│   ├── marked.min.js       # Markdown parser (v15.0.12)
│   └── purify.min.js       # DOMPurify (v3.3.3)
├── chrome-extension/       # Extensão Chrome empacotada
│   ├── manifest.json       # Manifest V3
│   ├── service-worker.js   # Background script
│   ├── privacy.html        # Política de privacidade
│   └── icons/              # Ícones 16/48/128 PNG
└── docs/
    └── Prompt.txt          # Prompt original do projeto
```

## 🛠️ Stack

- **HTML5** + **CSS** (com CSS Nesting nativo) + **JavaScript** puro (ES Modules)
- **Web Crypto API** — criptografia nativa do navegador
- **IndexedDB** — armazenamento local estruturado
- **marked.js** — rendering de Markdown
- **DOMPurify** — sanitização contra XSS
- **Nenhum framework, bundler ou dependência de build**

## 📋 Requisitos do navegador

Navegadores modernos com suporte a:
- CSS Nesting
- Web Crypto API
- IndexedDB
- ES Modules

Chrome 120+, Firefox 117+, Edge 120+, Safari 17.2+

## 📄 Licença

[MIT](LICENSE)
