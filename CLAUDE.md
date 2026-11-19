# KeepLocal — definições do projeto

@.github/copilot-instructions.md

O arquivo importado acima é o **contrato técnico** (formato dos dados, módulos, backup v2, comandos do gate). Este arquivo guarda o que ele não cobre: como trabalhamos, o que não pode regredir e o que já foi decidido.

## Contexto

Cópia do Google Keep, 100% no navegador (SPA e extensão Chrome MV3), notas cifradas (AES-256-GCM, PBKDF2) no IndexedDB. O dono quer usá-la para guardar senhas e chaves de servidores. **Na extensão**, a pasta do cofre (Fase 3, Etapas F–G3, mesclada) grava uma cópia cifrada numa pasta sincronizada (Mega) e confere a pasta ao entrar; o SPA servido por HTTP tem só o **backup manual** (`.keeplocal`). A Etapa H da Fase 3 (merge por nota e o resto) **está bloqueada**. A seção "Senhas e Chaves" (Fase 4) tem o **núcleo mesclado** (Etapa D) e o restante (Etapa E) aguarda pedido do dono (ver "Decisões aprovadas").

O dono escreve em **português (pt-BR)**. Respostas e relatórios em português; **código, commits e identificadores em inglês**; todo texto de interface com chaves **EN e pt-BR** (`t()`/`tp()`).

## Como trabalhamos

- **Claude (esta sessão):** análise, plano e **revisão independente**. Não aceitar relatório de execução como prova: reproduzir o gate, comparar com a base e tentar quebrar (sondas próprias).
- **Codex:** executa o plano numa branch **no próprio checkout** (`git switch`; nunca worktree separado, para o dono acompanhar no VS Code), com gate verde por commit, e escreve um relatório. Depois do merge, o checkout volta para a `master`.
- **Dono:** autoriza cada etapa, **faz todo `git push`**, aprova merges e faz os testes manuais (Windows, Mega, extensão instalada).
- **Fonte da verdade do plano:** `_temp/plano-correcoes-keeplocal.md` (caixas, registro de execução, Desvios, Pendências). Pareceres em `_temp/parecer-*.md`; evidências e scripts de revisão em `_temp/revisao-claude-*/`; relatórios do Codex em `_temp/relatorio-execucao-*.md`. `_temp/` é ignorado pelo Git (já está no `.gitignore`).
- Cada etapa termina em **parada**: nenhuma fase seguinte começa sem pedido do dono.

## Regras de Git (acordo do dono)

- Trabalho planejado ou não trivial: **branch primeiro**, a partir da `master`; **commits por fase/tarefa**, logo depois do gate verde; Conventional Commits em inglês.
- **Nunca `git push`.** Merge na `master` **só com aprovação explícita** do dono (feito com `--no-ff`).
- Branches já mescladas podem ser apagadas com `git branch -d` (autorizado pelo dono em 2026-11-18).
- Mudança trivial (docs) na `master` só **depois de o dono aprovar**.
- Adicionar ao stage **sempre por caminho explícito** (nunca `git add -A`/`.`).
- `chrome-extension/{js,css,lib,index.html}` são cópias **versionadas**: depois de mexer em `js/`, `css/`, `lib/` ou `index.html`, rodar `bash build-extension.sh` e commitar as cópias no mesmo commit.
- Commits feitos por Claude terminam com `Co-Authored-By: Claude <noreply@anthropic.com>` (use a linha de atribuição indicada pelo ambiente).

## Gate (resumo; detalhes em `tests/README.md`)

`node --test tests/unit`, `CHROME_BIN=… node tests/browser/run.mjs`, `bash build-extension.sh`, `node tests/build/extension.mjs`, `diff -r` das cópias e `git diff --check`.

- **Máquina compartilhada: no máximo 4 CPUs** (pedido do dono, 2026-11-19). Vale para Claude e Codex, em testes, gate, sondas e builds: prefixar com `taskset -c 0-3 nice -n 10` e rodar os unitários com `node --test --test-concurrency=4 tests/unit`. A afinidade passa para os processos filhos (Chrome incluso). `systemd-run -p CPUQuota` **não** limita neste WSL (o cgroup do usuário não tem `cpu`). Uma falha que só aparece com o limite é bug de tempo, não motivo para tirar o limite.

- Um `SKIP` do navegador **não é aprovação**.
- Fechamento de fase: o runner de browser completo passa **3 vezes seguidas, sem reexecutar falha isolada**. Teste intermitente é **bug** (já houve um: autosave × ação de barra), não "flake".
- Testes só com dados fictícios e perfis descartáveis. **Nunca** o cofre real, `D:\MegaSync` ou o perfil habitual do Chrome.

