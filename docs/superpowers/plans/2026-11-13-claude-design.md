# Claude Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disponibilizar criação e atualização de Claude Design por ferramentas autorizadas do agentes.chat, com execução dedicada, resultados persistidos e recuperação conservadora.

**Architecture:** Reutilizar Tool Gateway, contas, `task.start`, journal/outbox e arquivos do Drive. Encapsular a dependência experimental de `Artifact` num módulo de runner separado; a primeira fase comprova autenticação, autorização anterior aos efeitos e recuperação antes de construir a integração.

**Tech Stack:** TypeScript, Bun 1.4.4, Hono, Drizzle/PostgreSQL, PGlite, Claude Code CLI candidato 2.1.322, React e componentes existentes web/mobile.

**Spec:** [Desenho proposto](../specs/2026-11-13-claude-design-design.md).

**Status:** execução Native aprovada pelo usuário em 2026-11-13; conta Max do Claude Code local explicitamente selecionada para o experimento. Task 1: spike local concluído, conforme relatório e ledger. Iniciar Task 2 somente para a combinação delimitada; não presumir suporte de outras contas/métodos/plataformas.

## Bloqueio de execução posterior

O smoke autenticado do manager de produção encontrou uma exigência nativa de consentimento interativo que o callback headless não consegue exibir. A conclusão anterior da fase A fica restrita ao spike; não valida a barreira final. Tasks 1–7 implementadas experimentalmente; controles da Task 8 e qualificação stdio concluídos na continuação. A admissão do piloto em produção permanece fechada. A composição do app exige também uma admissão de rollout atualmente falsa, independentemente da variável experimental. Ver [evidência atualizada](../research/2026-11-13-claude-design.md). Não considerar este plano concluído nem habilitar o piloto antes de validar o fluxo completo com as mesmas permissões do app.

## Global Constraints

- O recurso começa desligado: `CLAUDE_DESIGN_EXPERIMENTAL=false`.
- A única versão candidata inicial é `2.1.322`; ela só entra na lista validada depois do experimento do app passar. Não presumir suporte de versões posteriores.
- Não usar `bypassPermissions`, `--dangerously-skip-permissions` nem `--bare`.
- Não habilitar `personalMcp` e não alterar o perfil `chat` do Lodi.
- Não mudar o método de autenticação de uma conta nem recorrer a outra conta quando houver falha.
- Primeiro suporte candidato: macOS arm64, runner user no mesmo usuário do SO e conta com método `cli_login`; demais combinações indisponíveis até validação própria.
- Credenciais ficam no runner e no mecanismo existente de contas; nunca em prompts, arquivos de resultado, eventos, fixtures ou clientes.
- Toda operação passa pelo Tool Gateway, pela política de autoridade e pelos limites/contabilização existentes de execuções em planos.
- Toda tabela nova tem `org_id`; referências entre entidades verificam a organização.
- Configuração do app nasce em `packages/config/src/schema.ts`; testes automatizados comuns usam fakes e PGlite, sem rede, credenciais ou `.env`.
- PostgreSQL continua sendo a única dependência obrigatória; nenhuma biblioteca nova é necessária por padrão.
- Piloto proposto: DM da pessoa proprietária da conta, concessão explícita por agente, sem rotinas ou publicação em canais compartilhados.

## Review Focus

1. Conta selecionada sem suporte a Artifact ou `setup-token` sem compatibilidade: recusar sem mudar login/conta; testes das tarefas 1, 3 e 6.
2. Hook ausente, quebrado ou contornado por leitura interna/referência `@`: impedir efeito antes da chamada; tarefas 1 e 4.
3. Queda entre publicação e persistência, com frame duplicado: reconciliar a mesma tarefa, marcar incerteza e não republicar; tarefas 5 e 7.
4. Design editado fora do app ou conta revogada entre aprovação e despacho: recusar conflito/revalidar autoridade; tarefas 3, 6 e 7.
5. Resultado contendo fonte ativa, caminho simbólico ou URL inventada no texto: não executar na origem do app, não ler fora da pasta e não registrar sucesso; tarefas 4, 5 e 7.

## Mapa de arquivos e responsabilidades

