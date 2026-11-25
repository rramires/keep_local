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
validados nesta execução. Use uma versão atual do Chrome para a extensão e
o acesso a pastas.

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

Importar aceita **backup v2 binário** ou um JPEG/PNG com cópia v2 anexada.
O app pede a frase-senha da cópia, valida cada registro, confirma as
quantidades e grava numa transação. Cancelamento, frase-senha incorreta,
formato não suportado, dados inválidos e falhas preservam o cofre anterior.
Com a pasta do cofre conectada, a importação pelas Configurações grava e
confere primeiro uma cópia do cofre local atual em `keeplocal-preserved/`.
A importação bem-sucedida desconecta a pasta do cofre. Se uma alteração
concorrente interromper a importação, o formulário pede para tentar de novo.
Cofres antigos sem verificação cifrada não são suportados e permanecem intactos;
**Apagar tudo e recomeçar** exige a palavra exata e só apaga por escolha explícita.
Não há migração nem exclusão automática.

Registros ilegíveis continuam no banco, geram aviso e ficam nas exportações;
recupere-os antes de esperar uma importação integral da cópia.

## Extensão e testes

```bash
taskset -c 0-3 nice -n 10 bash build-extension.sh
taskset -c 0-3 nice -n 10 node --test --test-concurrency=4 tests/unit
CHROME_BIN=/caminho/chromium taskset -c 0-3 nice -n 10 node tests/browser/run.mjs
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
- `js/vault-model.js`, `js/vault-view.js`, `js/vault-editor.js`, `js/secret-ui.js`,
  `css/vault.css`: Modelos de dados, lista, editor, controles de segredos e estilos de Senhas e Chaves.
- `js/vault-templates.js`: modelos prontos e criação de blocos traduzidos.
- `js/password-generator.js`, `js/vault-generator.js`: geração de senhas e controles do editor.
- `js/vault-history.js`: desfazer e refazer em memória no editor de senhas.
- `js/folder-*.js`, `css/folder.css`: pasta do cofre da extensão (handle e
  permissão, prazos de leitura, candidatos, gravação/conferência, reconciliação,
  preservação, estado e telas).
- `lib/`: bibliotecas locais, hashes e procedência.
- `chrome-extension/`: manifest, service worker, privacidade, ícones, locales e
  cópias de `js/`, `css/`, `lib/`, `index.html` sincronizadas pelo build.
- `tests/unit/`, `tests/browser/`, `tests/fixtures/`: gate sem dependências npm.

## Formato binário do backup e recuperação

A [ferramenta de recuperação](recovery/keeplocal-recovery.html) abre cópias
offline no Chrome ou Edge, a partir de um `.keeplocal` ou de uma foto com
cópia anexada. Ela mostra a revisão e a data de exportação da cópia cifrada.
A ferramenta exibe cores desconhecidas como texto e ignora
chaves adicionais em notas, tarefas e blocos do cofre. Para um tipo de nota
desconhecido, exibe o título e um aviso de formato mais novo. Para um bloco
desconhecido, exibe só o aviso no lugar do bloco. Os campos conhecidos do cofre
ficam mascarados até serem revelados. Registros com campos de tipo inválido
aparecem como ilegíveis. O app aplica validação estrita ao importar um backup.

Exportações novas usam `.keeplocal`: `[salt 16 bytes][iv 12 bytes][ciphertext+tag]`,
sem magic, app, versão, parâmetros KDF ou cabeçalho JSON em claro. O perfil 2
(único atual, tentado primeiro) usa PBKDF2-HMAC-SHA-256, 600000 iterações, senha
UTF-8 sem normalização, chave AES-256-GCM e tag de 16 bytes no final. AAD =
`[0x02] || salt[16] || iv[12]` (29 bytes). O salt é o do cofre e se repete entre
exportações dele. O comprimento total do arquivo permanece observável.

Decifre os bytes a partir do offset 28 com o nonce do offset 16. O JSON UTF-8
cifrado contém `v:2`, `profile:2`, `rev`, `parent`, `exportedAt` em ISO e `writtenBy` opcional,
`preferences` (`lang`, `theme`), `notes` e
`manifest:{count,ids}`. Os IDs devem corresponder à ordem exata do array de notas.
O campo cifrado opcional `tombstones` contém até 10000 registros de exclusão
definitiva `{id,deletedAt}`, com UUID e data em milissegundos como inteiro
seguro não negativo. Campo ausente equivale a uma lista vazia. O leitor de
recuperação lista os registros de `notes`.
As notas são registros cifrados originais `{id,iv,ciphertext,updatedAt}`; IV e
ciphertext internos são Base64, decifrados com a mesma chave, e ID/timestamp
internos devem coincidir. Isso preserva registros ilegíveis na exportação; será
necessário recuperá-los para importar integralmente um backup que os contenha.
O README em inglês e `js/backup-v2.js` detalham o contrato para ferramentas futuras.
Perfis ficam no código em ordem conhecida, limitados a 600000–5000000 iterações
antes da derivação; nenhum byte do arquivo controla o custo do KDF. Limites:
64 MiB por arquivo, 10000 notas, 2 MiB por nota serializada em UTF-8.

O formato de backup aceito é o v2 binário. O conjunto e o manifesto são autenticados. Documentos
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
atual para a próxima. O campo cifrado opcional `ancestors` guarda até 32 hashes
hexadecimais minúsculos de 64 caracteres, do mais recente para o mais antigo.
Cada novo payload acrescenta seu `parent` não nulo ao início da lista desse pai
e mantém os primeiros 32. Campo ausente equivale a uma lista vazia. O leitor de
recuperação pode ignorar o campo ao listar as notas.
O campo cifrado opcional `clock` é um mapa de até 64 UUIDs de gravadores com
contadores inteiros seguros positivos. Campo ausente equivale a um mapa vazio.
Gravar na pasta incrementa o contador deste PC. Uma junção leva os maiores
contadores das fontes. O export manual leva o clock local. O leitor de
recuperação pode ignorar esse mapa.
Contador, hash, `meta.exportAncestors` e `meta.exportClock` são gravados juntos, recusando pontas
concorrentes. Importar v2 retoma seu contador e grava o hash exato e a lista de
ancestrais do payload importado. Exportações manuais e gravações na pasta do cofre
compartilham essa linhagem, então lacunas de `rev` são normais. A importação
manual não faz merge nem protege contra rollback.

## Kit de emergência

Guarde em um **pen-drive criptografado** (BitLocker To Go ou VeraCrypt):

- As cópias `.keeplocal` mais recentes, incluindo o arquivo da pasta do cofre
  e os backups manuais.
- O ZIP da extensão na versão em uso.
- `keeplocal-recovery.html`, `LEIA-ME.txt` e `SHA256SUMS` de `dist/`.

Guarde a senha mestra separadamente do pen-drive. Atualize o kit após mudanças
importantes e teste periodicamente a abertura de uma cópia com a ferramenta,
por exemplo a cada trimestre. No Windows, compare a soma de cada arquivo da
distribuição com `SHA256SUMS` usando `certutil -hashfile <arquivo> SHA256`.
No Linux, rode `sha256sum -c SHA256SUMS` dentro da pasta do kit.

Abra o HTML diretamente no Chrome ou Edge para ver as notas e revelar ou
copiar um campo por vez. A ferramenta preserva o arquivo de backup.
[Leitor independente](recovery/keeplocal-recovery.html).

O guia explica como reinstalar o KeepLocal e importar a cópia.
[Guia bilíngue](recovery/LEIA-ME.txt).

## Senhas e Chaves

- **Novo item** oferece um item em branco e modelos para servidor, banco de
  dados, chave de API, SSH, login web e Cloudflare R2 / S3. Os rótulos usam o
  idioma atual. Adicione conteúdo ou edite os rótulos para salvar o item.
  Todo bloco de texto vazio do editor mostra a dica “Observações”.
- Se o novo rótulo tornaria público um campo secreto preenchido, o KeepLocal
  mantém o campo secreto. Use o cadeado para torná-lo público de propósito.
  A escolha explícita do cadeado prevalece sobre o rótulo.
- Use as estrelas do editor para escolher um campo principal em cada classe,
  pública ou secreta. O principal público aparece no subtítulo, e o card oferece
  cópia rápida para cada classe com valor principal preenchido. O KeepLocal
  tenta limpar a área de transferência após 20 segundos. Histórico e sincronização entre dispositivos podem reter
  valores copiados.
- **Gerar** num campo secreto começa em 24 caracteres, ajustável entre 8 e 128.
  Selecione as classes e escolha se quer evitar caracteres parecidos.
  Substituir um valor existente requer confirmação.
- O editor guarda 50 passos de desfazer em memória. Use os botões ou Ctrl/Cmd+Z
  e Ctrl/Cmd+Shift+Z fora de campos de texto. Nos campos, o navegador controla
  o desfazer. Fechar o editor ou bloquear apaga o histórico.
- **Bloqueio da seção** oferece o padrão de cinco minutos, dois minutos ou um
  minuto de inatividade enquanto a seção ou um item está aberto. A preferência
  fica neste navegador. Nas demais telas, o prazo é de cinco minutos.

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
  nova revisão, relê e confere. Gravar na pasta não conta como backup manual.
  Se o principal válido for diferente da cópia mais recente da pasta, o
  KeepLocal guarda e confere seus bytes exatos em `keeplocal-preserved/`
  antes de substituí-lo. Se a preservação falhar, o principal fica intacto.
- **Nome deste computador.** Ao conectar a pasta do cofre, escolha um nome
  opcional de 1 a 40 caracteres. Edite em **Configurações → Pasta do cofre**.
  O nome permanece neste navegador após importar, trocar a pasta ou trocar a
  frase-senha. Nas gravações da pasta e nos backups manuais, o nome do
  computador que gravou fica cifrado.
- **Versão da pasta.** A barra lateral mostra a versão gravada, carregada,
  mesclada ou adotada. Ela diz **De Desktop, versão:** ou **Versão:** quando
  o arquivo não tem nome. A data e a hora incluem segundos e seguem o
  relógio do computador que gravou. O KeepLocal confere a cópia local.
  O serviço de entrega controla quando o arquivo chega a outro computador.
- **Verificar a pasta agora.** O ícone ao lado da versão faz a mesma
  verificação que voltar à janela. Se nada mudou, não há gravações. O
  controle fica desativado em somente leitura. A cada 60 segundos com a
  aba visível e a janela em foco, o KeepLocal confere nome, tamanho e data de modificação
  dos backups na raiz da pasta. Uma mudança dispara a verificação normal.
  A revisão cifrada determina qual cópia é mais recente.
- **Histórico da pasta.** A primeira gravação normal e conferida do dia e da
  semana também copia os bytes exatos do principal para `keeplocal-history/`.
  São sete vagas diárias e quatro semanais, no calendário local. Uma cópia
  válida do mesmo período que abre com a chave atual do cofre fica na vaga.
  O rodízio reutiliza a vaga por sobrescrita. Antes de substituir uma vaga
  com revisão válida maior ou com um arquivo não vazio de até 64 MiB que
  a chave atual não abre, o KeepLocal guarda os bytes exatos em
  `keeplocal-preserved/` e os relê para conferir. Se a preservação falhar,
  a vaga fica intacta e o arquivo principal continua gravado.
  O app nunca apaga os arquivos do histórico nem os carrega automaticamente.
  Em Configurações, veja quando a cópia do dia foi conferida.
- **Entrar:** o pedido de permissão da pasta é a primeira ação do clique. A
  disponibilidade é decidida listando a pasta. Todo `*.keeplocal` da raiz (no
  máximo 32, 64 MiB cada; cópias de conflito do Mega incluídas) é autenticado com
  a chave da sessão quando tem o salt do cofre. A cabeça é o maior `rev` cifrado,
  nunca a data do arquivo. Outros arquivos são ignorados.
- **Trocar a frase-senha com uma pasta conectada** exige que a conferência das
  mudanças de outros computadores tenha terminado. O KeepLocal preserva o
  principal atual em `keeplocal-preserved/`, grava e confere a senha nova na pasta
  e depois substitui o cofre local numa transação única com guarda. Se a gravação
  da pasta terminar e a aplicação local falhar, bloqueie e entre com a senha nova
  para concluir a recuperação. As preservadas, os backups manuais antigos e as
  versões anteriores dos arquivos continuam usando a senha de cada cópia.
- **Uma frase-senha trocada em outro computador** pode ser usada ao entrar. O app
  primeiro pede a permissão da pasta e confere o principal se a senha falhar neste
  navegador. Carrega a cópia nova diretamente quando o local está limpo e o
  histórico cifrado comprova que suas notas estão incluídas. Quando falta essa
  prova, digite a senha antiga do local para comparar e juntar, ou abra a cópia
  da pasta só leitura. Entrar com a senha antiga oferece o diálogo da senha da
  pasta. Conectar uma pasta de outra senha oferece o mesmo diálogo e compara
  as notas antes de substituir qualquer coisa.
- **Abrir cópia de outra pasta** fica nas configurações da pasta e na tela de
  pasta indisponível. Escolha uma pasta, inclusive `keeplocal-history/` ou
  `keeplocal-preserved/`, selecione um `.keeplocal` e digite a senha dele
  quando necessário. A lista
  seleciona a maior revisão que abre e avisa quando ela é mais antiga que a
  última vista aqui. A visão permite busca, seções, revelar e copiar, com
  auto-ocultar e limpeza do clipboard. A faixa identifica o arquivo e a revisão.
  Editar, exportar e as ações de pasta ficam indisponíveis. A visão grava zero
  dados no IndexedDB e nas duas pastas e pausa as gravações da pasta. Voltar
  restaura as notas deste navegador e o modo anterior. Voltar, bloquear e expirar
  a sessão descartam a cópia e sua chave. Para usar uma cópia do histórico
  ou preservada, use **Configurações → Importar backup**. Para uma cópia de
  outra pasta de cofre, **Escolher outra pasta** compara e pergunta antes
  de substituir.
- **Decisão:** um navegador sem alterações locais carrega diretamente um
  arquivo mais novo quando o hash ou o clock cifrado comprova descendência
  da última versão em comum. Um clock não vazio comprova descendência quando
  todos os contadores dessa versão estão presentes com valor igual ou maior.
  O pai e os hashes de ancestrais também comprovam descendência, inclusive
  para arquivos antigos sem clock. Depois da primeira cópia em comum,
  alterações divergentes e cabeças empatadas são comparadas por nota ao entrar
  e ao focar. A revisão continua
  para revisões antigas, primeira conexão com dados diferentes e uma cópia
  principal incompatível ou ilegível. Na primeira conexão, um cofre vazio
  sem registros de exclusão carrega a pasta. Um conjunto idêntico é adotado
  sem gravar.
- **Mesclagem:** o pai cifrado, a lista opcional `ancestors` e o campo opcional
  `clock` identificam estados em comum para comparar as alterações. Cada
  cofre local recebe um UUID de gravador na primeira escrita na pasta. Antes
  de abrir o arquivo para escrever, uma transação local guardada reserva o
  próximo contador e uma base pendente com as versões das notas locais usadas
  nessa gravação. Uma interrupção pode deixar uma lacuna, e a próxima tentativa
  sempre avança o contador reservado. O export manual leva o clock sem somar.
  A junção leva os maiores contadores de todas as fontes e incrementa o deste
  PC. O clock guarda até 64 gravadores. Ao ultrapassar esse limite, uma escrita
  remove entradas de outros gravadores pelo menor contador e depois pelo ID,
  mantendo a própria entrada.
  A base pendente e um histórico de até quatro estados ficam só no navegador.
  A mesclagem usa a pendente quando comprovada, depois a primeira entrada
  comprovada desse histórico, com o último estado registrado da pasta como
  reserva.
  Uma pendente anterior entra na frente do histórico antes de outra gravação
  substituí-la. Um recibo com o mesmo clock não vazio ocupa seu lugar na lista.
  O registro da gravação conferida leva histórico e clocks com
  os hashes correspondentes e remove a pendente em uma única transação.
  Escolher explicitamente um dos lados conserva só o estado escolhido como
  base. Um reset do cofre gera outro UUID de gravador. Edições em notas
  diferentes podem ser juntadas a partir de uma base comprovada. Se a mesma
  nota tem edições de conteúdo concorrentes ou conteúdo diferente sem base
  conhecida, a versão mais recente mantém o ID e a outra vira uma cópia de
  conflito, com a data da edição em UTC. A poda do clock também pode deixar
  uma versão sem prova e exigir uma cópia de conflito.
  Ao criar uma cópia de conflito ou ao escolher **Juntar as duas**, o app guarda
  os originais da pasta e do navegador em `keeplocal-preserved/` e os relê antes
  da substituição. Participam a maior revisão cifrada e as outras cópias com a
  mesma revisão. A mesclagem mantém o tema e o idioma deste navegador. O aviso
  lista as alterações que ocorreram.
- **Exclusões definitivas:** as cópias cifradas guardam até 10000 registros
  de exclusão por 365 dias. A exclusão vence quando a outra versão está igual
  à cópia em comum. Uma versão alterada ou sem base conhecida é mantida. Cada
  computador mostra um aviso conforme a nota tenha sido editada ou apagada nele.
- **Revisão:** Juntar as duas preserva as duas fontes antes da mesclagem.
  As escolhas de usar um dos lados continuam disponíveis. Toda substituição
  exige digitar SUBSTITUIR. Os arquivos preservados abrem pelo Importar normal.
  O app mantém esses arquivos na subpasta e consulta só a raiz. Gravar na
  pasta exige zero registros locais ilegíveis.
- **Pasta indisponível:** uma tela de bloqueio oferece Tentar de novo, Escolher
  outra pasta, Abrir só leitura, Começar do zero… e Sair. O somente leitura é
  imposto na camada de dados (nenhuma gravação ou mesclagem). Leituras da pasta têm prazo
  (15 s para metadados, 60 s por arquivo): uma pasta que não responde leva à tela
  "A pasta não respondeu", sem travar o login. Se continuar, escolha a mesma pasta
  de novo em **Escolher outra pasta**. Quando o Chrome reconhece a mesma pasta,
  o KeepLocal troca o handle e mantém o recibo, o histórico e a configuração
  das fotos. Gravações não têm prazo.
- **Desconectar e redefinir:** desconectar preserva o conteúdo da pasta. Redefinir
  na tela de login ou Começar do zero… apaga o cofre local e o vínculo com a
  pasta, nunca a cópia na pasta. Importar na tela de login é recusado enquanto
  houver pasta conectada.

### Fotos (só na extensão)

O KeepLocal pode anexar uma cópia cifrada do arquivo principal do cofre a um
JPEG ou PNG. A foto continua abrindo como imagem. O trailer contém os bytes
exatos do principal seguidos de seu tamanho em 4 bytes little-endian. A imagem
tem limite de 32 MiB e a cópia cifrada, de 64 MiB. Em **Configurações → Pasta do
cofre → Fotos**, escolha uma pasta separada com exatamente sete cópias
dedicadas em JPEG ou PNG. Em ordem alfabética, a primeira fica para
segunda-feira e a sétima para domingo. Confira os nomes e os dias antes de
confirmar.

Depois de uma gravação normal e conferida na pasta do cofre, o KeepLocal
atualiza a foto do dia se passou uma hora desde a última gravação da foto ou se
o dia local mudou. Use **Gravar agora**, abaixo de **Backup**, para salvar as
edições pendentes no arquivo do cofre e gravar a foto do dia na hora. Uma
notificação informa o resultado. **Backup** continua exportando um arquivo
separado.

O KeepLocal lê as sete fotos ao escolher a pasta. Depois, só lê a foto do dia
quando vai atualizá-la. O app nunca carrega o cofre automaticamente de uma
foto nem cria, renomeia ou apaga fotos. Escolha a pasta de fotos de novo após
importar um backup, começar do zero, desconectar ou trocar a pasta do cofre.
Carregar da pasta, mesclar, escolher um lado na revisão e trocar a frase-senha
na mesma conexão mantêm a pasta de fotos e seu recibo.

Para recuperar, abra as sete fotos em `keeplocal-recovery.html` e digite a
senha de cada cópia. Escolha a maior revisão (rev) que abriu e selecione essa
foto em **Importar backup**. Se um programa regravar a foto, como um editor,
uma rede social ou um compressor, a cópia anexada será perdida.

### Restaurar uma cópia do histórico da pasta

1. Entre no cofre e escolha **Configurações → Importar backup**. Selecione o
   arquivo `.keeplocal` em `keeplocal-history/` e digite a frase-senha daquela
   cópia. Confirme a substituição do cofre local e a desconexão da pasta.
   Com a pasta conectada, o KeepLocal grava e confere uma cópia do cofre local
   atual em `keeplocal-preserved/` antes da substituição. Se a preservação
   falhar, exporte o cofre ou desconecte a pasta antes de importar.
2. Em **Configurações → Pasta do cofre → Escolher pasta…**, selecione a pasta
   original do cofre. Se o app pedir, digite a frase-senha do arquivo
   principal atual para comparar as cópias. Na revisão, escolha **Gravar os
   dados locais na pasta** e digite **SUBSTITUIR**. O KeepLocal preserva o
   principal anterior em `keeplocal-preserved/` e o relê antes de gravar a
   cópia restaurada.

Uma cópia feita antes de trocar a frase-senha abre com a senha antiga.
Importá-la restaura essa senha neste navegador. Troque a frase-senha de novo
depois de restaurar a cópia.

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
não pode ser restaurado integralmente nesse estado. A Recuperação mostra o
JSON decifrado de notas de texto e listas que passam na validação e permite
criar uma nota de texto a partir dele. Conteúdo acima do limite fica somente
para leitura. Os demais registros exigem revelação explícita e ficam somente
para leitura. O conteúdo revelado some quando a janela perde o foco.
**Exportar agora** preserva o registro para o descarte.
Depois confira o arquivo salvo, marque a confirmação explícita e digite DESCARTAR
para remover o registro ilegível deste navegador. O descarte local não envia
um marcador de exclusão aos outros computadores. Uma cópia legível em outro
computador pode voltar pela mesclagem da pasta.
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