## Invariantes — não regredir

1. **Chave e senha nunca são persistidas** (nem `sessionStorage`/`localStorage`): chave não extraível, só em memória; recarregar pede a senha.
2. **Nenhuma mutação antecipada** do objeto vivo da nota: ações de metadados e edições passam por `note-write-queue.js`; a memória só recebe o valor **depois** de gravar.
3. **Escrita de nota** usa a guarda de banco (versão/`vaultId`) dentro da transação; falha não deixa tela, memória e banco divergentes.
4. **Perfil 2 do backup v2 é imutável**; leitores futuros devem continuar abrindo cópias antigas. Sem cabeçalho/magic em claro.
5. **Registros ilegíveis nunca são apagados em silêncio.** Descarte exige: export desta sessão, confirmação de "arquivo salvo" e palavra digitada, reconferidos na transação final.
6. **A UI nunca afirma "sincronizado com a nuvem"** (o app não enxerga o Mega); iniciar um download não confirma gravação.
7. **Sem recurso remoto**: CSP restritiva, Markdown sanitizado, sem imagem/rede. Manifest `1.0.0` e `permissions: []`.
8. Para ver qualquer mudança de comportamento: escrever primeiro o teste que **falha antes e passa depois**.
9. **Segredo de item `vault` fica fora da tela por padrão:**
   - **Onde nunca aparece:** DOM de card/lista/grade/busca/toast/console, armazenamento e meta. Aparece só no campo revelado (com auto-ocultar) e no `value` do campo em edição.
   - **Campo nasce secreto:** `isSecretField = secret ?? (secretLabel || !publicLabel)`. Só fica público, automaticamente, um rótulo claramente público (palavra inteira).
   - **Quem grava a flag:** só o cadeado grava `secret`, e a escolha manual vence o rótulo.
10. **Resolver conflito da pasta nunca destrói a única cópia de uma versão:** o lado que perde vai antes para `keeplocal-preserved/` (relido e conferido); se a preservação falhar, nada é substituído. O app nunca limpa essa subpasta e a leitura olha só a raiz.
11. **Pasta do cofre:** somente leitura = **0 escritas** (pasta e IndexedDB) fora de uma escolha explícita; toda leitura da pasta tem prazo (`folder-timeout.js`) e uma pasta que não responde leva à tela de bloqueio, nunca a um login travado; a decisão usa o `rev` cifrado, nunca a data do arquivo.

## Decisões aprovadas (Fase 3: F–G3 mescladas, H bloqueada; Fase 4: D mesclada, E aguarda)

Detalhe completo no plano (Fases 3 e 4). Resumo:

**Fase 3 — pasta do cofre (File System Access API), só na extensão** (decisão do dono, 2026-11-18; ID fixo pela `key` do manifest)
- Spike e roteiro manual final no Windows/Chrome/Mega concluídos (`_temp/parecer-roteiro-manual-final-claude.md`). Orientar **"Allow on every visit"**; persistência entre reinícios confirmada pelo dono.
- Handle de **diretório**; só o nome da pasta é exibido; senha **a cada abertura** (chave em memória). No clique de "Entrar", `requestPermission` é a **primeira** chamada, antes do PBKDF2. Disponibilidade só por leitura real (listar), nunca por `queryPermission`.
- Arquivo `keeplocal-vault.keeplocal` = backup v2 perfil 2 **sem mudança**, mesma linhagem `rev`/`parent` do export. Candidatos: `*.keeplocal` da raiz (até 32, 64 MiB). Identidade = salt; mesmo salt decifra com a chave da sessão.
- Cabeça = cópia válida de maior **`rev` dentro do payload cifrado** (nunca a data do arquivo); lacunas de `rev` são normais. Decisão por cofre inteiro (push/pull/adopt; conflito, rollback, outra senha e cópia ilegível **param e perguntam**). Primeira conexão: 0 registros locais → pull; conjunto idêntico → adopt; o resto → conflito.
- **Pasta indisponível bloqueia** com: tentar de novo / escolher outra pasta / **abrir só leitura** / começar do zero / sair. Pasta que não responde (R5) → tela `unresponsive` (prazos de 15 s metadados, 60 s por arquivo); gravações ainda sem prazo.
- Sincronização só ativa com **0 registros ilegíveis**. Gravar na pasta não marca "backup feito".
- **Etapa H (bloqueada):** merge por nota e *tombstones*, cópias rotativas, salt diferente (senha trocada em outro PC), abrir de outra pasta como **recuperação somente leitura**, fotos com trailer (T3.8, opcional) e kit/ferramenta de recuperação independente (T3.9).

