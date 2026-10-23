# Organização por episódio

O admin usa Temporadas → Episódios. Dentro do episódio ficam a jornada de dez etapas,
o e-book, o extra e o teste com sua regra de liberação. As rotas antigas continuam válidas
para links da auditoria e da biblioteca de mídia; não há menus separados para esses materiais.

Cada novo episódio recebe um e-book e um extra em rascunho. O extra pode ser trocado por
um material existente ainda não vinculado a outro episódio. A avaliação da temporada e seus
certificados existentes continuam acessíveis dentro dos episódios.

## Regra do teste

No episódio, abra **Teste e liberação**. Escolha os episódios que contam e a quantidade
mínima de conclusões. Por exemplo, selecione 1 e 2 e informe 2. Sem seleção, conta o próprio
episódio; sem quantidade, são exigidos todos os selecionados. Apenas episódios publicados
com conclusão registrada das dez etapas contam. O teste também pode ser desabilitado.

As regras seguem a publicação de conteúdo: a trilha e a API usam o mesmo snapshot publicado.
Rascunhos de regra não alteram um teste já publicado. A API verifica a regra ao salvar respostas
e ao entregar o resultado, inclusive em acessos diretos à URL.

## Migração e publicação

Antes de disponibilizar o novo código em produção, aplique `0009_episode_materials.sql`.
A migração separa e-books compartilhados, copiando as questões, os downloads, as respostas
e os resultados para o material exclusivo de cada episódio. As regras anteriores dos testes
compartilhados são mantidas até que a equipe as edite. Extras ainda não configurados ficam
em rascunho; os conteúdos existentes da biblioteca permanecem disponíveis para vinculação.

Publique os Workers do admin e do aplicativo e gere uma publicação de conteúdo pelo admin
para atualizar a trilha. Não execute seed remoto para aplicar esta mudança. O seed local já
provisiona os materiais exclusivos para os ambientes de teste.

Validação de navegador: `npx tsx tools/e2e/src/episodeSmoke.ts` usa o slot local 9, sem tocar
em produção. As capturas ficam em `tools/e2e/out/episodes/`.
