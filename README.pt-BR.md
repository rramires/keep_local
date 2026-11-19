# KeepLocal — Notas Seguras Offline

[English](README.md)

Notas e listas de tarefas com criptografia local no navegador. O app funciona
sem servidor de dados, conta na nuvem, analytics ou dependências de runtime.
Exportar um backup e abrir links externos são ações explícitas do usuário.

![KeepLocal como extensão](assets/KeepLocal.jpg)

## Recursos

Notas com prévia segura de Markdown, tarefas com um nível de subtarefas, cores,
rótulos, busca, fixação, arquivo, lixeira de 7 dias, duplicação e desfazer/refazer.
Novas notas aparecem no topo; arrastar move e normaliza a ordem. Listas vazias
ficam temporárias até conterem texto. Cor/rótulo são escolhidos após criar a nota,
no card ou editor; os botões inativos do rascunho foram removidos.

## Segurança

| Aspecto | Implementação |
|---|---|
| Chave | PBKDF2-HMAC-SHA-256, 600000 iterações, salt aleatório de 16 bytes |
| Cifra | AES-256-GCM, IV aleatório de 12 bytes e tag de 16 bytes |
| Verificação | Bloco conhecido cifrado (`keyCheck`); sem verificador rápido da frase-senha |
| Sessão | Chave não exportável somente em memória; recarregar exige senha; bloqueio após 5 min de inatividade |
| Senha nova | 14 caracteres no mínimo, sem composição obrigatória; lista embutida de senhas comuns e verificação de sequências/padrões; prefira 5+ palavras sorteadas |
| Disco | Notas cifradas no IndexedDB; preferências e metadados locais (salt, IDs externos, timestamps, estado de backup) não são secretos |
| Backup | Envelope binário v2 autenticado; formatos não suportados preservam o cofre |
| Markdown | HTML bruto exibido como texto, imagens removidas, DOMPurify restritivo e CSP; falta de biblioteca resulta em texto simples |
| Abas | Identidade do cofre e versão da nota conferidas atomicamente; conflitos oferecem salvar como nova nota |
| Recuperação | Registros ilegíveis podem ser copiados quando decifráveis ou descartados após confirmação digitada e export obrigatório; não existe recuperação da senha |

O código do app pode acessar o texto enquanto o cofre está aberto. Quem altera os
scripts pode capturar senha e notas. **Sirva somente o código, separado da pasta
de backups/dados, e proteja-o contra escrita por terceiros.** Não coloque os
scripts numa pasta compartilhada gravável por outras pessoas. Proteja também o
perfil do navegador e o sistema operacional. A persistência de armazenamento é
solicitada uma vez e pode ser recusada; ela não substitui um backup externo.

## Executar

Sem npm, bundler ou instalação de pacotes do app. Num diretório que contenha
somente os arquivos de código:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Abra `http://127.0.0.1:8080`. Mantenha a mesma origem/porta para acessar o mesmo
IndexedDB. O servidor requer Python 3; Web Crypto requer contexto seguro (localhost
ou HTTPS). Desenvolvimento validado em Chromium; outros navegadores não foram
validados nesta execução. A extensão requer Chrome 120+.

## Backup e redefinição

1. Crie um cofre com uma frase-senha longa e aleatória. Guarde-a com segurança:
   sem ela, as notas cifradas não podem ser recuperadas.
2. **Trocar frase-senha mestra** exige a frase-senha atual e recifra atomicamente
   todos os registros legíveis. Backups anteriores continuam usando a frase antiga.
3. **Backup** inicia o download `.keeplocal`. Confira o arquivo: o app não confirma
   a gravação. `lastBackupAt` registra a tentativa; o aviso pendente acompanha
   alterações desde essa tentativa.