**Fase 4 — "Senhas e Chaves"** (núcleo = Etapa D, mesclado; Etapa E = T4.7 modelos, T4.8 cópia rápida/estrela, T4.9 gerador, T4.11 desfazer/timeout, aguarda pedido do dono)
- Nota `type: 'vault'` com **blocos** livres (texto, campo, divisor); campo com flag `secret` e `multiline`. O campo **nasce secreto** (decisão do dono, 2026-11-18, opção A do D-B1). Fica público automaticamente só com rótulo claramente público (host, usuário, url, e-mail, porta, banco, bucket, região, ip, conta…). Termo sensível vence termo público. O cadeado manual vence o rótulo.
- Itens `vault` não têm "arquivar"; usam a Lixeira comum. `meta.vaultLayout` (lista/grade) é **só local** e não entra no export. Blocos de texto ficam fora da busca.
- Segredo **nunca** no DOM de card/lista/busca/toast; revelar com auto-ocultar; copiar com limpeza do clipboard; busca só em título, tags, rótulos e campos **não secretos**; tags isoladas por seção.
- Visões lista ⇄ grade guardada por seção; modo leitura por padrão; modelos (Servidor, Banco, API key, SSH, Login web, Cloudflare R2/S3); gerador de senha.

## Estado (2026-11-19)

- Fases 0–2c **mescladas na `master`** (merge `--no-ff`, `4c8391b`), revisadas de forma independente a cada etapa. Branch e worktree dessa etapa já foram removidos.
- **Ainda não há dados reais.** A versão antiga só foi usada em testes (informado pelo dono em 2026-11-17); o dono **avisa quando for usar de verdade**. Até lá, **não** exigir migração com cópia, troca de senha por causa do verificador antigo nem limpeza de backups antigos do Mega.
- **Antes do uso real (dono):** escolher a senha mestra (5–6 palavras sorteadas); conferir as configurações do Chrome (nunca salvar senhas, sem autofill, ortografia básica); **desativar o histórico do Win+V e a sincronização da área de transferência** (o roteiro manual mostrou que o Win+V retém a senha copiada mesmo após a limpeza); decidir o G3-L1.
- **Etapa C (Fases 2d/2e + C1) mesclada na `master`** (merge `--no-ff` `de53ea6`), revisada de forma independente: formulários, alertas, plurais, textos e diálogos do app (Enter aciona o botão focado); lote com proveniência local e replanejamento dentro das filas; fuzz de 40000 execuções; texto do recibo simplificado.
- **Compatibilidade removida por autorização do dono:** não há importação JSON v1 nem migração de login antigo. Cofre com salt e sem `keyCheck` é recusado com instrução de reset explícito, sem apagar dados automaticamente. O gate usa somente dados v2 fabricados, sem checkout-base. O perfil 2 binário continua imutável.
- **Etapa D (Fase 4, núcleo) + D1 mesclada na `master`** (merge `--no-ff` `3ac58c8`), revisada de forma independente: modelo `vault`, seção lista/grade, detalhe em leitura, editor de blocos pela fila, revelar/copiar com limpeza do clipboard, busca só em campos públicos, labels isoladas e campo que nasce secreto. Pareceres: `_temp/parecer-revisao-etapa-d-claude.md` e `_temp/parecer-revisao-etapa-d1-claude.md`. Teste manual na extensão instalada feito no roteiro final da Fase 3.
- **Fase 3, Etapas F+G+G1+G2+G3 mescladas na `master`** (merge `--no-ff` `a6fe87b`), revisadas de forma independente a cada etapa (`_temp/parecer-revisao-etapa-{f,g,g1,g2,g3}-claude.md`) e no roteiro manual do Windows. Gate do merge: 37 unitários, 3×129 navegador. **Pendência baixa G3-L1:** escolher a mesma pasta só troca o handle guardado se o `isSameEntry` estourar o prazo; contorno: Configurações → Desconectar → Escolher pasta.
- A Etapa H da Fase 3 e a Etapa E da Fase 4 só começam com pedido do dono.

## Armadilhas de ferramenta

- Scripts de revisão: use **bash**, não zsh (zsh não divide `$var` em palavras). `pkill -f` pode casar com o próprio shell: liste por PID antes.
- `rm` com glob relativo após `cd` é bloqueado: use nomes explícitos ou diretórios novos.
- O hook `rtk` pode reescrever um comando e exigir que ele seja reemitido idêntico.
- O estilo dos módulos novos é denso (várias instruções por linha). Não fazer refatoração ampla de `app.js`; lógica nova vai em módulos próprios.