| Área | Arquivos previstos | Responsabilidade |
| --- | --- | --- |
| Evidência | `apps/server/scripts/probe-claude-design.ts`, `docs/superpowers/research/2026-11-13-claude-design.md` | Experimento separado de CI e matriz sanitizada de resultados |
| Contrato | `packages/adapters/src/claude-design.ts`, `packages/adapters/src/machine-protocol.ts`, `packages/adapters/src/index.ts` | Payloads, resultados e compatibilidade de protocolo |
| Dados | `packages/db/src/schema/claude-design.ts`, `packages/db/src/schema/index.ts`, nova migração gerada | Concessões, trabalhos e identidade dos designs |
| Serviço | `packages/engine/src/claude-design/{access,service,ledger,tools,files}.ts` | Autoridade, despacho, estados, ferramentas e importação de arquivos |
| Execução | `apps/server/runner/claude-design/{manager,guard,stream}.ts` | Perfil dedicado, barreira prévia e normalização do stream |
| Integração runner | `apps/server/runner/{tasks,supervisor,worker}.ts` | Reconhecer variante de tarefa e usar conta/ciclo existentes |
| Integração engine | `packages/engine/src/{machine-tasks,machine-hub,jobs,index}.ts`, `packages/engine/src/tools/{scopes,run-policy}.ts` | Persistir frames, reconciliar, registrar ferramenta e política |
| Configuração/API | `packages/config/src/schema.ts`, `apps/server/src/{engine,app}.ts`, `apps/server/src/routes/app/claude-design.ts` | Flag, dependências e concessão/consulta/cancelamento |
| Clientes | `packages/client/src/lib/claude-design.ts`, controles novos ao lado de `AiAccounts.tsx` e `AiAccountsScreen.tsx` | Habilitação e estados do piloto, sem editor novo |
| Texto | `packages/i18n/src/en.ts`, `packages/i18n/src/pt-BR.ts`, `apps/mobile/src/i18n/keys.en.ts`, `apps/mobile/src/i18n/keys.pt-BR.ts` | Mensagens de disponibilidade, resultado e incerteza |

A migração e o ADR recebem o próximo número livre, sem alterar arquivos existentes já publicados. A entrada executável do hook será registrada em `apps/server/runner/main.ts`, incluindo o empacotamento existente do runner quando necessário.

## Ordem e portas de decisão

`1 (viabilidade) → 2 (contratos) → 3 (dados/acesso) → 4 (barreira/runner) → 5 (ciclo de tarefa) → 6 (gateway/API) → 7 (resultado/recuperação) → 8 (clientes/piloto)`.

Evidência parcial de Task 1: [relatório de viabilidade local](../research/2026-11-13-claude-design.md). O spike local passou para a combinação delimitada; métodos/modos não testados ficam indisponíveis, e a recuperação persistente será verificada nas Tasks 5/7. Depois da tarefa 1, atualizar o desenho e este plano com os esquemas verificados. Se a evidência mudar a arquitetura ou exigir um login novo, voltar à revisão do desenho; não substituir esse passo por permissões mais amplas. As tarefas seguintes têm contratos internos definidos abaixo, mas não inventam o schema do fornecedor.

### Task 1: Provar o fluxo no ambiente real do app

**Files:** Create `apps/server/scripts/probe-claude-design.ts`; Create `docs/superpowers/research/2026-11-13-claude-design.md`; Create `apps/server/test/runner/fixtures/claude-design/` com frames sintéticos/sanitizados; Modify spec e este plano após a evidência.

**Interfaces:** Consome o mecanismo existente de contas e spawn do runner. Produz `ClaudeDesignCompatibility` conceitual: versão, plataforma, modo de runner, método de autenticação, verificações `verified|failed|not_tested`, schema observado e fixture sem segredos. A tarefa 2 formaliza esse contrato.

