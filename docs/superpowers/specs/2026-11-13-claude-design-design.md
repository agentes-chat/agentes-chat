# Claude Design por uma ferramenta do agentes.chat

Estado: execução Native aprovada pelo usuário em 2026-11-13. O usuário selecionou a conta Max local e autorizou a segunda conta por um segundo perfil isolado de validação. O smoke posterior do manager de produção encontrou um requisito nativo de consentimento interativo incompatível com o callback headless. Tasks 1–7 implementadas experimentalmente; controles da Task 8 e qualificação stdio concluídos na continuação. A admissão do piloto em produção permanece fechada. Nenhuma combinação foi admitida para produção; ver ADR 0186 e relatório de pesquisa.

## Intenção

Permitir que um agente crie ou atualize um Claude Design por uma ferramenta do agentes.chat, usando uma conta Claude explicitamente vinculada. A IA que conversa com a pessoa pode ser de qualquer provedor. O trabalho de design é uma execução separada de Claude Code e retorna uma referência verificável ao artefato e os arquivos produzidos.

O pedido desta etapa é estruturar o plano. Nenhum comportamento do produto será alterado nesta etapa.

## Evidência e limites do conhecimento

- O usuário trouxe um experimento realizado por Claude: CLI 2.1.322, login claude.ai, plano Max; criação privada por `-p` e `stream-json` com `CLAUDE_CODE_ARTIFACT=1`. Não foi reproduzido nesta investigação.
- A documentação oficial informa que artefatos estão desligados por padrão em `-p` e exigem autenticação claude.ai. O mecanismo de ativação acima não é uma interface pública documentada.
- A documentação descreve publicações sem prompt. `--permission-prompt-tool` não constitui uma autorização obrigatória para cada operação de `Artifact`.
- O app inicia seus brains com ferramentas limitadas e MCP próprio. `Artifact`, `ArtifactComments`, `ArtifactData` e `DesignSync` estão explicitamente negados no perfil `chat`.
- O fluxo real de contas do app inclui `setup-token`, empréstimo de credenciais a workers e isolamento por usuário. O sucesso em um terminal pessoal não demonstra sucesso nesses fluxos.
- Não foi confirmada uma API ou um MCP público de Claude Design que resolva esta integração.

Referências consultadas em 2026-11-13:

