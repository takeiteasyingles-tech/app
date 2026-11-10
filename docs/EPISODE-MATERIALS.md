# Organização por episódio

O admin usa Temporadas → Episódios. Dentro do episódio ficam a jornada de nove etapas, o
extra e a avaliação da temporada. As rotas antigas continuam válidas para links da auditoria
e da biblioteca de mídia; não há menus separados para esses materiais.

Cada novo episódio recebe um extra em rascunho. O extra pode ser trocado por um material
existente ainda não vinculado a outro episódio. A avaliação da temporada e seus certificados
existentes continuam acessíveis dentro dos episódios.

## Sem e-book (2026-11-10)

O e-book saiu do curso: não há mais etapa de e-book, tela do e-book (com Take Five, Take the
Lead, Take it for Real e Take It Out) nem teste do episódio, no app e no admin. Os dados
continuam no banco (e-books, downloads, questões, respostas e resultados), só não aparecem.
Detalhes em `docs/spec/05-foundation-notes.md`, linhas "Step order" e "No e-book".

## Migração e publicação

Aplique as migrações pendentes antes de publicar o código novo (`0012_presentation_step.sql`
e `0013_no_ebook_step.sql` mudam a ordem e o número das etapas e acertam o progresso dos
alunos). Publique os Workers do admin e do aplicativo e gere uma publicação de conteúdo pelo
admin para atualizar a trilha. Não execute seed remoto para aplicar esta mudança.

Validação de navegador: `npx tsx tools/e2e/src/episodeSmoke.ts` usa o slot local 9, sem tocar
em produção. As capturas ficam em `tools/e2e/out/episodes/`.