4. Guarde as cópias separadas do código. A extensão também pode gravar uma cópia
   cifrada numa pasta escolhida ([Pasta do cofre](#pasta-do-cofre-só-na-extensão));
   o app servido por HTTP tem só o backup manual. O KeepLocal não enxerga o Mega
   nem outro serviço de nuvem e nunca informa sincronização com a nuvem.

Importar aceita **apenas v2 binário**, pede a frase-senha, valida todos os registros,
confirma as quantidades e grava numa transação. Cancelamento, frase-senha incorreta,
formato não suportado, dados inválidos e falhas preservam o cofre anterior.
Cofres antigos sem verificação cifrada não são suportados e permanecem intactos;
**Apagar tudo e recomeçar** exige a palavra exata e só apaga por escolha explícita.
Não há migração nem exclusão automática.

Registros ilegíveis continuam no banco, geram aviso e ficam nas exportações;
recupere-os antes de esperar uma importação integral da cópia.

## Extensão e testes

```bash
bash build-extension.sh
node --test tests/unit
CHROME_BIN=/caminho/chromium node tests/browser/run.mjs
```

O build lê a versão do manifest (atualmente 1.0.0), sincroniza as cópias versionadas
e gera `dist/keep_local_extension_v1.0.0.zip`. Para teste manual, use
`chrome://extensions` → Modo desenvolvedor → Carregar sem compactação →
`chrome-extension/`. O manifest mantém `permissions: []`.

ID da extensão `dplgmdpgehkbgphaimafofojbjhlkphm`.
Carregar sem compactação de qualquer pasta mantém o mesmo ID, a mesma origem e os
mesmos dados do IndexedDB. A instalação antiga sem a chave do manifest tem outra
origem e um IndexedDB separado. Na instalação atual de teste, remova a instância
antiga e carregue `chrome-extension/` de novo.
[Instruções dos testes](tests/README.md). O runner usa apenas perfis descartáveis
com dados fictícios; `SKIP` por falta de Chromium não comprova os critérios visuais.

## Arquivos

- `index.html`, `css/`: entrada, CSP e estilos (tokens em `css/base.css`).
- `js/app.js`: telas e integração; `auth.js`, `session.js`, `lifecycle.js`: login,
  sessão em memória e descarte de callbacks.
- `js/crypto.js`, `db.js`, `note-model.js`, `edit-session.js`, `editor-limits.js`, `recovery.js`: cifra, transações,
  validação e fila de gravação/rascunho.
- `js/backup.js`, `backup-format.js`, `backup-v2.js`: importação, download e formato.
- `js/account.js`, `vault-events.js`, `trash.js`, `storage.js`: troca/reset,
  comunicação entre abas, retenção e persistência.
- `js/i18n.js`, `theme.js`, `history.js`, `icons.js`, `utils.js`: utilitários da UI.
- `js/folder-*.js`, `css/folder.css`: pasta do cofre da extensão (handle e
  permissão, prazos de leitura, candidatos, gravação/conferência, reconciliação,
  preservação, estado e telas).
- `lib/`: bibliotecas locais, hashes e procedência.
- `chrome-extension/`: manifest, service worker, privacidade, ícones, locales e
  cópias de `js/`, `css/`, `lib/`, `index.html` sincronizadas pelo build.
- `tests/unit/`, `tests/browser/`, `tests/fixtures/`: gate sem dependências npm.

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

Apenas v2 binário é aceito. O conjunto e o manifesto são autenticados. Documentos
JSON reconhecíveis são recusados sem interpretar esquemas antigos. Sem identificador
em claro, um binário não autenticado não permite distinguir com certeza frase-senha
incorreta, formato não suportado e arquivo danificado; o erro informa as possibilidades
e preserva o cofre.
Importar manualmente uma cópia antiga válida continua possível (rollback); só a
pasta do cofre da extensão compara revisões.

`rev` é inteiro seguro persistido em `meta.exportRev`, incrementado a cada
exportação (primeira: 1). `parent` começa `null`; depois é o SHA-256 hexadecimal
minúsculo dos **bytes UTF-8 exatos do JSON em claro** da exportação anterior,
antes de cifrar (não do envelope). `meta.exportParent` guarda o hash do payload
atual para a próxima. Contador e hash são gravados juntos, recusando pontas
concorrentes. Importar v2 retoma seu contador e usa o hash exato do payload
importado como próximo pai. Exportações manuais e gravações na pasta do cofre
compartilham essa linhagem, então lacunas de `rev` são normais. A importação
manual não faz merge nem protege contra rollback.

## Pasta do cofre (só na extensão)

Só a extensão (`chrome-extension://`) oferece a pasta do cofre; o app servido por
HTTP não mostra nenhuma opção de pasta. **Configurações → Pasta do cofre →
Escolher pasta…** guarda um handle de diretório nos metadados locais; só o nome
da pasta aparece. No Chrome, escolha **Permitir em todas as visitas** para manter
o acesso entre sessões (Allow on every visit). A frase-senha continua
obrigatória a cada abertura.

- **Arquivo:** `keeplocal-vault.keeplocal` na raiz da pasta, exatamente no formato
  binário v2 perfil 2 acima. Depois de uma alteração (cerca de 1,5 s depois, e
  também ao focar, ao mudar a visibilidade e ao sair da página), o app grava uma
  nova revisão, relê e confere. "Gravado na pasta às HH:MM" indica só a gravação
  do arquivo local. Gravar na pasta não conta como backup manual.
- **Entrar:** o pedido de permissão da pasta é a primeira ação do clique. A
  disponibilidade é decidida listando a pasta. Todo `*.keeplocal` da raiz (no
  máximo 32, 64 MiB cada; cópias de conflito do Mega incluídas) é autenticado com
  a chave da sessão quando tem o salt do cofre. A cabeça é o maior `rev` cifrado,
  nunca a data do arquivo. Outros arquivos são ignorados.
- **Decisão:** gravar as alterações locais, carregar uma cabeça mais nova da
  pasta ou parar e perguntar quando os dois lados mudaram, quando a pasta está
  mais antiga que uma revisão já vista, quando há cópia de outra frase-senha ou
  cofre, ou cópia ilegível. Na primeira conexão, um cofre local vazio carrega a
  pasta e um conjunto idêntico de registros é adotado sem gravar; qualquer outro
  caso pergunta. Cópias alheias ou ilegíveis nunca são sobrescritas. A pasta
  exige zero registros locais ilegíveis.
- **Conflitos:** escolher um lado exige digitar SUBSTITUIR. Antes, o lado que
  perde é copiado para a subpasta `keeplocal-preserved/`, relido e conferido; se
  falhar, nada é substituído. Os arquivos preservados abrem pelo "Importar"
  normal. O app nunca limpa essa subpasta e lê só a raiz, então as cópias
  preservadas nunca viram candidatas.
- **Pasta indisponível:** uma tela de bloqueio oferece Tentar de novo, Escolher
  outra pasta, Abrir só leitura, Começar do zero… e Sair. O somente leitura é
  imposto na camada de dados (nenhuma gravação). Leituras da pasta têm prazo
  (15 s para metadados, 60 s por arquivo): uma pasta que não responde leva à tela
  "A pasta não respondeu", sem travar o login. Se continuar, escolha a mesma pasta
  de novo, ou use Configurações → Desconectar pasta → Escolher pasta. Gravações
  não têm prazo.
- **Desconectar e redefinir:** desconectar preserva o conteúdo da pasta. Redefinir
  na tela de login ou Começar do zero… apaga o cofre local e o vínculo com a
  pasta, nunca a cópia na pasta. Importar na tela de login é recusado enquanto
  houver pasta conectada.

Merge por nota, cópias rotativas, pastas gravadas com outra frase-senha, abrir
outra pasta para recuperação e ferramenta de recuperação independente não estão
implementados.

Bibliotecas locais: Marked **18.2.1** (bundle UMD) e DOMPurify **3.4.18**.
Procedência, revisão das versões e integridade em [`lib/VENDOR.md`](lib/VENDOR.md).
O gate de unidade confere `lib/SHA256SUMS`.

## Licença

[MIT](LICENSE)

## Registros ilegíveis e antigos

O aviso persistente abre **Recuperação somente leitura**. Ele distingue falha de
cifra, JSON inválido, modelo/limites incompatíveis e notas antigas acima do limite.
Dados decifráveis aparecem somente para leitura; nada é alterado ou apagado.
Bloquear limpa essa tela. Limites de edição/importação: título 4096 caracteres,
texto de tarefa 65536, rótulo 200, 100 rótulos e 10000 tarefas por nota, além dos
2 MiB da nota serializada em UTF-8. Registros cifrados existentes acima desses
limites ou com IV/dados danificados continuam intactos nos arquivos v2, dentro
dos 64 MiB/10000 registros por arquivo. Decodificar o envelope preserva esses
registros para recuperação; **importar** valida tudo estritamente e rejeita o
conjunto sem alterar o banco. Repare dados antigos antes de reimportar ou trocar
a senha. Bloqueio automático limpa texto não salvo; falha no bloqueio manual
oferece cancelar ou descartar explicitamente. Exportação em andamento é cancelada
se a sessão terminar ou mudar.

## Recuperação de registros ilegíveis

O export avisa antes quando houver registros ilegíveis e informa que o arquivo
não pode ser restaurado integralmente nesse estado. A Recuperação permite criar
uma nota válida contendo o texto bruto decifrado; conteúdo acima do limite fica
somente para leitura e cópia manual. O descarte tem dois passos: Exportar agora preserva o registro sem excluir;
depois confira o arquivo salvo, marque a confirmação explícita e digite DESCARTAR.
O app não confirma gravação no disco. O comprovante fica somente nesta sessão e
qualquer alteração do snapshot do cofre exige novo export. O snapshot completo
é conferido novamente na transação de exclusão, incluindo outros registros. Depois de resolver todos os registros
ilegíveis, importação integral e troca de senha voltam a funcionar. O indicador
de força de senha é uma heurística; ele não mede a aleatoriedade das palavras.

## Escopo da persistência do editor

Ações de metadados de notas de texto e listas usam cópias e só são promovidas
após gravar. Edições de tarefas usam um rascunho: uma falha mantém mudanças
pendentes para nova tentativa ao fechar; elas não têm a mesma garantia de ausência
de divergência das ações de metadados. Confira o erro e tente salvar antes de
descartar o rascunho. A política de senha é heurística: combinações como
Dallas2024Cowboys! e Summer2024!Summer2024! ainda podem atender ao mínimo. Use
5–6 palavras sorteadas; o indicador não consegue provar que a frase foi sorteada.