- [x] Criar um probe que começa em modo de inspeção sem publicar: CLI/version, configuração efetiva sanitizada e ferramentas de `init`. Exigir seleção explícita de conta e opção `--execute` para as etapas com consumo/efeito.
- [x] Executar a matriz da fase A da spec na combinação candidata 2.1.322. Usar duas contas de teste autorizadas; se só houver uma, registrar isolamento como `not_tested` e não liberar essa combinação.
- [x] Criar e atualizar um design privado com permissões restritas, na combinação local autorizada; registrar resultados de ferramenta, sequência, schema real, conflitos e consumo sem concluir que o valor equivalente do CLI foi cobrado separadamente.
- [x] Exercitar a barreira antes da chamada: negar outro artefato, exclusão, listagem, compartilhamento, conectores e caminhos fora da pasta. Forçar erro, timeout, ausência de executável e saída inválida do hook; comprovar ausência de efeito no provedor.
- [x] Verificar os métodos de login já usados no app e a execução local/system, macOS Keychain e workers conforme cada combinação pretendida. Não alterar credenciais existentes para fazer o teste passar.
- [x] Interromper antes e depois da publicação e testar atualização concorrente com o editor externo. Demonstrar consulta somente de leitura para validar uma referência fornecida pelo proprietário, sua propriedade na conta e a versão; sem esse caminho a recuperação manual não é habilitada. Documentar o que pode ser recuperado e o que permanece `unknown`.
- [x] Redigir relatório sanitizado e atualizar fixtures. Sem credenciais, URLs privadas, nomes de conta ou conteúdo pessoal no repositório. Registrar limpeza como uma ação separada, somente quando autorizada.
- [x] **Porta de decisão:** prosseguir apenas para combinações verificadas; se o isolamento, a barreira ou o controle de conflito não puderem ser demonstrados, registrar impedimento e não construir a integração dessa combinação.
- [x] Commit sugerido: `docs(design): record Claude Design feasibility and contracts`.

**Verificação:** o probe deve recusar publicação sem `--execute`; relatório contém resultado explícito para cada requisito da fase A. CI não executa o probe autenticado. Não adicionar testes que apenas espelhem o script descartável.

### Task 2: Fixar contratos internos e disponibilidade experimental

**Files:** Create `packages/adapters/src/claude-design.ts`; Modify `packages/adapters/src/{index,machine-protocol}.ts`, `packages/config/src/schema.ts`, `.env.example`; Test `packages/adapters/test/claude-design.test.ts`, `packages/config/src/index.test.ts`.

**Interfaces:**

```ts
type ClaudeDesignAction = "create" | "update";
type ClaudeDesignState = "queued" | "running" | "published" | "succeeded" | "failed" | "canceled" | "unknown";
type ClaudeDesignFailure = "disabled" | "unsupported" | "auth_unverified" | "unavailable" | "forbidden" | "conflict" | "guard_failed" | "canceled" | "timeout" | "result_unknown" | "sources_incomplete" | "interactive_consent_required";
interface ClaudeDesignExecuteTask {
  mode: "execute";
  jobId: string;
  action: ClaudeDesignAction;
  title: string;
  brief: string;
  target?: { remoteId: string; remoteUrl: string; remoteVersion: string; revision: number };
  sources: { name: string; relativePath: string; sha256: string }[];
  grantRevision: number;
}
interface ClaudeDesignRecoveryTask {
  mode: "recover";
  jobId: string;
  remoteCandidateUrl: string;
  grantRevision: number;
}
type ClaudeDesignTask = ClaudeDesignExecuteTask | ClaudeDesignRecoveryTask;
interface ClaudeDesignRemote { id: string; url: string; version: string; }
interface ClaudeDesignResult {
  jobId: string;
  state: ClaudeDesignState;
  remote?: ClaudeDesignRemote;
  sourceFiles: { relativePath: string; sha256: string; size: number; contentType: string }[];
  error?: { code: ClaudeDesignFailure; message: string };
  recoveryEvidence?: "provider_checkpoint" | "owner_association";
}
interface ClaudeDesignEffectRequest {
  type: "design.authorize";
  requestId: string;
  taskId: string;
  jobId: string;
  grantRevision: number;
  sequence: number;
  effect: "create" | "read_target" | "publish";
  remoteId?: string;
  remoteVersion?: string;
}
interface ClaudeDesignEffectReply {
  type: "design.authorized";
  requestId: string;
  allow: boolean;
  error?: ClaudeDesignFailure;
}
```

`TaskStart.claudeDesign?: ClaudeDesignTask` só com executor `claude` e `account` obrigatório; resultado opcional `claudeDesign?: ClaudeDesignResult` em status/journal/`task.done`. Resultados usam versão remota como string opaca. Exportar `CLAUDE_DESIGN_LIMITS = { briefChars: 20_000, titleChars: 120, maxSources: 10, maxSourceBytes: 8 * 1024 * 1024, maxOutputFiles: 50, maxOutputBytes: 16 * 1024 * 1024, maxSeconds: 900 }` como limites propostos do produto, não limites declarados do fornecedor. Respeitar também limites menores de armazenamento e da máquina.

