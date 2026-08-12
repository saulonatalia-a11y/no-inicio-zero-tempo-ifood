# TurboFlow — iFood (v1.0)

Primeira versão local do painel de integração com a Order API do iFood.

## O que já faz
- Autenticação OAuth usando `client_credentials`
- Polling de eventos
- Busca detalhes de pedido novo
- Aceite automático configurável
- Início de preparo automático configurável
- Botões para aceitar, iniciar preparo e despachar
- Acknowledgment dos eventos processados
- Painel web local

## Requisitos
1. Windows
2. Node.js 18 ou mais novo
3. Aplicação criada no iFood Developer
4. Client ID e Client Secret da aplicação
5. Permissão/módulo Order API liberado

## Instalação
1. Instale Node.js LTS.
2. Extraia esta pasta.
3. Duplique `.env.example` e renomeie a cópia para `.env`.
4. Abra `.env`.
5. Coloque:
   - `IFOOD_CLIENT_ID=seu_client_id`
   - `IFOOD_CLIENT_SECRET=seu_client_secret`
6. Abra o terminal na pasta.
7. Execute:
   `npm start`
8. Abra:
   `http://localhost:3000`

## Teste
No portal iFood Developer, use uma loja de teste / pedido de teste antes de produção.

## Importante
- Não compartilhe seu Client Secret em prints públicos.
- O botão "Pedido pronto / despachar" pede confirmação.
- `AUTO_DISPATCH` vem desligado por padrão.
- Pedidos agendados precisam respeitar o horário escolhido pelo cliente.
- Esta é uma versão inicial para homologação/testes. Antes de produção, adicione persistência em banco, HTTPS/webhook, autenticação do painel, logs persistentes e tratamento completo dos tipos de pedido/evento.


## Correções da v0.4
- Corrigido o body do endpoint de acknowledgment para enviar objetos no formato `[{ "id": "..." }]`.
- Eventos cancelados passam a aparecer como `CANCELLED`.
- Pedidos cancelados/concluídos ficam com os botões de ação desativados.
- Mantém suas credenciais fora do ZIP: copie seu `.env` atual para esta nova pasta.


## Novidades da v0.4
- Visual totalmente novo, claro e clean, inspirado em gestores de pedidos.
- Quadro por colunas: Novo pedido, Em preparo, Pronto/Despacho, Em entrega e Finalizados.
- Finalizados dependem do status/evento recebido do iFood; não há botão manual de finalizar.
- Automação configurável pelo próprio painel.
- Despacho automático habilitado por padrão.
- Tempo de despacho editável em segundos pelo painel, padrão 10s.
- Configurações persistidas em `settings.json`.


## Novidades da v0.4 — Webhook
- Endpoint principal: `POST /webhook/ifood`
- Health check local: `GET /webhook/ifood/health`
- Validação obrigatória do header `X-IFood-Signature`
- HMAC-SHA256 calculado sobre o corpo bruto antes de fazer parse do JSON
- Comparação segura da assinatura
- Resposta `202 Accepted` antes do processamento pesado
- Idempotência básica para não processar o mesmo evento duas vezes
- Polling reduzido para contingência (30 minutos por padrão)
- O contador de despacho continua local e não depende do próximo polling

### Importante para ativar no iFood
`http://localhost:3000/webhook/ifood` NÃO pode ser usado no portal do iFood.
O endpoint precisa estar publicado em uma URL HTTPS acessível pela internet, por exemplo:

`https://seudominio.com/webhook/ifood`

Na próxima etapa, publique esta versão em um servidor e use a URL pública HTTPS no campo "URL do webhook".

### Segurança
Nunca publique seu `.env`. O Client Secret deve ficar apenas como variável de ambiente no servidor.


## v0.5
- Corrige despacho automático.
- Menus laterais funcionais.
- Configurações funcionais.
- Contagem regressiva do despacho.


## v0.6 — Fluxo por etapas
- Novo pedido: cronômetro de aceite configurável (padrão 5s)
- Após aceite: inicia preparo automaticamente
- Em preparo: cronômetro até ficar pronto (padrão 10s)
- Ao terminar: chama `/readyToPickup` e move para Pronto / despacho
- Em Pronto: espera o evento do iFood indicando que o entregador saiu com o pedido
- Evento DSP / DISPATCHED: move para Em entrega
- Evento CON / CONCLUDED: move para Finalizados
- Cronômetro visível em cada pedido
- Polling de contingência a cada 30s; Webhook deve ser o canal principal


## v0.7 — Rebranding TurboFlow
- Nome alterado para TurboFlow
- Logo oficial adicionada ao painel
- Paleta visual baseada na logo: preto, amarelo/dourado e branco
- Menu lateral escuro com destaque amarelo
- Botões e estados ajustados para a nova identidade visual
- Mantém toda a lógica da integração iFood da v0.6


