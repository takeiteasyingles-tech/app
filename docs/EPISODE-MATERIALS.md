# Organização por episódio

O admin usa Temporadas → Episódios. Dentro do episódio ficam a jornada de dez etapas (a última,
Take the Test, é o teste do episódio), o extra e a avaliação da temporada. As rotas antigas
continuam válidas para links da auditoria e da biblioteca de mídia; não há menus separados.

Cada novo episódio recebe um extra em rascunho. O extra pode ser trocado por um material
existente ainda não vinculado a outro episódio. A avaliação da temporada e seus certificados
existentes continuam acessíveis dentro dos episódios.

## Sem e-book (2026-11-10)

O e-book saiu do curso: não há mais etapa de e-book nem tela do e-book (com Take Five, Take the
Lead, Take it for Real e Take It Out), no app e no admin. Os dados continuam no banco.

O teste do episódio voltou como a etapa 10, **Take the Test**, no grupo Fechamento. As questões
ficam no registro de e-book escondido do episódio. No admin, o botão **Take the Test** do card de
materiais abre o editor: questões, teste ligado ou desligado e nota de corte. Não existe mais
regra de liberação: o aluno faz o teste ao chegar à etapa 10, e entregar o teste conclui o episódio.

Detalhes em `docs/spec/05-foundation-notes.md`, linhas "Step order", "No e-book" e
"In this episode, Take a Look, Take the Test (0014)".

## Migração e publicação

Aplique as migrações pendentes antes de publicar o código novo: `0012_presentation_step.sql`,
`0013_no_ebook_step.sql` e `0014_test_step_look_audio.sql` mudam a ordem e o número das etapas e
acertam o progresso dos alunos. Publique os Workers do admin e do aplicativo e gere uma
publicação de conteúdo pelo admin para atualizar a trilha. Não execute seed remoto.

Validação de navegador: `npx tsx tools/e2e/src/episodeSmoke.ts` usa o slot local 9, sem tocar
em produção. As capturas ficam em `tools/e2e/out/episodes/`.
