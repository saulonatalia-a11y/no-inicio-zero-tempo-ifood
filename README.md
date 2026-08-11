# TurboFlow — iFood (v0.7)

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
