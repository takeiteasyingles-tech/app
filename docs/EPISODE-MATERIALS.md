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

O aluno responde **6 questões** por episódio. Se o editor tiver mais, a publicação escolhe seis:
primeiro as do próprio episódio (campo "Episódio" da questão), uma de cada parte por vez (Parte A,
B, C, D, A…), e completa com as de outros episódios se faltar. A nota de corte é ajustada na mesma
proporção (14 de 20 vira 5 de 6). Para escolher exatamente quais aparecem, deixe só seis no editor.

## Take Some Extras (fim de cada episódio)

Na tela de conclusão de **todo episódio** o aluno vê "Take some extras · opcionais": **Take Five** (páginas
culturais), **Take the Lead** (conversa com a Margaret), **Take it for Real** (o livro × a rua) e **Take It
Out** (quadrinhos, em produção). Todos começam iguais (cópia do e-book 1). No admin, o botão **Take Some
Extras** do card de materiais abre a aba **Quais aparecem** (liga e desliga cada um) e as abas com o conteúdo
de cada extra. Salvar já vale para os alunos.

## Vozes da lição

Em **Geral → Vozes desta lição** cada episódio escolhe a voz da ElevenLabs dos seus áudios: a
**Narração** (vocabulário visual, frases do Take the Mic, Take Away e áudios dos exercícios) e uma
voz para cada personagem da lista Personagens (as falas do Take It In). A lista mostra as vozes da
conta ElevenLabs (clonadas e as já adicionadas); **Biblioteca…** busca vozes compartilhadas, toca a
amostra e adiciona a escolhida à conta. **Ouvir** toca a voz lendo uma frase da própria lição. O que
ficar sem escolha usa a voz do curso, definida em **Configurações → Vozes** (Narração do curso e uma
voz por personagem). Vale para os alunos depois de publicar.

Detalhes em `docs/spec/05-foundation-notes.md`, linhas "Step order", "No e-book" e
"In this episode, Take a Look, Take the Test (0014)", "Take the Test: six questions" e "Lesson voices (0016)".

## Migração e publicação

Aplique as migrações pendentes antes de publicar o código novo: `0012_presentation_step.sql`,
`0013_no_ebook_step.sql` e `0014_test_step_look_audio.sql` mudam a ordem e o número das etapas e
acertam o progresso dos alunos; `0015_character_voices_default.sql` liga a voz dos personagens e
`0016_episode_voices.sql` cria as vozes da lição. Publique os Workers do admin e do aplicativo e gere uma
publicação de conteúdo pelo admin para atualizar a trilha. Não execute seed remoto.

Validação de navegador: `npx tsx tools/e2e/src/episodeSmoke.ts` usa o slot local 9, sem tocar
em produção. As capturas ficam em `tools/e2e/out/episodes/`.