- [ ] Escrever testes `design_task_requires_explicit_account`, `update_requires_target`, `create_refuses_target`, `design_task_refuses_shell_mission_and_generic_resume`, `recovery_mode_refuses_execution_fields`, `rejects_oversized_input` e `unknown_state_does_not_imply_success`. Cobrir enums, campos inesperados, caminhos absolutos/ascendentes e limites acima. Pedidos internos de autorização fora de sequência ou sem task vinculada não obtêm `allow`.
- [ ] Executar `bun test packages/adapters/test/claude-design.test.ts` e confirmar falhas pelas interfaces ausentes.
- [ ] Implementar tipos e validadores `parseClaudeDesignTask(value: unknown): ClaudeDesignTask | null` e `parseClaudeDesignResult(value: unknown): ClaudeDesignResult | null`; adicionar `CLAUDE_DESIGN_PROTOCOL`, parsers e respostas tipadas do protocolo. Acrescentar `ClaudeDesignEffectRequest` a `RunnerFrame` e `ClaudeDesignEffectReply` aos frames servidor→runner, com validação das formas e correlação. Aplicar a validação a entradas reais de rede, não só a TypeScript.
- [ ] Adicionar flag com default false no config, injetado nas dependências; o runner recebe uma capacidade explícita e não consulta flag ambiente da instância. Incluir matriz de combinações verificadas produzida na tarefa 1 e a comparação exata de versão.
- [ ] Executar `bun run docs:env`, `bun test packages/adapters/test/claude-design.test.ts packages/config/src/index.test.ts` e typecheck dos pacotes adapters/config. Esperado: PASS; desligado por padrão.
- [ ] Commit sugerido: `feat(design): define experimental task contracts`.

### Task 3: Persistir concessões, trabalhos e autoridade

**Files:** Create `packages/db/src/schema/claude-design.ts`, `packages/engine/src/claude-design/{access,ledger}.ts`; Modify schema index; gerar migração nova; Test `packages/engine/test/claude-design-access.test.ts`, `packages/engine/test/claude-design-ledger.test.ts`, `packages/db/test/schema.test.ts`.

**Interfaces:** `setClaudeDesignGrant(deps, actorUserId, orgId, agentId, accountId: string | null): Promise<void>`; `authorizeClaudeDesign(deps, ctx: ToolContext, action: ClaudeDesignAction, designId?: string): Promise<AuthorizedClaudeDesign>`; `reserveClaudeDesignJob(deps, ctx: ToolContext, input: DesignInput): Promise<DesignJobView>`; `recordClaudeDesignResult(deps, taskId: string, result: ClaudeDesignResult): Promise<void>`. Definir `DesignInput = { action: ClaudeDesignAction; title?: string; brief: string; sourceArtifactIds: string[]; designId?: string; expectedRevision?: number }` e `AuthorizedClaudeDesign = { grantId: string; grantRevision: number; accountId: string; machineId: string; ownerUserId: string; agentId: string; orgId: string }`. Criação exige título; atualização herda o título registrado. `DesignJobView` contém `id: string`, `state: ClaudeDesignState`, `designId: string | null`, `revision: number | null`, `remote: ClaudeDesignRemote | null`, `artifactIds: string[]` e `error?: ClaudeDesignResult["error"]`; todas as leituras desse view verificam audiência.

- [ ] Escrever testes de recusa para outra organização, pessoa sem poder de administrar o agente, conta que não pertence à pessoa, conta incompatível, DM de terceiro, concessão revogada e atualização de design de outra conta/conversa. Fixture usa o acesso real do app, não um booleano de permissão inventado.
- [ ] Adicionar testes de idempotência para `(org, run, tool_use_id)` e chave obrigatória de invocação: ausência de `ctx.toolUseId` recusa antes de reservar. Mesmo ID com entrada diferente é conflito; entradas iguais em chamadas diferentes são trabalhos diferentes. Testar duas atualizações concorrentes, bloqueio durável em `queued/running/published/unknown` e transições conclusivas que não regridem; `unknown` aceita confirmação tardia válida, não é conclusivo.
- [ ] Rodar `bun test packages/engine/test/claude-design-access.test.ts packages/engine/test/claude-design-ledger.test.ts` e confirmar falhas.
- [ ] Criar as três tabelas da spec, índices e referências, gerar a migração com `bun run db:generate claude_design` e implementar as funções. Reservar antes do despacho; vincular taskId estável e tornar `queued → running` uma transição condicional de um único despachante. Uma reserva existente nunca despacha outra tarefa.
- [ ] Integrar revogação/troca/remoção da conta com a invalidação dos vínculos e sinal de cancelamento. Usar as regras existentes de proprietário e compartilhamento de contas, mantendo o piloto restrito ao próprio dono.
- [ ] Rodar os dois testes e `bun test packages/db/test/schema.test.ts`; esperado: PASS, incluindo todas as tabelas com `org_id`.
- [ ] Commit sugerido: `feat(design): persist grants and authorized jobs`.

