# Claude Design: evidência do experimento local

Data: 2026-11-13. Escopo: Task 1 do [plano](../plans/2026-11-13-claude-design.md). Estado: spike local concluído para iniciar a implementação experimental. **Produto ainda não liberado**; validar o runner integrado nas Tasks 4–8.

## Ambiente e autorização

- Bun 1.4.4; macOS arm64, mesmo usuário do Claude Code local.
- CLI candidato 2.1.322, executado a partir de uma versão nativa já instalada. O CLI principal 2.1.323 não foi alterado.
- O usuário escolheu explicitamente sua conta Max local e depois indicou uma segunda conta Team por seu comando de shell. A resolução do comando ficou somente no ledger privado; nenhuma identidade/credencial é pública. Comparação em memória confirmou emails e organizações distintos.
- `auth status` confirmou `loggedIn: true`, `authMethod: claude.ai`, `apiProvider: firstParty`, `subscriptionType: max`. Não registrar identidade ou credenciais.
- Execução direta local; não é evidência do supervisor, usuário de conta compartilhada, `setup-token` ou worker Linux.

`verified` significa observado nesta combinação e no cenário descrito. `not_tested` nunca equivale a compatibilidade presumida.

## Resultado do smoke do adaptador de produção

**Piloto bloqueado.** O teste posterior com o manager de produção, CLI 2.1.322, conta de teste explicitamente selecionada e as duas barreiras de autorização não concluiu criação/preenchimento/atualização/recuperação. A criação de um shell privado funcionou; a leitura seguinte exigiu um disclosure interativo que o `permission-prompt-tool` não consegue apresentar. Uma nova sessão somente de leitura recebeu a mesma recusa. O app normaliza isso como `interactive_consent_required` e preserva a referência confirmada, sem nova publicação.

A matriz abaixo descreve o spike anterior; seus resultados de leitura/publicação não bastam para admitir a combinação com a barreira final do app. Não há combinação de produção aprovada. O código de composição exige também `CLAUDE_DESIGN_PILOT_READY`, atualmente falso; ligar somente a variável experimental continua sem habilitar novas concessões ou efeitos remotos.

O smoke também encontrou dois detalhes reais de protocolo: a publicação informa a versão opaca no cabeçalho inline e o callback nativo de permissão acrescenta campos internos após o hook. Ambos têm regressões sintéticas sanitizadas. Arquivos locais gerados antes da publicação nunca contam como fontes de um shell vazio.

A autenticação do perfil Max padrão funcionou sem executar modelo, mas definir sua pasta padrão explicitamente através do ambiente isolado não encontrou o login. A pasta da conta de teste funcionou. Não se copiou nem alterou credenciais; autenticação isolada do Max permanece pendente.

As etapas 1–6 têm implementação experimental; a etapa 7 permanece parcial e a interface da etapa 8 não foi iniciada. Recuperação com fontes consistentes e prova nativa de propriedade ainda exige validação real. Os testes comuns usam apenas fakes e PGlite. O fluxo existente de HTML local continua sendo uma alternativa que a pessoa deve pedir explicitamente; não é Claude Design nem uma promessa de importação.

## Matriz

| Requisito | Resultado | Evidência / limite |
| --- | --- | --- |
| Inspeção sem chamada de modelo | verified | Probe só executa versão e status; teste de fronteira impede `-p` nesse modo |
| Opt-in de execução e conta | verified | Sem seleção explícita de conta ou `--execute`, não inicia cenário de modelo |
| Artifact em `-p` | verified | `init.tools` inclui Artifact com o flag experimental, strict MCP e fontes de settings vazias |
| Descoberta sem publicação | verified | Hook negou quickstart e a recusa apareceu como tool_result de erro |
| Quickstart Design | verified | Resultado forneceu referência do tipo Design; nenhum design criado nessa chamada |
| Criação privada do artefato | verified | Resultado de ferramenta confirmou criação de um único artefato privado, versão opaca |
| Publicar arquivos-fonte preparados | verified | Publicação do índice e de um artboard sintético criou a versão 2 |
| Atualizar o mesmo artefato | verified | Leitura explícita do arquivo e publicação criaram versão 3; uma segunda atualização criou versão 4 |
| Conflito entre duas sessões na mesma conta | verified | A leu arquivo da versão 3; B publicou versão 4; A tentou enviar sua cópia e recebeu recusa de alteração concorrente, sem `force`. Após corrigir o harness, repetiu-se com versão 4→5 e resultado de publicação correlacionado confirmado |
| Hook nega publicação Artifact | verified | Uma tentativa de publicação foi recusada por PreToolUse antes da ferramenta; não contou como publicação bem-sucedida |
| Hook ausente / erro / saída inválida / timeout | verified, Write e Artifact | As quatro falhas foram repetidas em tentativas reais de publicação Artifact; cada resultado apontou bloqueio de PreToolUse por `onFailure: block`, sem publicação confirmada |
| Caminhos temporários e symlink de fonte | verified, teste local | Hook permite o arquivo preparado e recusa symlink para fora. Canonicalização trata o alias macOS de diretórios temporários |
| Pasta de conta vazia não herda login | verified, caso negativo | Com `accountEnv` existente do runner, status retornou `loggedIn: false`, `authMethod: none` |
| Leitura de referência e versão pela mesma conta | verified | Artifact read retornou arquivo, hash, versão e informação de propriedade; não demonstra rejeição de outra conta |
| Scratchpad interno na pasta do trabalho | verified, leitura local | Com `CLAUDE_CODE_TMPDIR`, a fonte salva por Artifact read ficou sob `work/.cli`; não prova confinamento de todos os caminhos internos |
| Duas contas reais por diretório | verified, CLI local | Identidades distintas; cada conta criou/publicou seu próprio design; leitura própria funciona e leituras cruzadas não retornam conteúdo |
| Leituras cruzadas além do consentimento do CLI | not_tested, backend isolado | Nos dois sentidos, CLI exige disclosure interativo e recusa encaminhar pelo permission-prompt-tool. Não se afirmou recusa HTTP de autorização pelo backend |
| Login `setup-token` | not_tested, indisponível no primeiro suporte | O candidato inicial fica em `cli_login`; não gerar/extrair tokens nem ampliar para esse método |
| Modo system / empréstimo de conta / workers | not_tested, indisponível no primeiro suporte | Candidato inicial é runner user no mesmo usuário macOS arm64; outras combinações serão recusadas |
| Interrupção após confirmação de publicação e recuperação da referência | verified, spike CLI | Processo encerrado antes do result final; evidência privada preservou a confirmação, e nova leitura recuperou exatamente a mesma versão, sem create/retry |
| Journal/DB e reconciliação no app | pendente de implementação | Propriedades do produto permanecem testes obrigatórios das Tasks 5/7, sem extrapolar o spike CLI |
| Listagem / exclusão / publicação por symlink | verified, CLI | Três chamadas reais negadas antes do efeito; Write fora do workspace foi recusado e marcador preservado; Read externo/symlink foi negado |
| Capabilities herdadas e conectores do editor externo | inspeção parcial | Tipo Design declara capabilities próprias; negar overrides/conectores no adaptador e não prometer controle do editor do fornecedor |
| Permissões de managed settings / outras plataformas / outras versões | not_tested | Não extrapolar a partir do login local |

