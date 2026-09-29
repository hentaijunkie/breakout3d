# ROADMAP - Projeto Arkanoid / Breakout 3D

## 🟢 Concluído — engenharia reversa do arcade

Detalhes e endereços em [docs/ARCADE_RE.md](docs/ARCADE_RE.md).

- [x] Hardware de vídeo reimplementado (`tools/arcade_gfx.py`): tiles, sprites, paleta e
      rotação reproduzem os quadros do MAME com 0 pixels de diferença.
- [x] Descoberto que as tabelas de velocidade e cápsulas usadas antes eram do **MSX** e não
      existem na ROM do arcade. Substituídas pelas do arcade (`arkanoid_arcade.js`,
      35/35 conferidas byte a byte por `tools/verify_arcade_tables.py`):
  - 32 direções e níveis de velocidade discretos (Round 1 ≈ 178 px/s, não 87);
  - aceleração por contagem de toques e ao encostar no teto;
  - 6 zonas na Vaus, 3 ângulos por lado (63,4°, 36,9°, 26,6°);
  - reflexões de parede, teto e tijolo (incluindo cantos) como a ROM calcula.
- [x] Cápsulas: quais tijolos soltam é fixo na fase (bit do byte do tijolo, que o builder
      antigo descartava); o tipo vem do registrador R do Z80; B/P re-sorteados pelo placar;
      nada cai durante o Disruption; toda cápsula desfaz o modo anterior.
- [x] Laser com dois slots e impacto de 11 quadros; Disruption em D−1, D, D+1; portal com
      +10.000; Catch que solta sozinho em 2 s; vidas extras em 20/60 mil e a cada 60 mil.
- [x] Velocidade inicial e resistência do prata por round, fundos por `(round−1) & 3`.
- [x] Tempos de introdução, morte e troca de round medidos no MAME.
- [x] Sprites e animações identificados: Vaus (aparição, brilho, laser, alargada, explosão),
      cápsulas (8 quadros), textos, inimigos, explosões, portas e portal.

## 🟢 Concluído — réplica

- [x] `arkanoid_arcade_engine.js`: porta quadro a quadro da lógica do Z80. Validada contra uma
      partida real gravada no MAME: 28.160 quadros, rounds 1–9, 0 divergências.
- [x] `arkanoid_classic.html` reescrita: desenha como o hardware (tilemap + sprites) com os
      gráficos gerados da ROM do usuário; 37 quadros idênticos ao MAME. Sem os assets,
      reconstrução com a mesma geometria.
- [x] Passo fixo na taxa do vídeo do arcade, recorde salvo, escala inteira responsiva.

## 🟢 Concluído — revisão de código

- [x] Bola duplicada no Disruption (as três versões).
- [x] 3D: colisão com inimigos/DOH alterava a velocidade sem mudar a direção.
- [x] Neon: alvo do teclado sem limite; portal aberto depois de morrer; prata no laser valendo
      50; cores de B/P trocadas; textos e comentários desatualizados; código morto.
- [x] 3D: uma luz por bola (recompilava shaders), um material por tijolo, rótulo do link.
- [x] Teclas presas ao perder o foco (as três versões).
- [x] Testes: comparação das fases nos dois sentidos; builder aborta em divergência;
      `verify_classic.js` roda a página de verdade; caminhos portáveis.
- [x] Scripts de uso único e backups em `archive/`; `.gitignore` protege ROMs e assets;
      servidor local só em 127.0.0.1.

## 🟡 Em aberto

- [ ] **Inimigos**: portar a navegação real (`0x36A5…0x3E40`, quatro tipos). Hoje o motor
      reproduz portas, tempos, velocidade e animação, mas o caminho é simplificado — é o único
      ponto em que o replay contra o MAME precisa ressincronizar.
- [ ] **DOH**: portar o comportamento do chefe (`0x8809…`): boca, tiros, acertos.
- [ ] **Som**: os efeitos e músicas do AY-3-8910. A réplica usa beeps sintetizados.
- [ ] Primeira rodada após a ficha: o texto "ROUND 1" aparece 4 quadros após montar a fase
      (nos demais rounds, 33); a réplica usa 33 sempre.
- [ ] Modo atract (demo), entrada de iniciais no recorde, continue.
- [ ] Controle tipo spinner com pointer lock (movimento relativo, como o arcade).

## 🔴 Backlog
- [ ] High Score com persistência remota.
- [ ] Suporte PWA para jogar offline no mobile.