### Task 4: Implementar o adaptador dedicado e sua barreira prévia

**Files:** Create `apps/server/runner/claude-design/{manager,guard,stream}.ts`; integrar entrada de hook no comando do runner existente; Test `apps/server/test/runner/claude-design-guard.test.ts`, `apps/server/test/runner/claude-design-stream.test.ts`; fixtures sanitizadas da tarefa 1.

**Interfaces:** `buildClaudeDesignLaunch(input: VerifiedDesignLaunch): ClaudeLaunchSpec`; `decideClaudeDesignTool(session: DesignGuardSession, call: unknown): GuardDecision`; `parseClaudeDesignFrame(state: DesignStreamState, frame: unknown): DesignStreamUpdate`. Os tipos de launch/guard são internos ao runner; `DesignGuardSession` é estado confiável que associa job, conta, pasta real, ação, alvo e sequência permitida. `GuardDecision` é `{ allow: true } | { allow: false; reason: ClaudeDesignFailure }`. Manager recebe dependências de spawn, relógio, conta e journal, todas substituíveis em teste.

- [ ] Criar testes que permitem somente a sequência medida na tarefa 1 e negam operação desconhecida, outro remoteId, outra versão, segunda criação, exclusão/listagem/compartilhamento, chamada a conectores e ferramentas extras. Asserção central: `providerEffects === []` quando negado.
- [ ] Testar caminhos `..`, absolutos, links simbólicos, referências `@`, arquivo de credenciais, configuração/hook e leitura/edição embutida em Artifact. Testar hook ausente/timeout/erro/JSON inválido: nenhum efeito externo.
- [ ] Testar o parser com linha truncada, Unicode fragmentado, resultado de ferramenta com erro, tool_result duplicado, URL apenas em texto livre e schemas desconhecidos. Só fixture de ferramenta bem-sucedida validada produz `remote`.
- [ ] Rodar os dois testes e confirmar falhas. Implementar o adaptador conforme a evidência, sem reaproveitar automaticamente as opções do brain principal. Manter restrições de MCP/settings, permitir somente a lista medida e bloquear descoberta de configurações pessoais.
- [ ] Injetar `CLAUDE_CODE_ARTIFACT=1` e `CLAUDE_CODE_ARTIFACT_AUTO_OPEN=0` apenas no processo dedicado; remover seletores de API/gateway/cloud que desviem a autenticação, usando a preparação existente de contas. Não usar um filtro parcial que ainda deixe credencial de outro provedor ativa. Configurar desativação de referências de arquivos e edição embutida conforme o probe; fixar `CLAUDE_CODE_TMPDIR` no workspace dedicado e verificar caminhos efetivos. O fluxo observado exige leitura do artefato e leitura por `path` de cada arquivo a atualizar; negar `force` e `overwrite_unread`. Não tratar o `success` global do CLI como sucesso de publicação.
- [ ] Registrar hook síncrono de pré-execução com falha bloqueante comprovada; executar somente código do runner protegido fora da pasta gravável. Antes de cada efeito externo, traduzir a operação observada para `ClaudeDesignEffectRequest` e revalidar autoridade atual pelo IPC autenticado do runner/backend (flag, vínculo/revisão, conta e trabalho); testar backend indisponível e revogação no meio da execução. Capacidade do IPC nunca vem do modelo nem de um arquivo gravável. Resposta só autoriza a chamada correlacionada/na sequência atual. Se o CLI não oferece barreira bloqueante para a combinação, retornar `unsupported` antes de gerar.
- [ ] Implementar o perfil `mode: "recover"` somente com as leituras de referência comprovadas na tarefa 1. Ele não admite create/publish nem fontes arbitrárias e não reutiliza a sessão de execução original. Qualquer tentativa de escrita é negada antes do efeito.
- [ ] Rodar os dois testes; esperado: PASS. Registrar no journal somente dados sanitizados e fontes permitidas, nunca credenciais ou stream bruto.
- [ ] Commit sugerido: `feat(runner): add guarded Claude Design adapter`.

