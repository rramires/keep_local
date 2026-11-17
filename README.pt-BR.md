# 📝 KeepLocal — Notas Seguras Offline

> 🇺🇸 [Read in English](README.md)

Uma SPA de notas e listas de tarefas inspirada no Google Keep, 100% client-side com criptografia AES-256-GCM. Nenhum dado sai do seu navegador.

![KeepLocal rodando como extensão Chrome](assets/KeepLocal.jpg)

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

## Formato binário do backup e recuperação

Exportações novas usam `.keeplocal`: `[salt 16 bytes][iv 12 bytes][ciphertext+tag]`,
sem magic, app, versão, parâmetros KDF ou cabeçalho JSON em claro. O perfil 2
(único atual, tentado primeiro) usa PBKDF2-HMAC-SHA-256, 600000 iterações, senha
UTF-8 sem normalização, chave AES-256-GCM e tag de 16 bytes no final. AAD =
`[0x02] || salt[16] || iv[12]` (29 bytes). O salt é o do cofre e se repete entre
exportações dele. O comprimento total do arquivo permanece observável.

Decifre os bytes a partir do offset 28 com o nonce do offset 16. O JSON UTF-8
cifrado contém `v:2`, `profile:2`, `rev`, `exportedAt`, `preferences`, `notes` e
`manifest:{count,ids}`. Os IDs devem corresponder à ordem exata do array de notas.
As notas são registros cifrados originais `{id,iv,ciphertext,updatedAt}`; IV e
ciphertext internos são Base64, decifrados com a mesma chave, e ID/timestamp
internos devem coincidir. Isso preserva registros ilegíveis na exportação; será
necessário recuperá-los para importar integralmente um backup que os contenha.
O README em inglês e `js/backup-v2.js` detalham o contrato para ferramentas futuras.
Perfis ficam no código em ordem conhecida, limitados a 600000–5000000 iterações
antes da derivação; nenhum byte do arquivo controla o custo do KDF. Limites:
64 MiB por arquivo, 10000 notas, 2 MiB por nota serializada em UTF-8.

JSON v1 continua importável, com aviso e substituição atômica. V1 não detecta
remoção de registros inteiros. V2 autentica o conjunto e confere o manifesto.
Uma cópia antiga válida continua aceita (rollback); revisão/merge pertencem à
Fase 3, bloqueada.

`rev` é inteiro seguro persistido em `meta.exportRev`, incrementado a cada
exportação (primeira: 1). `parent` começa `null`; depois é o SHA-256 hexadecimal
minúsculo dos **bytes UTF-8 exatos do JSON em claro** da exportação anterior,
antes de cifrar (não do envelope). `meta.exportParent` guarda o hash do payload
atual para a próxima. Contador e hash são gravados juntos, recusando pontas
concorrentes. Importar v2 retoma seu contador e usa o hash exato do payload
importado como próximo pai. São campos de linhagem reservados: não há merge,
sincronização, escrita em nuvem nem proteção contra rollback nesta fase.