- [Artefatos no Claude Code](https://code.claude.com/docs/en/artifacts), especialmente disponibilidade, publicação e atualização.
- [Hooks](https://code.claude.com/docs/en/hooks), especialmente `PreToolUse` e comportamento em falhas.
- [Execução programática](https://code.claude.com/docs/en/headless).
- [Variáveis de ambiente](https://code.claude.com/docs/en/env-vars).

## Abordagens consideradas

| Abordagem | Consequência | Decisão proposta |
| --- | --- | --- |
| Habilitar Artifact na sessão principal | Amplia a autoridade da sessão; conflita com o bloqueio do Lodi e mistura contas e ferramentas | Descartar |
| Conectar diretamente a um MCP do Design | Reutilizaria conectores existentes, mas não há interface pública confirmada | Não assumir disponibilidade |
| Ferramenta própria com execução dedicada de Claude Code | Reutiliza gateway, contas, tarefas e artefatos; encapsula a dependência experimental | Recomendada |

A recomendação foi apresentada na conversa; as escolhas abaixo são propostas do plano, não preferências já confirmadas pelo usuário.

## Escopo do primeiro incremento

Criar e atualizar designs, acompanhar estado e cancelar trabalho; guardar referência remota e arquivos-fonte como arquivos privados da conversa. Disponibilizar a ferramenta a Lodi e aos demais agentes por concessão explícita, sem mudar as ferramentas nativas de seus brains.

Para reduzir a primeira entrega, propõe-se habilitar o piloto somente em DM da pessoa proprietária da conta, mediante vínculo por agente. Rotinas, canais compartilhados e uso por outras pessoas ficam para um incremento posterior com regras de compartilhamento próprias. Essa é uma decisão proposta de escopo, não uma restrição já pedida pelo usuário.

Não fazem parte: editor próprio, iframe autenticado do Claude, exportação programática a PDF/PPTX/PNG, comentários, ArtifactData, DesignSync, alteração de compartilhamento, exclusão remota, nova forma de login ou automação do navegador. O fallback reutiliza os artefatos HTML locais existentes e é uma escolha explícita; nunca se apresenta como Claude Design nem promete importação para o Claude.

## Restrições globais

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

## Fase A: experimento que decide a viabilidade

Implementação do produto depende da aprovação do desenho e deste resultado. O experimento é descartável; não altera brains nem contas existentes e roda por comando explícito com conta de teste escolhida pela pessoa.

É preciso demonstrar:

1. Criação privada e atualização do mesmo design com `-p`, `stream-json` e permissões restritas.
2. Funcionamento com o método de autenticação que o app realmente oferece naquele modo de runner. `setup-token` só é suportado se testado; login interativo existente só é suportado se testado. Se nenhum método existente funcionar, parar e propor um plano separado de autenticação.
3. Uma barreira anterior à execução de cada ferramenta. A candidata é um hook `PreToolUse` controlado pelo runner, carregado apenas na sessão dedicada. Provar também bloqueio em timeout, processo ausente, saída inválida e indisponibilidade do autorizador. Um evento posterior ou texto do prompt não servem como barreira.
4. Bloqueio de outro artefato, exclusão, listagem da conta, compartilhamento, conectores em runtime e operações desconhecidas. Confirmar os nomes e esquemas reais das operações; não inventar verbos de `Artifact`.
5. Leituras e escritas confinadas à pasta de trabalho, inclusive caminhos simbólicos, referências `@`, publicação com leitura interna de arquivos e edição embutida na publicação. Desativar edição embutida por `CLAUDE_CODE_ARTIFACT_PUBLISH_EDITS=0`, se respeitada nessa versão, e demonstrar o resultado.
6. Separação de duas contas no modo real de execução, incluindo Keychain no macOS e empréstimo aos workers no modo system. Publicação e leitura proibida na conta errada são medidas independentes do conteúdo do `init`.
7. Captura dos resultados reais de ferramenta, identificadores e versão; retomada sem repetir uma publicação de resultado desconhecido.
8. Tratamento de versão obsoleta na atualização. Se o provedor não fornecer um mecanismo confiável de conflito concorrente, a atualização não pode ser habilitada nesse incremento.

O relatório usa `verified`, `failed` e `not_tested` por versão, sistema operacional, modo de runner e método de autenticação. Uma combinação `not_tested` não é disponibilizada. O experimento exige conta autorizada para consumo; CI comum só reproduz transcrições sanitizadas. Também se registra se há um caminho permitido e suportado pelo fornecedor para oferecer a função no app; a ausência de interface pública não pode ser convertida em promessa comercial.

Se qualquer requisito essencial falhar, a fase de produto fica bloqueada para a combinação afetada. Entregar a conclusão e o fallback local; não contornar o problema relaxando permissões ou copiando cookies.

## Arquitetura proposta

### Entrada e autoridade

Ferramentas públicas `create_claude_design`, `update_claude_design` e `get_claude_design_job`, em uma fonte própria. Criação/atualização usam o escopo `claude-design:write`; consulta usa `claude-design:read`. O gateway aplica os níveis de aprovação existentes, inclusive `always` e `never`; não criar um segundo sistema de confirmação.

O modelo fornece briefing, título e, para atualizar, um identificador local do design. Ele não escolhe conta, computador, URL remota, ambiente, comando ou caminhos. O backend resolve tudo pelo vínculo autorizado do agente e revalida o proprietário da DM, a conta e os escopos imediatamente antes do despacho.

Uma aprovação cobre uma criação de um design, ou uma atualização de um design conhecido na versão esperada, com os anexos explicitamente fornecidos. Briefings e fontes importadas são dados, não instruções para ampliar essa autorização. A sessão dedicada não recebe histórico completo, outros conectores nem ferramentas MCP do workspace.

### Persistência

Novo módulo `packages/engine/src/claude-design/` e schema `packages/db/src/schema/claude-design.ts`:

- `claude_design_grants`: organização, agente, conta, computador, proprietário, habilitado e revisão. Um vínculo ativo por agente. Apenas o dono da conta que pode administrar o agente concede/revoga; concessão revogada invalida trabalhos ainda não iniciados e cancela os ativos.
- `claude_design_jobs`: identidade, run/conversa/pessoa, vínculo/revisão, ação, briefing/anexos, design-alvo e versão esperada, chave de idempotência, tarefa, estado, resultado e erro sanitizado. Briefing/anexos seguem a retenção e a audiência da conversa.
- `claude_design_artifacts`: identidade local, organização, agente/proprietário, conta/computador, conversa, identidade/URL remotas, versão remota opaca, revisão local, referências aos arquivos do Drive e trabalho da última publicação. Remoção de conta marca a referência indisponível; não apaga o artefato remoto.

Índices únicos: `(org_id, agent_id)` em concessões; `(org_id, run_id, tool_use_id)` em trabalhos; `(org_id, account_id, remote_id)` em designs. Campos repetidos de organização são verificados nas operações e por referências compostas quando cabíveis. Não transformar preço equivalente relatado pelo CLI em cobrança adicional.

Estados de trabalho: `queued`, `running`, `published`, `succeeded`, `failed`, `canceled`, `unknown`. `published` significa confirmação remota recebida, mas persistência de fontes pode estar pendente. `unknown` significa que houve interrupção e não se pode afirmar se ocorreu publicação. Não há promessa de exatamente uma publicação entre app e provedor.

### Execução e protocolo

Reutilizar `task.start` com `executor: "claude"` e novo campo opcional `claudeDesign`; não criar um executor genérico novo. Introduzir `CLAUDE_DESIGN_PROTOCOL` usando o próximo número disponível na implementação e verificar capacidade antes de despachar. Pedidos desse tipo sempre exigem `account` explícito, não aceitam comando shell, missão nem uma sessão de brain.

A tarefa usa o ciclo existente de limites, cancelamento, journal e acknowledgements. O runner encaminha apenas essa variante a `runner/claude-design/manager.ts`. Supervisor e workers concedem a conta designada sem mudar a conta do brain principal. O campo dedicado e as ferramentas não podem ser ativados por conteúdo do prompt.

O adaptador fixa ambiente, lista mínima de ferramentas e hook de autorização verificado na fase A. Configuração e estado da barreira ficam fora da pasta gravável pelo modelo. A barreira vincula cada chamada ao trabalho e ao alvo autorizado. Ela limita também número de publicações: uma criação seguida de preenchimento/publicação do seu próprio resultado, ou uma nova versão do alvo na atualização, conforme a sequência exata comprovada no experimento.

Antes de cada efeito externo, a barreira consulta a autoridade atual por IPC autenticado do runner e a conexão existente ao backend: flag, vínculo/revisão, pessoa, conta e estado do trabalho. Uma concessão antiga aprovada não dispensa essa revalidação; backend indisponível bloqueia a chamada. A capacidade do IPC é entregue pelo runner fora do prompt e dos arquivos graváveis. Trata-se de uma verificação determinística, não de uma nova decisão por modelo ou um novo cartão de aprovação.

O protocolo inclui pedido interno `design.authorize` do runner para o backend e resposta correlacionada `design.authorized`. O servidor deriva máquina e organização da conexão autenticada e verifica task/job/conta/revisão; IDs declarados no corpo não concedem autoridade. Cada pedido tem identidade única e sequência; concessões não são reutilizadas entre chamadas. A decisão vale para aquela chamada imediatamente seguinte; cancelamento não desfaz efeito que já foi autorizado/iniciado.

Eventos e journal registram checkpoints sanitizados de criação/publicação assim que observados. `task.done` e a consulta de estado carregam o mesmo resultado estruturado e limitado; texto livre que contenha uma URL nunca basta para marcar sucesso. Reentrega de frames é idempotente. Uma falha de transporte não inicia outro `task.start` com novo identificador.

### Atualização, revogação e recuperação

Atualizações usam identificador local e revisão esperada; uma trava por design serializa os trabalhos do app. Conflitos com edições externas dependem do controle de versão do provedor comprovado na fase A. Trocar o vínculo de conta não transfere designs antigos.

A trava é durável e continua ocupada enquanto um trabalho estiver `queued`, `running`, `published` ou `unknown`, inclusive após encerramento do processo. Um resultado desconhecido não pode ser contornado com outra chamada, outro run ou outra chave de idempotência. Confirmação tardia válida pode resolver `unknown → published → succeeded`; estados conclusivos não regridem.

Cancelamento e revogação encerram a execução pelo mecanismo existente, mas não desfazem uma publicação que já ocorreu. Se há confirmação remota, preservá-la com indicação de fontes incompletas; se não há certeza, marcar `unknown`. O reconciliador consulta journal/estado da mesma tarefa e pode finalizar um resultado já confirmado. Nunca reapresenta automaticamente um pedido cujo efeito remoto é desconhecido. Sem identidade recuperável, a pessoa precisa recuperar a referência no Claude antes de qualquer nova tentativa.

Para isso, há uma recuperação exclusiva do proprietário: ele fornece a referência pela API/controle de trabalho, e o backend inicia uma tarefa dedicada somente de leitura, com nova taskId vinculada ao mesmo trabalho. Não retomar o prompt original. Essa tarefa verifica conta/propriedade do artefato, identidade e versão; uma atualização só pode recuperar seu alvo original. Para criação, a associação manual exige confirmação explícita da pessoa e é auditada como associação pelo proprietário, não como prova de que o processo original criou aquele artefato. Não tornar URLs fornecidas pelo modelo uma entrada equivalente. Referência inválida, conta revogada, método de leitura não comprovado ou recuperação inconclusiva mantêm `unknown` e o bloqueio. Recuperação também entra no experimento da fase A.

### Resultado e experiência mínima

Retornar imediatamente `job_id` e estado; usar notificações/outbox existentes para a conclusão. O resultado final informa título, estado, referência externa e arquivos locais. Abrir o editor externo exige o acesso da pessoa no Claude; permissões do agentes.chat não concedem acesso no serviço externo.

As fontes são importadas pelos mecanismos existentes de arquivo/armazenamento, com limites, audiência e origem não confiável. Não servir HTML gerado na origem do app. Na primeira entrega não há novo tipo visual de artefato: arquivo/relatório existente com os resultados e link textual são suficientes.

Se a publicação falhar antes de qualquer efeito externo, retornar indisponibilidade e oferecer o fluxo HTML local existente. Depois de um efeito possível ou confirmado, não iniciar fallback automaticamente: informar o estado e preservar o que foi recuperado.

### Habilitação

O flag da instância é necessário e não concede acesso por si. O dono da conta habilita o recurso para um agente em Contas de IA, por um controle pequeno web/mobile com as mesmas permissões do backend. A conta do Design é independente do modelo de conversa. O painel distingue indisponível, experimental habilitado e reconexão necessária, com texto localizado.

## Critérios de aceitação

- Um agente API e Lodi conseguem solicitar o mesmo fluxo autorizado, sem novas ferramentas nativas em seus brains.
- Conta, versão, sistema operacional e método de login não validados são recusados antes de consumir a conta.
- Aprovação recusada, escopo ausente, conta de terceiro ou DM diferente não iniciam processo.
- Publicar em outro artefato, ler credenciais e modificar a barreira são bloqueados antes do efeito.
- Criação produz referência verificável; atualização mantém identidade e incrementa a revisão local após confirmação remota.
- Timeout, cancelamento, frames duplicados e queda após publicação não duplicam trabalho nem afirmam sucesso sem evidência.
- Usuário sem acesso à conversa não consegue consultar resultados ou baixar fontes.
- Desligar o flag impede novos despachos e cancela os ativos; referências e arquivos já criados permanecem acessíveis conforme suas permissões.

## Evidência inicial da fase A

O [relatório local](../research/2026-11-13-claude-design.md) registra criação privada, publicação de fontes preparadas, atualização e conflito entre sessões com CLI 2.1.322. O spike autoriza iniciar a implementação apenas da combinação local delimitada; a liberação do produto ainda depende das Tasks 4–8. O adaptador terá de permitir Read de fontes delimitadas, fixar o scratchpad com `CLAUDE_CODE_TMPDIR`, ler cada arquivo remoto alterado e negar `force`/`overwrite_unread`. O resultado global `success` do CLI não é prova de sucesso de Artifact.

## Decisões deixadas à implementação

Próximo número de protocolo/migração/ADR, nomes exatos dos campos de banco conforme Drizzle, integração do controle nas telas existentes e biblioteca já instalada para compactar fontes. Esquemas de Artifact, ferramentas mínimas e mecanismo de bloqueio são decididos pela evidência da fase A, nunca por suposição.