## v0.8 — Cronômetros por etapa
- Novo pedido: mostra contagem até o aceite automático
- Em preparo: mostra contagem até ficar pronto
- Pronto / despacho: mostra há quanto tempo está aguardando entregador
- Em entrega: mostra há quanto tempo saiu para entrega
- Finalizados: mostra o tempo total do pedido
- Botão Sincronizar renomeado para Sincronizar emergência
- Mantém Webhook como fluxo principal


## v0.9 — Impressão
- Nova área Impressão no menu
- Papel 58 mm ou 80 mm
- Tamanho de fonte configurável
- Campos opcionais da notinha
- Prévia em tempo real
- Configuração de agrupamento de itens
- Botão Imprimir teste
- Impressão usa o diálogo do Windows/Chrome nesta fase
- Impressão silenciosa/seleção automática de impressora ficará para o futuro Assistente TurboFlow para Windows


## v1.0 — TurboFlow Print Agent
- Botão Baixar Assistente dentro da aba Impressão
- TurboFlow Print Agent para Windows incluído no próprio projeto
- Status Aberto/Fechado
- Detecta impressoras instaladas no Windows
- Seleção de impressora
- Quantidade de vias
- Impressão de teste direto pelo Assistente
- Preparado para impressão automática no aceite
- Agente local usa http://127.0.0.1:17891


## v1.1.1
- Corrigido erro `readJson is not defined` nas rotas POST de configuração/impressão.
- Sem alterações no Webhook ou fluxo de pedidos.


## v1.1.2 — Notinha organizada
- Número do pedido grande, centralizado e em negrito
- CLIENTE, ENTREGA, BAIRRO e REFERÊNCIA destacados
- Produto em negrito
- Observações do item em negrito
- Separadores organizados
- Quebra de linha controlada para 58 mm e 80 mm
- Total destacado
- Prévia do site atualizada para o novo layout


## v1.1.3 — Instalador do Assistente embutido
- O botão "Baixar Assistente" agora baixa diretamente:
  `/downloads/TurboFlow-Assistente-Setup.exe`
- O cliente recebe somente o instalador final.
- Código-fonte do Assistente não é exposto pelo site.


## v1.1.6 — CNPJ + acentuação
- Mostrar CNPJ agora afeta prévia e impressão real.
- CNPJ é lido dos dados do merchant quando disponível.
- Prévia de teste inclui CNPJ.
- Compatível com Assistente v1.4 para acentos/cedilha.


## v2.0 — Impressão térmica real
- Papel 58/80 mm enviado explicitamente ao Assistente.
- Fonte do pedido e fonte da empresa são independentes.
- O tamanho salvo é o mesmo enviado ao Assistente.


## v2.2.1 — Webhook 99Food
- Nova rota pública: `/webhook/99food`
- `POST /webhook/99food` recebe e registra eventos da 99Food.
- `GET /webhook/99food` e `/webhook/99food/health` retornam status de prontidão.
- O webhook e o fluxo do iFood não foram alterados.
- Autenticação/assinatura específica da 99Food será adicionada depois que o aplicativo fornecer as credenciais oficiais.


## v2.3 — Clientes, aprovação e planos
- Cadastro público de cliente.
- Conta começa como `pending`.
- Login com senha protegida por PBKDF2-SHA256.
- Sessão via cookie HttpOnly.
- Painel `/admin.html` para aprovar, bloquear e renovar clientes.
- Planos manuais de 7, 30 e 90 dias.
- Vencimento bloqueia somente o acesso; dados permanecem salvos.
- Administrador é criado pelas variáveis de ambiente:
  - `TURBOFLOW_ADMIN_EMAIL`
  - `TURBOFLOW_ADMIN_PASSWORD`

### Importante
Nesta fase os cadastros ficam em `auth-data.json`. Para vender em produção, antes de colocar vários clientes, migre este armazenamento para PostgreSQL ou outro banco persistente. Em serviços com filesystem efêmero, arquivos locais podem ser perdidos após recriações/deploys.


## v2.5 — Dias restantes e alerta de vencimento
- Mostra o plano e os dias restantes no menu lateral.
- Exibe a data de vencimento.
- Quando faltar exatamente 1 dia, mostra alerta no menu lateral e banner no topo.
- O alerta pode ser fechado durante a sessão.
- Botão "Renovar plano" informa que a renovação é feita manualmente com o TurboFlow.


## v2.6 — Administração de clientes
- Cadastro passa a pedir telefone/WhatsApp.
- Painel administrativo mostra telefone do cliente.
- Filtros: Todos, Pendentes, Ativos, Vencendo em até 3 dias, Vencidos e Bloqueados.
- Contadores de clientes vencendo e vencidos.
- Mostra quantos dias faltam para cada plano.
- Botão Excluir cliente com confirmação.
- Endpoint DELETE administrativo remove cliente e sessões.
- Estrutura preparada para futura automação de cobrança via WhatsApp.