Os arquivos do design de teste são sintéticos, preparados pelo probe para testar o transporte/publicação; não se avaliou geração visual autônoma nem qualidade de renderização.

## Contratos observados que mudam o adaptador

1. Quickstart usa `{action: "quickstart", intent: "design"}`. Publicação pode omitir `action`, cujo comportamento observado é publicar. Normalizar a ausência somente nesse schema/versionamento, sem tratar uma operação desconhecida como publicação.
2. Criação usa `type_url`, `title` e `auto_open: "after_first_write"`, sem arquivos. A referência do tipo veio do resultado de quickstart, nunca de uma URL inventada pelo modelo.
3. Conteúdo de Design vive em arquivos sob `project/`: índice `canvas.json` v3 e artboard `.dc.html`. O experimento publicou somente arquivos do seu próprio diretório de trabalho.
4. Publicar lê arquivos internamente. Narrowing que deixa apenas Artifact faz a publicação falhar porque Read foi negado. O cenário bem-sucedido usou `Artifact,Read`, com hook restringindo Read aos arquivos preparados.
5. Uma sessão nova precisa ler o artefato para estabelecer versão. Para atualizar um arquivo já publicado, precisa também lê-lo explicitamente com seu `path`; ler apenas metadados do artefato não estabelece o hash do arquivo.
6. O provedor mantém controle de versão/conteúdo por arquivo. A recusa concorrente foi observada depois de ambas as sessões lerem o mesmo conteúdo e uma delas publicar uma alteração real. Negar sempre `force` e `overwrite_unread` no adaptador proposto.
7. O resultado global do CLI pode dizer `success` mesmo quando um tool_result de Artifact é erro. Também se observou o modelo tentar publicar depois de uma leitura recusada. Sucesso e ordem de operações precisam vir do ledger de resultados confirmados, não da resposta final ou da intenção expressa no prompt.
8. `PreToolUse` com `onFailure: "block"` existe e bloqueou falhas reais nessa versão. Uma política do app precisa ainda revalidar concessões e impedir modificação de sua configuração; o probe é descartável e não implementa a autoridade do produto.
9. Artifact read salva fontes no scratchpad interno do CLI. Sem configuração, esse diretório fica fora da pasta de trabalho do probe. O probe passou a definir `CLAUDE_CODE_TMPDIR` dentro da pasta do trabalho; uma leitura posterior confirmou a fonte salva sob `work/.cli`. Outros caminhos internos ainda exigem validação antes de liberar uma combinação.
10. A criação a partir do tipo Design herda capabilities do próprio tipo. Proibir parâmetros arbitrários de capabilities não elimina essas capacidades herdadas. O requisito de impedir conectores em runtime precisa ser validado com o template real; não afirmar que o app controla o serviço externo inteiro.

## Reproduzir

O script é manual, não faz parte do CI e exige um executável candidato exato:

```sh
bun apps/server/scripts/probe-claude-design.ts --account local --claude /caminho/para/claude
bun apps/server/scripts/probe-claude-design.ts --account local --claude /caminho/para/claude --execute --scenario discovery
bun apps/server/scripts/probe-claude-design.ts --account local --claude /caminho/para/claude --execute --scenario quickstart
```

Cada execução imprime um `evidenceDir` local privado. `create-shell` recebe `--from` com o diretório de quickstart; `populate` recebe o da criação; `update`, `read-target`, `deny-publish` e `conflict` recebem um diretório que já esteja vinculado ao artefato criado. O cenário conflict mantém a sessão leitora e intercala uma atualização por outra sessão da mesma conta. Cada execução exige `--execute`; escolher esses cenários pode consumir a assinatura e publicar versões privadas.

Resultados brutos ficam somente em diretórios temporários com permissões restritas, fora do repositório. As fixtures são sintéticas e não incluem URLs, identidades ou versões reais. O probe não transforma saída livre em compatibilidade automática; a matriz acima foi conferida contra os tool_results. Ele registra `publicationEvidence` somente para resultado de Artifact bem-sucedido correlacionado à chamada e ao alvo, com versão retornada. O cenário conflict exige essa confirmação da publicação intermediária antes de tentar o envio obsoleto. Erro do CLI ou recusa de ferramenta deixam o experimento inconclusivo. Um prazo compartilhado cobre os dois processos, e interrupção encerra seus grupos com escalada; isso foi testado offline, não equivale à recuperação durável de produto.

## Consequência para o plano

Prosseguir para implementação mantendo suporte candidato estritamente em macOS arm64, runner user e método `cli_login`, com CLI 2.1.322. O spike comprovou as primitivas locais que o plano exige; testes de grants, journal/DB, worker e integração real são obrigatórios nas tarefas que constroem esses componentes. Não extrapolar para `setup-token`, system/Linux, outras versões ou acesso a artefatos de outra conta. O método permission-prompt-tool não substitui disclosure nativo; classificar essa resposta como `interactive_consent_required`.

Foram deixados dois artefatos privados de teste, um por conta, com arquivos sintéticos. Sua referência está nas evidências locais privadas. Não excluir nem tornar público automaticamente.

## Fontes oficiais usadas para interpretar o experimento