### Task 5: Integrar contas, ciclo de tarefa e checkpoints

**Files:** Modify `apps/server/runner/{tasks,supervisor,worker}.ts`, `packages/engine/src/{machine-tasks,machine-hub}.ts`; Test `apps/server/test/runner/claude-design-task.test.ts`, testes existentes de supervisor/contas; Create `packages/engine/test/claude-design-task.test.ts`.

**Interfaces:** Variante `task.start` da tarefa 2 usa `executor: "claude"`; `task.status`, `task.cancel` e acknowledgements existentes retornam o resultado estruturado. Novo `startClaudeDesignTask(deps, authority: AuthorizedClaudeDesign, jobId: string): Promise<void>` no serviço da tarefa 6 será o único despachante público dessa variante.

- [ ] Escrever testes de conta explícita e empréstimo correto no worker, sem trocar a conta do brain nem cancelar uma sessão principal válida. Conta perdida ou revogada impede spawn e encerra a execução dedicada.
- [ ] Escrever testes de protocolo antigo, versão de CLI não validada, limites de concorrência/tempo e flag desligado. Assertar que nenhum executável é iniciado em recusas.
- [ ] Escrever testes de reinício do runner e reconexão: a mesma taskId devolve estado conhecido; `task.done` repetido atualiza ledger uma vez. Excluir a variante de Design da retomada genérica que reapresenta prompts.
- [ ] Rodar `bun test apps/server/test/runner/claude-design-task.test.ts packages/engine/test/claude-design-task.test.ts` e confirmar falhas.
- [ ] Encaminhar a variante ao manager dedicado e preservar conta, escopo, limites, journal e cancelamento no supervisor/worker. Acrescentar o vínculo Design aos empréstimos autorizados do worker, usando o mecanismo existente de contas adicionais; não trocar a conta principal. Persistir resultados publicados no journal antes de emitir frames quando possível; reconhecer explicitamente a janela entre efeito remoto e checkpoint.
- [ ] Estender status e `task.done` com `claudeDesign`; validar task/job/conta/agente/organização e propósito (execução/recuperação) antes de persistir e dar ack. Um trabalho mantém taskId original estável e recoveryTaskId separado quando necessário; respostas são aceitas somente do vínculo correspondente. Resultado que não corresponda à tarefa é recusado; não confiar em jobId vindo sozinho do runner.
- [ ] No hub, tratar `design.authorize` derivando organização/máquina da conexão, verificando task/conta/job/concessão vivos e devolvendo `design.authorized` correlacionado. Testar tentativa por outra máquina, replay de sequência e concessão revogada; o autorizador apenas decide, não publica e não cria cartões.
- [ ] Reutilizar registro de uso em plano e limites existentes; um replay de frame não duplica uso. Sucesso externo seguido de erro local preserva o checkpoint publicado.
- [ ] Rodar os novos testes e regressões direcionadas de tasks/supervisor/contas; esperado: PASS, perfil `chat` e tarefas genéricas preservados.
- [ ] Commit sugerido: `feat(design): integrate dedicated task lifecycle`.

### Task 6: Expor ferramentas e habilitação pelo gateway/API

**Files:** Create `packages/engine/src/claude-design/{service,tools}.ts`, `apps/server/src/routes/app/claude-design.ts`; Modify `apps/server/src/{engine,app}.ts`, `packages/engine/src/index.ts`, `packages/engine/src/tools/{scopes,run-policy}.ts`, diretório de ferramentas e classificação de auditoria; Test `packages/engine/test/claude-design-tools.test.ts`, `apps/server/test/claude-design.test.ts`.

**Interfaces:** `createClaudeDesignToolSource(deps): ToolSource`; ferramentas `create_claude_design({title, brief, source_artifact_ids?})`, `update_claude_design({design_id, expected_revision, brief, source_artifact_ids?})`, `get_claude_design_job({job_id})`. O código traduz esses inputs para `DesignInput`; usuário/modelo não fornecem conta, comando, ambiente ou URL. Serviço exporta `startClaudeDesignTask` da tarefa 5; API sob `/api/app/organizations/{orgId}/claude-design`: `PUT /agents/{agentId}/grant` com `{accountId: string | null}`, `GET /agents/{agentId}/grant`, `GET /jobs/{jobId}`, `POST /jobs/{jobId}/cancel`.

