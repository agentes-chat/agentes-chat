# Claude Design: acompanhamento no board

O usuário escolheu integração automática, limitada ao Claude Design, e pediu para executar. A execução Native previamente escolhida continua; esta autorização dispensa outra rodada de perguntas sobre o mesmo comportamento.

## Resultado

Cada pedido novo de Claude Design cria um cartão privado no board, atribuído ao agente, antes do despacho. Uma referência durável no job impede cartões duplicados em callbacks, reconciliação e recuperação. Criar o cartão não inicia outro agente ou outra operação no Claude. A conversa original continua sendo o destino das aprovações e do resultado.

O cartão e o chat consultam a mesma projeção dos eventos reais: na fila, trabalhando, aguardando aprovação, recuperando fontes, importando, concluído, falha, cancelado ou resultado incerto. Aprovação já aprovada/consumida/fechada não conta como pendência; pedido expirado também não. Só fontes confirmadas e importadas permitem concluir. Um shell vazio e uma falha incerta nunca viram Feito.

O cartão mostra responsável, estado, atualização mais recente e referência à conversa. Seu histórico registra transições reais sem comentários repetidos ou progresso inventado. Se existe uma tarefa compatível do mesmo pedido e com o mesmo alcance privado, ela pode ser vinculada; caso contrário cria uma própria. Apagar um cartão não o recria silenciosamente. Reassociação, recuperação e entrega permanecem limitadas à autorização existente do dono da conta.

O agente recebe um resumo atual dos jobs desta conversa; avisos históricos de revisão não são usados como estado atual. O resultado do tool e o cartão no chat incluem o vínculo ao board e a fase atual. O board reconhece a atividade nativa mesmo depois de o turno do agente encerrar.

## Abordagens

Orientar o modelo a criar tarefas é mais simples, mas depende de lembrança e pode concluir cedo ou disparar uma delegação duplicada. O usuário escolheu a integração automática: o servidor projeta o mesmo job no board e no chat. Reutilizar o workflow genérico de agente em background iniciaria outro ciclo de trabalho; não é necessário para acompanhar o subprocesso já existente.

## Limites

- Só Claude Design; não alterar tarefas genéricas, permissões nativas, rollout ou política de resultados incertos.
- Reutilizar board, badges, eventos e controles existentes; sem porcentagens ou prazos estimados. Cartões nativos preservam acesso exclusivo ao dono da conta, inclusive diante de outros administradores; a política de tarefas comuns continua igual.
- Não repetir a criação atual, aprovar leituras, recriar artefatos ou usar modelo para verificar.
- Verificação sintética, leitura do ambiente real e sincronização local quando não houver execução ativa. Dados, contas e configuração privada preservados.
- Jobs históricos não ganham cartões automaticamente nesta primeira entrega; uma recuperação explicitamente iniciada pode criar o vínculo faltante. O job de treino encerrado não será reiniciado.