- [Artefatos](https://code.claude.com/docs/en/artifacts): disponibilidade, limitações, leitura e publicação.
- [Hooks](https://code.claude.com/docs/en/hooks): barreira prévia e `onFailure`.
- [Variáveis de ambiente](https://code.claude.com/docs/en/env-vars): diretório temporário interno e seletores de autenticação.

Essas fontes descrevem o produto oficial; o flag experimental que habilitou Artifact em print mode não foi tratado como contrato público suportado.

## Revisão e checks do checkpoint

Revisão independente do probe: nenhum achado crítico; dois importantes corrigidos com testes RED→GREEN: a publicação intermediária precisava de confirmação de tool_result (e não só status do processo wrapper), e interrupção/timeout precisava cobrir todos os CLIs do experimento. Não houve nova revisão do mesmo diff após as correções.

Testes direcionados cobrem inspeção sem consumo, opt-in/seleção de conta, leitura limitada/symlink, falha da atualização intermediária por saída não zero e por tool_result recusado, e interrupção de CLI que ignora SIGTERM. O controle de versão também foi repetido na conta real após a correção do harness. Checks finais e conclusão do spike ficam registrados no ledger de execução. A implementação experimental só poderá ser liberada após os testes de produto e revisão final.

Os cenários adicionais `write-boundary`, `read-boundary`, `deny-actions`, falhas de hook com `--from` e `interrupt-publish` exercitam limites e interrupção. `read-target-approved` conecta somente o permission-prompt-tool de teste, autorizado estritamente à leitura do alvo; o CLI recusou disclosure antes de chamar esse handler nas leituras cruzadas. Esse cenário caracteriza a limitação e não é um bypass de consentimento.

## Reforço durante a integração: hooks desativados

No CLI 2.1.322, uma regra explícita de `ask` com `dontAsk` recusou a chamada mesmo com autorização do hook. Sem a regra de `ask`, quickstart funcionou até com hooks desativados: portanto não serve como segunda barreira. A combinação `ask` + modo `default` + MCP interno de permissão funcionou; houve uma chamada ao hook e uma ao callback. Quando o callback exigiu uma autorização correspondente do hook e os hooks foram desativados, a chamada foi recusada. Esses experimentos usaram somente quickstart, sem criar outro artefato.

O adaptador passa a exigir duas barreiras: PreToolUse e callback interno que só aceita a operação autorizada ainda em curso. A criação/atualização reais com essa configuração reforçada continuam pendentes do smoke integrado; fixtures não substituem essa validação.

## Revisão do checkpoint bloqueado

A revisão independente não encontrou forma de contornar o bloqueio de produção. Encontrou três defeitos no código experimental: trabalho preso entre reserva e despacho, checkpoint antigo substituindo publicação confirmada com fontes ausentes e recuperação sem todas as checagens de admissão. Os três têm regressões que falharam antes da correção. A reserva agora agenda reconciliação na mesma transação, cancelamentos comprovadamente sem efeito remoto terminam localmente e a recuperação respeita suspensão, limites e disponibilidade. Checkpoints usam fase nativa monotônica, sem ordenar versões opacas do provedor.

A verificação posterior passou com 622 testes e dois skips existentes em 44 arquivos, além de typecheck, lint, build, fronteiras, licenças e migrações. Os avisos de resultado foram verificados em português/inglês e nos catálogos dos 14 idiomas. A imagem do checkpoint iniciou com PostgreSQL real e respondeu a cadastro, organização, web e download do runner num compose isolado. Esses checks não substituem o contrato autenticado do Claude: fontes e propriedade na recuperação nativa continuam pendentes, e o piloto permanece bloqueado.

## Rechecagem após leitura interativa

A pessoa proprietária abriu o artefato de teste na segunda conta isolada de validação e mostrou o resultado de Artifact read com HTTP 200. Confirmou que a leitura ocorreu diretamente, sem aviso nem aprovação manual. O canvas vazio era o shell privado deixado pelo smoke, não um design concluído.

Depois disso, o manager de produção foi repetido somente em modo recovery/read, com CLI 2.1.322, a mesma pasta de conta e autorização do harness limitada a `read_target` do alvo confirmado. A leitura continuou recusada como `interactive_consent_required`, antes de obter uma referência verificada pelo adaptador. Nenhum create/update foi permitido nesse teste. O CLI global encontrado localmente era 2.1.323, portanto a captura interativa não demonstra equivalência de versão com o executor fixado.

A configuração de usuário consultada tinha modo default e nenhuma regra explícita de allow/ask para Artifact. O adaptador adiciona a regra ask e usa o permission-prompt-tool correlacionado ao hook para sua segunda barreira. A evidência aponta para a diferença de transporte/política da integração, não para um consentimento global que a pessoa tenha deixado de aceitar. O sucesso interativo não foi transferido ao fluxo automatizado. A remoção da segunda barreira não foi testada como solução nem admitida para produção. O piloto permanece fechado até que um caminho de permissões compatível seja validado.

## Verificação do diagnóstico de política e transporte

A investigação externa identificou `permissions.ask: ["Artifact", ...]` como causa do pedido local de consentimento. A comparação dinâmica confirmou a hipótese no CLI 2.1.322: mantendo conta, alvo, manager, hook e demais opções, retirar somente Artifact de ask permitiu um tool_result de leitura bem-sucedido. O hook de Artifact foi chamado uma vez e o callback MCP de Artifact não foi chamado. Os status de autenticação de 2.1.322 e 2.1.323, consultados sem modelo, indicaram a mesma identidade e organização (comparadas apenas em memória). Não se executou nova leitura cruzada de contas nem criação/publicação.

O resultado final do manager ainda foi guard_failed porque seu parser não reconhece a versão do envelope nativo de leitura. A resposta medida inclui um cabeçalho `[Artifact <id interno> (version <versão opaca>) ...]`, não uma linha `Version:`. O sucesso da ferramenta nativa e a normalização do adaptador são resultados separados. Corrigir esse parser permanece parte da recuperação incompleta; o artefato é um shell sem fontes próprias.

Um segundo experimento manteve ask e mudou somente o transporte para `--permission-prompt-tool stdio`, com inicialização do protocolo bidirecional e host respondendo deny a todos os pedidos. O CLI entregou `can_use_tool` para Artifact com `requires_user_interaction: true`, `matched_ask_rule` vindo de flagSettings e uma description genérica de leitura. A negativa do host foi respeitada, sem leitura concluída. Isso comprova recepção/negação no canal, não apresentação completa do disclosure, aprovação humana nem recuperação concluída.

Remover ask de Artifact não foi adotado como correção de produção: a proposta reconhece exposição de criação de shell e leitura quando hooks não executam. O Read interno da publicação não protege essas duas operações, e observar tool_use no stream pode ser posterior ao efeito. A verificação prévia de settings não é, por si só, uma segunda autorização antes de cada operação. O requisito de bloqueio anterior ao efeito permanece vigente. O caminho a validar é um canal de permissões compatível com interação humana e a segunda barreira atual, mantendo o piloto fechado. A configuração do manager de produção não foi alterada.

Referências primárias: [aprovações e entrada do usuário no Agent SDK](https://code.claude.com/docs/en/agent-sdk/user-input), [implementação do protocolo de controle no SDK Python](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py). Os campos extras do CLI foram observados no experimento da versão fixada e não são presumidos como contrato estável em outras versões.


## Implementação stdio com recusa nativa

A continuação mantém Artifact em ask, usa MCP estrito vazio e inicializa o protocolo SDK antes do prompt, sem fechar stdin até o resultado. Testes do runner exercitam revisão humana, autorização sequenciada após aprovação, hook ausente/desligado, id adulterado, revogação e desconexão. O parser reconhece somente o preâmbulo nativo medido de metadados próprios/privados, sem aceitar Version dentro de fontes.

O primeiro smoke do manager atualizado recusou corretamente um formato ainda desconhecido. A captura revelou anotações específicas de leitura: pin read/UUID interno, três flags de consentimento false e display target com URL/título. Após testes RED→GREEN, o guard admite apenas esse formato medido, mantém os campos intactos e inclui o título nativo no texto da revisão. A repetição real na conta de teste entregou um pedido ao callback do host, que respondeu deny. Houve uma autorização read_target, nenhuma leitura concluída e nenhuma criação/publicação. A aprovação humana e a recuperação de fontes continuam pendentes.

### Revisão humana e qualificação em 14/11

O teste seguinte conectou o CLI fixado, o manager e o serviço real de consentimento, com a tela React de revisão servida em um servidor local temporário. A conta de teste foi vinculada explicitamente ao fixture de qualificação. A abertura automática pelo navegador estava indisponível, e o usuário recebeu o link local. Um pedido de leitura ficou disponível para revisão e a espera encerrou por timeout. Não foi observada revisão ou decisão humana. Não houve leitura confirmada, autorização de criação/publicação nem importação de arquivos. O servidor temporário foi encerrado e a operação não foi repetida. Isso verifica a recusa por ausência de resposta, sem provar aprovação, transporte remoto de produção ou recuperação completa.

O teste do texto de erros encontrou uma nova recusa com ponto e vírgula, corrigida e verificada RED→GREEN. A suíte final de API, consentimento, recuperação, tarefas e resultados passou com 27 testes. O build Docker com PostgreSQL isolado, cadastro, organização, web e runner passou, assim como a exportação iOS/Hermes. A exportação não substitui a inspeção visual nativa.

O CI completo não passou. Parte das falhas do servidor foi reproduzida no código anterior à integração no mesmo Mac: detecção real do OrbStack nos fixtures do instalador, contexto Git com arquivos ignorados, histórico do terminal e espera de processos/browser. Os testes de coautoria e requisitos ARM passaram quando isolados. A comparação de ordinal espanhol do fallback Intl também falha no baseline com Bun 1.4.4. As regressões introduzidas na descoberta de permissões, liveness e textos/atividades foram corrigidas com testes direcionados. A primeira falha web foi um timeout de 5 segundos seguido por falhas de renderização; os dois arquivos envolvidos passaram com 22 testes na repetição isolada. A geometria global apontou uma linha de Lodi em componentes/CSS sem alteração nesta integração. Esse resultado continua aberto, sem atualizar o baseline para ocultá-lo.

Na repetição com limite de 15 segundos por teste, sem alterar o limite do projeto, mobile e desktop passaram com 1.843 testes em 165 arquivos. O runner e o protocolo de Design passaram com 43 testes em seis arquivos. Os 75 estados existentes de Lodi retidos do CI também foram medidos com o checker e os estilos do código anterior à integração, reproduzindo a mesma falha de geometria. Isso não equivale a um CI completo verde.

A repetição completa de web e design system com o mesmo limite de 15 segundos passou com 4.627 testes, seis skips existentes e zero falhas em 421 arquivos. Essa repetição não produziu uma nova captura global de geometria. O limite de testes do repositório não foi alterado.

Continuam pendentes a aprovação humana real, o formato nativo das fontes e o contrato completo de criar/preencher/atualizar/cancelar/recuperar, além da inspeção visual nativa. Os dois gates de produção permanecem fechados.

### Continuação com o usuário presente

O usuário aprovou a nova revisão na interface. O consentimento terminou em consumed, sem permitir nova decisão. Houve uma decisão humana e uma reautorização vinculada antes da leitura nativa própria/privada. A versão atual diferia da criação registrada e a release do template também mudou, embora o artefato ainda estivesse vazio. O manager recusou por conflito antes de escrever ou publicar, preservando o alvo antigo. Essa execução prova o caminho de revisão humana do fixture de qualificação, sem substituir a admissão autenticada completa de produção.

O usuário então autorizou criar outro artefato privado sintético na mesma conta de teste. A criação parou no segundo gate: o pedido SDK comum trazia decision_reason, ausente da lista estrita de campos. O CLI retornou explicitamente que a chamada foi recusada. Como a primeira autorização de criação já havia sido emitida, o manager conservou unknown, sem referência confirmada. A criação não foi repetida automaticamente nem o registro incerto foi liberado.

O teste do formato medido falhou antes da correção e passou depois. O parser agora aceita esse texto limitado e não vazio somente em criação por type_url sem URL de destino e sem requires_user_interaction:true. Continua exigindo o hook exato, id/input correspondentes e consumo único. Novos textos em leitura ou pedidos humanos permanecem recusados. A suíte relacionada passou com 56 testes e o typecheck global passou. A leitura com revisão humana foi verificada, mas fontes, publicação completa, recuperação e QA nativo continuam pendentes, com os dois gates fechados.

### Publicação e envelopes de fontes medidos

Com nova autorização explícita, a criação confirmou um shell privado. A primeira leitura tentou um arquivo inexistente antes dos metadados e interrompeu o preenchimento, preservando o shell e seu registro parcial. O guard agora exige metadados antes de arquivos e recusa arquivos de um alvo comprovadamente vazio, com teste RED→GREEN.

O preenchimento foi medido num fixture manual separado, sem liberar o job parcial original nem provar sua retomada em produção. Depois da revisão humana, a primeira publicação foi recusada por novas anotações nativas. O pin medido vincula arquivo e root exatos, alvo atual, tipo file, UUID, flags de consentimento falsas e ausência de redirecionamento. Caminhos ou root alterados, campos futuros, replay e publicação com interação humana obrigatória continuam recusados. A correção passou por RED→GREEN.

Após autorização explícita para outra execução no mesmo alvo, o CLI confirmou uma publicação com os dois arquivos de conteúdo. Seu cabeçalho usa Version N, version id opaque, diferente da criação. O parser antigo conservou unknown. O formato atualizado foi verificado RED→GREEN e na captura existente, sem repetir a publicação ou encerrar o registro incerto. A leitura posterior retornou outra versão e um novo preâmbulo para conteúdo preenchido. Esse preâmbulo exato também ganhou um teste RED→GREEN, mantendo a exigência de proprietário e privacidade no cabeçalho nativo.

O primeiro teste de leitura dos arquivos foi recusado porque o runner anexava um checkpoint de publicação às autorizações seguintes da recuperação. O backend proíbe esse pacote. A correção restringe checkpoints à execução, com teste real de IPC do hook e CLI fake RED→GREEN. O teste nativo seguinte leu os dois arquivos, cada um com a mesma versão dos metadados, tamanho, MIME e SHA-256, gravados sob a pasta .cli isolada. Esses downloads ainda não são um manifesto recuperado ou importado.

O inventário nativo foi medido com outra revisão humana: há 36 arquivos na versão observada, incluindo 34 fixos do template e os dois arquivos project de conteúdo. A operação foi limitada à lista de arquivos do próprio alvo já validado, autorizada como read_target. O HTML lido referencia support.js, que não aparece nesse inventário. Isso não autoriza inventar ou buscar outro arquivo fora do alvo. A completude deve seguir o inventário e a versão nativos, com validação de hash e caminho antes da importação. As duas condições de rollout permanecem desligadas.

### Recuperação com manifesto completo

O parser de fontes agora valida contagem completa, caminhos, tipos, limites e versão do inventário, separando apenas os arquivos fixos conhecidos do template. Cada envelope de arquivo deve corresponder a uma entrada e à mesma versão. A cópia do cache exige a pasta .cli isolada, UUID interno do mesmo artefato, sufixo do caminho correto, arquivo regular sem symlink/hardlink, tamanho e SHA-256 exatos. Não extrai conteúdo de tags do corpo, não executa HTML e não sobrescreve edições locais. Metadados sem todas as fontes continuam publicados/incompletos. Testes RED→GREEN cobrem inventário ausente ou truncado, arquivo faltando, caminhos/versão/bytes substituídos e mudanças locais antes da conclusão.

O teste real seguinte usou o prompt e o parser de recuperação, sem substituir o prompt. Após uma revisão humana e reautorização vinculada, houve inventário e duas leituras de arquivo, sem criação/publicação. Os dois arquivos foram verificados e importados pelos serviços reais de upload/Drive, com duas transferências e três artefatos (referência mais fontes). O job do fixture terminou succeeded e sourceTaskId correspondeu ao task de leitura. O transporte do hub permaneceu fake nesse teste. Isso não equivale a provar o ciclo autenticado completo do app, seu journal, a segunda conta ou o QA visual nativo, e não encerra os jobs incertos anteriores.

Uma lacuna de recuperação conhecida foi reproduzida: sem checkpoint remoto no resultado anterior, uma leitura podia avançar a versão armazenada do design. O teste RED→GREEN passou a recusar a diferença em relação à versão conhecida, mantendo o resultado incerto e a referência anterior. Outra regressão RED→GREEN impede que arquivos locais não enviados ou bytes alterados depois da publicação sejam apresentados como fontes publicadas: o manifesto é capturado antes do efeito, deve cobrir os arquivos enviados e é verificado novamente. Os gates de produção seguem fechados.


### Duas contas, controle positivo e cancelamento com journal

O proprietário autenticou a Max num perfil isolado pelo CLI oficial fixado, sem cópia de credenciais. A comparação em memória confirmou que a identidade corresponde à Max local e é diferente da Team. Não foram gravados e-mails ou tokens no registro de qualificação.

O controle positivo da Max criou um artefato privado, consumiu uma aprovação real do proprietário com reautorização vinculada e publicou os dois arquivos sintéticos. A importação terminou com duas transferências, referência mais fontes e sourceTaskId correto, deixando o job do fixture succeeded. A Team já tinha seus controles positivos de publicação e recuperação. Nenhum experimento incerto anterior foi repetido ou liberado.

As leituras cruzadas Max→Team e Team→Max retornaram ownership unconfirmed com pedido nativo de consentimento user-only. O guard estrito recusou esse formato antes de chamar a revisão do host, sem metadados confirmados, fontes ou transferências. Isso demonstra a recusa do adaptador nessas duas direções com identidades distintas, não uma resposta ACL 403/404 observada diretamente no provedor.

Outro teste somente de leitura usou TaskManager, CLI real e journal persistente. Quando a revisão nativa foi registrada, o serviço de cancelamento interrompeu o task sem aprovar. O pedido terminou canceled/canDecide:false, com zero decisões, fontes e autorizações create/publish. A repetição do mesmo taskId e a reinicialização do TaskManager preservaram o resultado cancelado com apenas um spawn do CLI. O primeiro transporte dos frames era uma ponte em processo. A repetição usou o WebSocket real autenticado do MachineHub e RPC de task.start/task.cancel: o pedido terminou cancelado sem decisão, e a repetição/reinicialização continuou produzindo apenas um processo nativo. Isso valida cancelamento e replay do journal nesse transporte, sem provar o ciclo completo do app ou a entrega de fontes por essa conexão.

### Preview iOS e build atualizado

O preview Release no simulador usa os componentes reais de consentimento, Card, Sheet, Button e tema com API sintética. O primeiro lançamento falhou por incompatibilidade de ExpoVideo no pacote temporário, que havia omitido a configuração buildFromSource já existente no app. A configuração original foi restaurada no preview e o build/lançamento seguinte passou; o pacote de produção não mudou.

Na tela curta em português foram observados conta, alvo, texto do pedido, confirmação desmarcada e aprovação desabilitada. A recusa sintética fechou a folha e mudou o cartão para Recusado. O pedido longo em alemão/tema escuro manteve o texto do provedor inerte e permitiu rolar até a confirmação e os botões. A interação com a caixa e a limpeza ao reabrir continuam aguardando conferência. Esse preview não usa conta Claude, não aprova operação real e não prova o fluxo autenticado completo do mobile.

O Docker atualizado no commit 90c3ad935 compilou web e runner. O smoke isolado passou por PostgreSQL, bootstrap, cadastro, organização e download de web/runner. Ainda faltam o ciclo completo no app com transporte autenticado do runner, as verificações nativas restantes e a revisão final do incremento. O piloto permanece desligado.


### Fluxo completo na cópia de qualificação e revisão final

Uma cópia temporária do candidato habilitou a admissão apenas nesse processo de teste, mantendo os gates do worktree desligados. O fluxo usou sessão Better Auth real de um proprietário sintético, CSRF e rotas do app, SPA completa, Tool Gateway, WebSocket autenticado do MachineHub, RunnerConnection/handlers, TaskManager e upload autenticado dos arquivos. A conta Max continuou no perfil isolado existente, sem cópia de credenciais.

A criação privada terminou succeeded na revisão local 1. A atualização do mesmo alvo terminou succeeded na revisão 2, preservando e enviando os arquivos conhecidos. Cada execução consumiu sua própria aprovação nativa. A primeira entrega de conclusão após a publicação foi perdida de propósito; a reconexão recuperou o resultado do journal sem repetir o processo nem a publicação. Foram importados a referência e dois arquivos em cada caso.

Uma nova fixture de recuperação vinculou explicitamente o alvo e a versão conhecidos, sem alterar os jobs bem-sucedidos ou resolver os antigos resultados incertos. O proprietário usou o diálogo real de Recuperar fontes, confirmou a associação e depois aprovou o novo pedido nativo de leitura. Metadados, inventário e dois arquivos foram lidos e importados pela conexão real, mantendo a versão opaca. Outra perda intencional da conclusão também foi recuperada do journal, com um único processo somente de leitura.

O teste de UI do Xcode comprovou a sequência que faltava no iOS: desmarcado/desabilitado, marcado/habilitado, fechar sem decidir, reabrir desmarcado/desabilitado e aprovação sintética. As duas imagens exportadas do xcresult foram conferidas. Nenhuma aprovação real do Claude foi feita por automação.

A revisão independente encontrou duas falhas importantes: uso vinculado a um run já removido pela retenção e anexos que podiam mudar após a aprovação. As regressões falharam antes da correção e passaram depois. A recuperação agora contabiliza pelo task, conta e pessoa sem exigir o run histórico. A aprovação e a reserva persistem versão/hash/nome/caminho de cada anexo. Alterações anteriores ao despacho são recusadas, bytes já fixados não são substituídos por uma nova versão e jobs antigos sem manifesto não selecionam conteúdo atual. A migração 0266 é nova, nullable e compatível com a versão anterior. Não houve segunda revisão nem mudança dos resultados incertos antigos.

A suíte específica ampliada passou com 113 testes em 17 arquivos, incluindo cinco verificações das correções. Web passou com seis testes, mobile com 12 e o teste nativo do Xcode passou. Typecheck, build, lint com avisos existentes, limites públicos e verificações de migração também passaram. As falhas globais de CI anteriores continuam documentadas. A implementação segue experimental com os gates de produção fechados.


O Docker após as correções também passou com PostgreSQL isolado, migração 0266, cadastro, organização, SPA e bundle do runner. O scan incremental dos nove commits recentes não encontrou segredos. Servidores temporários de qualificação foram encerrados após os resultados; artefatos privados e perfis de login foram preservados.

### Decisões e custos registrados

Esta lista conserva, na ordem, as 28 decisões do registro de execução e da revisão. Não houve achados Minor adiados.

| Decisão | Custo ou limite se o pressuposto falhar |
| --- | --- |
| 1. Continuar pelo stdio com revisão do dono e duas barreiras de autorização. | O usuário pode receber mais revisões nativas. |
| 2. Manter publicações parciais e resultados incertos bloqueados. | Um shell incompleto pode exigir intervenção externa. |
| 3. Admitir somente os campos nativos de leitura medidos, sem alterá-los. | Mudanças no CLI recusam a operação. |
| 4. Consultar elegibilidade da conta candidata antes de habilitar a concessão. | Uma conta incompatível permanece desabilitada ou é recusada no salvamento. |
| 5. Transportar ids dos jobs pelos metadados existentes de efeitos e respostas. | Um cartão pode ficar indisponível, mantendo a consulta autenticada no backend. |
| 6. Criar arquivos novos em updates somente após prova nativa de alvo vazio. | Um formato diferente pode impedir o preenchimento. |
| 7. Exigir opt-in próprio para Design, inclusive no braço direito. | Há uma etapa explícita adicional de concessão. |
| 8. Aceitar explicação limitada somente na criação comum medida. | Um novo formato de permissão continua recusado. |
| 9. Usar fixtures de associação separadas para medir preenchimento e recuperação. | Elas não comprovam retomada de jobs parciais em produção. |
| 10. Vincular a publicação ao arquivo, root, alvo e flags nativos exatos. | Outro formato de pin recusa a publicação. |
| 11. Recuperar apenas inventário completo suportado e bytes com caminho/tamanho/hash verificados. | Tipos ou formatos novos permanecem com fontes incompletas. |
| 12. Capturar o manifesto antes de publicar e exigir todos os arquivos preparados. | Pedidos grandes ou parciais podem ser recusados pelos limites atuais. |
| 13. Habilitar a admissão somente na cópia local descartável de qualificação. | Isso não habilita nem comprova admissão de produção. |
| 14. Contabilizar a recuperação pelo task, conta e pessoa sem exigir o run histórico. | O uso recuperado pode ficar sem vínculo ao run original. |
| 15. Fixar versão/hash/nome/caminho dos anexos na aprovação e no job. | Anexos editados ou jobs antigos sem manifesto exigem nova invocação autorizada. |
| 16. Manter admissão de produção e promessas comerciais fora do incremento revisado. | A função permanece indisponível até a admissão deliberada. |
| 17. Recusar versões, plataformas, modos e autenticações não qualificados. | Atualizações exigem nova qualificação. |
| 18. Afirmar somente a recusa entre contas observada no adaptador. | Não há garantia independente sobre a ACL do fornecedor. |
| 19. Excluir comentários, compartilhamento, exclusão, exports e editor externo. | Esses fluxos continuam manuais no editor. |
| 20. Preservar a fronteira de confiança no usuário e host do runner. | Comprometimento local pode invalidar a evidência e o isolamento local. |
| 21. Registrar os erros globais anteriores em vez de alterar comportamento e baselines alheios. | O CI completo continua não verde nesse host. |
| 22. Renderizar canvas v3 com valores escalares e passagem direta comprovada, sem executar lógica do projeto. | Componentes calculados ou dependentes de runtime precisam do editor externo. |
| 23. Vincular a prévia ao job e às versões imutáveis dos uploads verificados. | Importações antigas ou incompletas precisam de recuperação antes da prévia. |
| 24. Preservar a revisão anterior de transporte e autorização como escopo concluído. | As limitações da qualificação anterior continuam valendo. |
| 25. Recusar projetos interativos ou com recursos visuais externos, com alternativa explícita. | Alguns designs só podem ser vistos no Claude. |
| 26. Manter fechada a admissão de produção e de combinações não qualificadas. | A liberação exige uma decisão de admissão separada. |
| 27. Validar a apresentação com fontes sintéticas recuperadas e pipeline real de arquivos, sem novo uso pago do Claude. | Não se afirma uma nova execução autenticada completa do app depois das mudanças visuais. |
| 28. Usar iframe estático sem permissões de sandbox, mantendo a política isolada compartilhada. | A prévia web não possui interação nem o diagnóstico por script do visualizador HTML geral. |

### Rendered result preview (2026-11-14)

The owner corrected the presentation acceptance after transport qualification: a completed publication or recovery must show the layout, with source files secondary. The result card now uses the ordinary result surface rather than an approval request. Its preview descriptor is derived from the job's journaled result and task-bound verified upload records, including immutable stored versions. Clients fetch those exact bytes through the existing authenticated artifact API, validate metadata and byte length, and render canvas-v3 boards in native order at the saved dimensions.

This is a static picture of scalar `data-props` defaults, not the external editor or a project runtime. Project scripts are removed, a restrictive policy precedes all project content, the web iframe has an opaque origin, and the native WebView disables JavaScript, cookies, storage, file access and external navigation. Computed bindings, unsupported canvas versions, missing visual dependencies and invalid dimensions/paths show an explicit unavailable state with the owning Claude link. Source files remain available under a collapsed disclosure. The provider consent and execution policy do not change.

The actual recovered synthetic blue status card rendered with its saved accent and typography in web components at1280/390/320, in light and dark themes, and in the actual iOS preview component on iPhone18Pro. No new Claude execution was used for presentation qualification. Both experimental admission gates remain closed.

A revisão independente do incremento visual encontrou quatro problemas importantes, todos reproduzidos e corrigidos por testes antes de encerrar: MIME normalizado pelo storage (incluindo charset e CSS como texto), refresh com atributo codificado, valor calculado com o mesmo nome de uma propriedade e referências visuais externas não verificadas. O manifesto público agora usa a mesma regra de MIME do storage. O iframe estático não concede scripts ou formulários, e os metadados do projeto são removidos. Apenas a passagem direta de propriedades no formato nativo medido é interpretada, sem avaliação de código. Referências externas em SVG, imagens responsivas e outros atributos visuais são recusadas.

O teste de integração importa fontes por uploads vinculados ao task e usa os serviços reais de metadados e bytes antes do visualizador. O controle Chromium de refresh codificado confirmou uma navegação com o sandbox anterior e nenhuma com o estático, sob a CSP real do app. A suíte ampliada passou com179 testes em25 arquivos. As quatro correções tiveram RED→GREEN, sem segunda revisão. Typecheck, build e limites públicos passaram, com125 avisos e82 informações no lint, incluindo scratch de execução. A apresentação foi novamente observada no navegador e no simulador.

Fechamento do incremento visual: commits8917de324 e4449bff2c. A execução final passou com179 testes em25 arquivos,1248 asserções. Build de web e servidor, typecheck global e checagem de limites passaram. O checkout original e os gates de produção foram preservados.

### Link-only delivery supersedes the static preview (2026-11-14)

The owner's real finance prototype used computed component values and component imports. The limited static renderer correctly refused it, but that presentation did not meet the desired experience. The owner approved replacing the embedded preview with a verified external link and secondary source files. Web and mobile no longer load or render project HTML for this result card.

A shell checkpoint is now internal progress, not a ready publication in app/tool views. The link is exposed from that job's own confirmed source-bearing result, never the latest mutable design record. Explicit create-shell phase1 is always withheld. Internal checkpoints, revision/effect locks and native owner disclosures are preserved. Tool guidance distinguishes creation from confirmed publication and tells the agent that completion is delivered automatically.

The original trigger message already persists on a Design job. Its actual thread id, scoped to the same org/channel, now supplies consent, machine-task completion and source-import placement: null for a top-level request and the original thread for a thread request. Missing triggers conservatively retain the stored work root. Generic task routing and owner-only DM authorization are unchanged. Prior imports keep valid old placement, checked against the same bound task/upload; existing message history is not rewritten.

Verified on the existing local finance result without another provider operation: its card shows Open in Claude with collapsed sources, no preview/error/retry. New dispatch/completion placement and once-only wake are covered by integration tests for root and nested requests. The production gates remain closed; the separate local development copy remains admitted for the owner's testing.


The final whole-increment review found three Important issues, fixed in one RED→GREEN pass: owner-association recovery inherited the shell phase and lost a valid link; a contradictory phase1 source manifest could finalize imports and release the update lock; and completion text was discarded by the persisted model-context path. A shared proof now accepts create content at phase2 or a recovery snapshot bound to the authorized recovery task, sequence and associated URL. It gates both readiness and finalization. Imports preserve the saved normalized proof. Completion metadata carries the sanitized public snapshot, actual task context consumes it instead of raw runner output, and a Design completion can pass without duplicating its already-delivered card. A new human answer still takes precedence; generic machine-task behavior is unchanged.

Validation:225 tests across29 files,1355 assertions; global package typechecks and boundaries passed. Changed-file lint has12 warnings and no errors. Regression tests traverse production reconciliation using the saved result, assert import refusal and retained update lock, and inspect actual persisted wake context plus reply policy for unknown/succeeded results.

Decisions and costs retained from this increment:
- Preserve irreversible internal checkpoints and locks while hiding an empty shell publicly; cost: uncertain shell failures need explicit owner handling.
- Resolve delivery through the durable original trigger scoped to org/channel, falling back to the stored work root when absent; cost: a deleted trigger can retain the historical thread placement.
- Retain the historical preview API field only as exact-version source metadata; cost: the old field name remains until separate API cleanup.
- Permit historical upload work-root placement as well as the resolved reply thread, always bound to the same job/org/channel/task/path/hash/version; cost: the compatibility allowance remains until migration.
- Leave existing consent/result history in place; cost: old messages remain in their original thread, while future deliveries use the corrected destination.
- Do not re-exercise unchanged live provider/account internals for this correction; prior qualification stands and no new paid operation is used; cost: provider-side changes remain outside this local check.
- Use mobile component/source tests and typecheck without another native simulator run; cost: a platform-specific visual issue may still need a device check.
- Do not execute complex source projects inside the app; cost: interactive viewing requires opening Claude.


## Automatic Claude Design board tracking (2026-11-15)

A new native job atomically reserves one private issue before dispatch. A historical issueId on the durable job survives transient run retention and prevents duplicate cards or silent recreation after deletion. A compatible already-associated private task can be reused; wider, foreign or reassigned tasks are not taken over. No handTask, second agent run or native operation is used to create a tracking card. Ordinary task visibility is unchanged; native tracking has the stricter original-owner rule described below.

The shared read-only progress projection reads the current native task, job checkpoint, consent and grant revision. It distinguishes queued, working, waiting_approval, recovering, importing, succeeded, failed, canceled and unknown. A finished conversational turn does not finish the native work. Empty phase1 shells remain in progress; only verified imported sources finish. Closed, consumed, expired or revoked approvals do not show as pending. Board work and badges also consume this live projection so a delayed runner poll cannot leave an actionable stale badge.

Current conversation context gets the same progress at the original reply location, refreshed per turn. Historical consent notices no longer claim a current request. The agent is told not to create another task, poll or promise generation after a failure. Web and phone reuse the existing result card and a link to the actual task, retaining link-only results and collapsed exact-version sources.

Tests cover real reservation/consent/import transitions, repeated callbacks, run retention, deleted/reassigned/widened/foreign cards, safe private-card reuse, revocation before runner polling, actual buildRunContext and web presentation. Initial full affected verification:250 tests across32files,1432 assertions; all package typechecks and boundaries pass. No new provider operation.


Final review of automatic board tracking found five Important issues, all reproduced and corrected in one RED→GREEN pass: ordinary private-task ACLs exposed native content to other administrators; generic background-work completion could close a reused native card early; pending-state projection approximated rather than reused consent authority; current recovery stop conditions lost to the recovering branch; and twelve selectable locales lacked the new strings. Native tracking now carries an immutable original-owner marker through issue ACLs, search scopes, activity/conversation reads, child tasks and event delivery. Only the original owner receives native task events; wider sharing is refused. Ordinary task policy remains unchanged. Generic background work cannot claim or complete a native-owned card, and incompatible existing cards are not reused. The current consent route and progress projection share the exact read-only authority predicate, including scope, retained-run/account/operation eligibility. Current denials, expiry, revocation and cancellation take precedence over recovery, while a fresh authorized recovery still supersedes an old uncertain outcome. All fourteen locales contain the new labels, maintained by the translation tooling.

The native issue source is now the actual original message, allowing the existing source-conversation UI to display it. Two Minor findings remain deferred: OpenAPI Job documentation omits the additive progress/issue fields already used by typed app clients, and the legacy effect-checkpoint caller can publish from an outer transaction before a later rollback (a phantom refresh; authoritative reads and action checks remain on committed data). No second review was dispatched. Full affected and adjacent verification after the fix pass:399 tests,42files,2337 assertions, all passing; all package types, web/server build, boundaries and migration checks passed.

Decisions retained: honor the explicit instruction to implement the chosen Design-only behavior without another approval loop (cost: documented reversible defaults may need adjustment); reuse only truly compatible private tracking, never generic background ownership (cost: a broader existing task gets a separate private native card); keep the issue pointer after deletion without recreating it (cost: deleted tracking stays in chat). Historical jobs are not backfilled (cost: only explicit recovery/new work links them); no live provider operation is repeated (cost: external provider behavior is not requalified); manual deletion/reassignment/board overrides remain user-owned (cost: tracking may stop matching the native job); context is bounded to twenty candidates/five matching jobs (cost: older work needs explicit lookup); generic task manager/preview remain outside this increment (cost: detailed monitoring/interactive viewing stay on existing external surfaces).

Local verification after normal migration0267 and source refresh: API/web200; real Chrome conversation shows current unknown and succeeded states without preview. Three historical jobs were preserved (one earlier uncertain checkpoint, two succeeded), no cards were silently backfilled, and the user’s later successful workout design remains ready. Credentials, accounts, database and local-only admission preserved; no provider operation by this implementation.