- [ ] Escrever testes com provider fake para um agente API e para Lodi pelo MCP existente. Ambos chamam a ferramenta do app; o `init` do brain principal continua sem ferramentas Artifact.
- [ ] Testar níveis `always/default/never` pelo gateway real e política de autoridade. Aprovação recusada, ausência de escopo, rotina/widget, conta de terceiro e DM errada resultam em zero despachos. `never` dispensa cartão, mas não concessão/autorização.
- [ ] Testar payload extra que tenta injetar accountId/cwd/env/URL, anexos não visíveis e escopo revogado entre aprovação e execução. Revalidar também dentro da tarefa imediatamente antes de cada efeito autorizado.
- [ ] Rodar os dois arquivos de teste e confirmar falhas.
- [ ] Implementar fonte e serviço, registrar no engine/diretório e tratar criação/atualização como escrita externa para a política existente. A aprovação cobre inputs exatos e revisão da concessão; o gateway continua sendo a fonte da identidade/autoridade.
- [ ] Implementar rotas com sessão, CSRF, schemas OpenAPI e verificações de organização/proprietário. Consulta e cancelamento não podem revelar existência de trabalho de outra conversa/organização.
- [ ] Usar canal/conversa existentes para o retorno assíncrono e contabilização; resposta inicial é `job_id` e estado. Desligar o flag bloqueia novos despachos e solicita cancelamento dos ativos, sem apagar resultados.
- [ ] Rodar testes e typecheck dos pacotes engine/server; esperado: PASS.
- [ ] Commit sugerido: `feat(design): expose authorized design tools`.

### Task 7: Entregar arquivos e reconciliar resultados incertos

**Files:** Create `packages/engine/src/claude-design/files.ts`; Modify `claude-design/{ledger,service}.ts`, `packages/engine/src/jobs.ts` e registro de handlers/outbox existente; Test `packages/engine/test/claude-design-results.test.ts`, `packages/engine/test/claude-design-recovery.test.ts`.

**Interfaces:** `storeClaudeDesignFiles(deps, jobId: string, result: ClaudeDesignResult): Promise<{ artifactIds: string[] }>`; `reconcileClaudeDesignJob(deps, jobId: string): Promise<DesignJobView>`; `recoverClaudeDesignJob(deps, actorUserId: string, orgId: string, jobId: string, remoteUrl: string): Promise<DesignJobView>`. Reconciliar usa taskId estável e `task.status`; não chama create/update remotamente. Recuperar é exclusivo do proprietário e inicia nova tarefa `mode: "recover"` ligada ao mesmo job; revalida acesso atual e recusa referência/host não reconhecido, outro alvo em updates ou falta de prova de propriedade. Fonte só é lida de caminho relativo ao workspace da tarefa validada, com realpath, tamanho/hash e lista recebida do adaptador.

- [ ] Escrever testes de criação com referência + arquivos e atualização mantendo identidade remota. Revisão local avança uma vez por publicação confirmada; versão remota permanece opaca. Conflito esperado não sobrescreve resultado atual.
- [ ] Testar publicação confirmada seguida de falha no storage: estado `published`, erro `sources_incomplete`, referência preservada; repetir somente a importação dos arquivos não republica. Artefatos locais têm audiência da DM e seguem limites de storage.
- [ ] Testar queda após efeito sem identidade recuperável: `unknown`, nenhuma repetição automática e mensagem localizada que explica a incerteza. Outra chamada/run não contorna o bloqueio durável do design. Cancelamento depois da publicação preserva referência; cancelamento antes do spawn não publica.
- [ ] Testar recuperação exclusiva do dono, referência falsa/conta errada, alvo de update diferente e sucesso somente de leitura. Adicionar `POST /jobs/{jobId}/recovery` com `{remoteUrl: string, confirmAssociation: true}` nas rotas da tarefa 6; esse campo não aparece em ferramentas dos modelos. Associação manual de criação é auditada como `owner_association`, sem atribuir causalidade não comprovada. Recuperação falha mantém `unknown`; confirmação válida permite `unknown → published → succeeded` e só então libera o bloqueio após as fontes estarem consistentes.
- [ ] Testar frames atrasados/duplicados, taskId de outro job, conta revogada, versão externa mais recente e duas atualizações disputando a mesma revisão.
- [ ] Rodar os dois testes e confirmar falhas; implementar persistência idempotente, trava por design e reconciliador. Reaproveitar outbox/notificações do app, sem fila externa ou loop de retry infinito.
- [ ] Importar arquivos como artefatos existentes; não criar iframe do Claude ou executar fonte em origem confiável. Documento/arquivo de resultado deve mencionar que abrir no Claude exige acesso naquela conta.
- [ ] Oferecer geração HTML local pelo fluxo já existente apenas como alternativa explícita. Não rotular o resultado como Claude Design e não prometer importação; depois de efeito remoto incerto, não iniciar fallback sozinho.
- [ ] Rodar novos testes e regressões de audiência/artefatos/contabilização; esperado: PASS.
- [ ] Commit sugerido: `feat(design): persist results and reconcile interrupted work`.

### Task 8: Habilitar o piloto e fechar a verificação

**Files:** Create `packages/client/src/lib/claude-design.ts`, `apps/web/src/components/ai/ClaudeDesignGrant.tsx`, `apps/mobile/src/features/ai/ClaudeDesignGrant.tsx`; Modify `AiAccounts.tsx`, `AiAccountsScreen.tsx` e traduções; Create testes direcionados de client/web/mobile; Create novo ADR proposto em `docs/adr/` e atualizar documentação de configuração.

**Interfaces:** Client `getClaudeDesignGrant(orgId, agentId)`, `setClaudeDesignGrant(orgId, agentId, accountId: string | null)`, `getClaudeDesignJob(orgId, jobId)`, `cancelClaudeDesignJob(orgId, jobId)`, `recoverClaudeDesignJob(orgId, jobId, remoteUrl: string, confirmAssociation: true)`, retornando os schemas públicos definidos nas tarefas 3/6/7. Controles de habilitação e recuperação usam design system e componentes de conta/trabalho existentes.

- [ ] Testar controles visíveis apenas ao proprietário com permissão de administrar o agente, estados desligado/incompatível/habilitado/reconectar, habilitação por agente e revogação. A disponibilidade mostrada reflete o backend, não a presença de um plano Max no rótulo.
- [ ] Testar retorno inicial e conclusão em conversa, erro sanitizado, fontes incompletas e resultado incerto, usando UI existente. Só o proprietário vê a ação de fornecer referência para recuperação, com confirmação de associação manual e erro que preserva o bloqueio quando não verificada. Não colocar variável experimental, comandos CLI ou detalhes do hook no fluxo normal do usuário.
- [ ] Rodar os testes novos em processos separados para web/mobile/backend conforme `CONTRIBUTING.md` e confirmar falhas; implementar controles e textos em inglês/português nos catálogos existentes.
- [ ] Registrar ADR com status proposto/aceito conforme aprovação efetiva. Descrever dependência experimental, combinações validadas, comportamento de revogação, uso da assinatura e rollback pelo flag; atualizar `CLAUDE.md` apenas com mapa e referência ao ADR final.
- [ ] Executar testes direcionados de todas as tarefas, `bun run lint`, `bun run typecheck`, `bun run check:boundaries`, `bun run check:migrations` e `bun run build`. Executar checks adicionais exigidos por `CONTRIBUTING.md` para arquivos alterados. Registrar resultados reais, inclusive bloqueios externos; nunca marcar teste autenticado como coberto por fixture.
- [ ] Fazer smoke autenticado explícito apenas nas combinações aprovadas da tarefa 1: criar, atualizar, cancelar e recuperar a mesma tarefa. O CI comum permanece sem credenciais. Verificar os critérios de aceitação da spec e desligar o piloto se um contrato falhar.
- [ ] Commit sugerido: `feat(design): add experimental account controls and rollout docs`.

## Handoff e execução

Este é um único incremento com oito tarefas dependentes. Recomenda-se execução inline com `superpowers:executing-plans`, porque runner, contratos e ledger compartilham estado e precisam preservar as mesmas decisões; reservar revisão independente para a barreira anterior aos efeitos e o diff completo. Uma implementação não deve abrir tarefas de UI enquanto a fase A estiver inconclusiva.

Antes de executar: revisar desenho/plano, confirmar o escopo proposto do piloto e autorizar o experimento com a conta escolhida. O pedido atual foi de planejamento; nenhuma conta deve ser consumida nem design publicado durante sua preparação.
