# Arkanoid (arcade, Taito 1986) — engenharia reversa

Notas do que foi lido no programa Z80 do arcade (`a75-01-1.ic17` + `a75-11.ic16`, conjunto
`arkanoid` do MAME) e confirmado rodando o jogo no MAME. Os endereços são da ROM do arcade.

> **Correção importante.** As tabelas de velocidade e de cápsulas que o projeto usava
> antes vinham do *disassembly do port de MSX*. Nenhuma delas existe na ROM do arcade
> (`tools/verify_arcade_tables.py` procura os bytes). O modelo do arcade é outro e está
> descrito abaixo; o antigo foi para `archive/msx_model/`.

## Como foi verificado

| O quê | Ferramenta | Resultado |
|---|---|---|
| Decodificação de tiles, sprites e paleta | `tools/arcade_gfx.py verify` (renderiza a VRAM despejada e compara com o snapshot do MAME) | **0 pixels** diferentes em todos os quadros testados |
| Tabelas e constantes de `arkanoid_arcade.js` | `tools/verify_arcade_tables.py` (relê a ROM nos endereços citados) | 35/35 conferem |
| Fases (cores, cápsulas, prata) | `tools/build_arcade_levels.py` + `tools/verify_all_rounds.py` | 0 divergências RAM×tela; 291.480 pixels e 7.488 células, nos dois sentidos |
| Fundos, sombras, ícones | `tools/build_rom_assets.py` (reconstrói o playfield de cada round e compara com a VRAM) e as 2.086 restaurações de tile de uma partida gravada | 0 divergências |
| Lógica do jogo | `tools/verify_engine_replay.js` roda uma partida gravada no MAME (`tools/mame/autoplay.lua`) dentro de `arkanoid_arcade_engine.js`, quadro a quadro | 28.160 quadros de jogo, rounds 1–9, **0 divergências** (97 ressincronizações em contatos com inimigos, que são modelados) |
| Réplica desenhada | `tools/verify_replica_pixels.html` | 37 quadros idênticos ao MAME (intro com sprites + tiles dos 33 rounds) |

## Vídeo

- Tilemap 32×32 de tiles 8×8 em `0xE000` (2 bytes por célula: atributo = cor<<3 | bits 8-10
  do código; código). Sprites: 16 × 4 bytes em `0xE800` (x, 248−y, atributo, código); cada
  sprite são dois tiles empilhados (`2k` e `2k+1`).
- 4096 tiles de 3 bits: `a75-05` = bit 2, `a75-04` = bit 1, `a75-03` = bit 0.
- Paleta de 512 cores nas PROMs `a75-07/08/09`, 4 bits por canal em escada de resistores:
  pesos 0x0E, 0x1F, 0x43, 0x8F (reproduz exatamente as cores medidas, ex.: prata 157).
- `0xD008`: bit 5 banco de gráficos, bit 6 banco de paleta (o round do DOH usa o banco 1).
- Monitor girado: o jogador vê 224×256. Coordenadas "nativas" dos sprites: `nx` = y do
  jogador; `s1` = x do jogador + 16. Célula de tile do jogador (c, r) = nativa (r, 29−c).
- Sombras: o tijolo escurece a célula de fundo **um tile à direita e um abaixo**, trocando a
  cor do tile pela "cor de sombra" do fundo (28→5, 29→6, 30→7). As paredes sombreiam a
  coluna 1 e a linha 3. A Vaus, a bola e as cápsulas têm sombra própria no sprite (cor 8).
- 4 fundos, escolhidos por `(round−1) & 3`; o DOH tem o seu.

## RAM

| Endereço | Conteúdo |
|---|---|
| `C43D`, `C449`, `C455` | objetos das 3 bolas (12 bytes: flags, nibbles, nível, direção D, nº de sprites, contador de quadros, fase, x/y novos, x/y de referência, trava de segurar) |
| `C46B..C46D` | bola ativa |
| `C4A5`, `C4A9`, `C4AD` | sprites das bolas (cópia de `0xE800` em `C47D`) |
| `C43A` / `C43B` | `s1` dos sprites direito/esquerdo da Vaus |
| `C462` | nível de velocidade (compartilhado pelas bolas) |
| `EF63` | contador de toques para acelerar |
| `C47C` / `C461` | leitura do spinner neste/no último quadro (Vaus anda a diferença) |
| `C47A` | deslocamento da bola presa em relação à Vaus |
| `C463` / `C465` | modo alvo / modo atual da Vaus (1 laser, 2 alargada, 3 catch; bit 7 = transformando) |
| `C658` / `C659` | cápsula pendente-ou-caindo (bit 7 = caindo) / última capturada |
| `C469` | 2 = Disruption ativo |
| `C474` | 7 = já caiu um P nesta vida |
| `C4CE` | portal (Break) aberto |
| `C665`, `C667` | os dois tiros de laser |
| `C4D7..C4D9` | placar ÷ 10 em BCD |
| `ED71` / `ED72` | vidas / round − 1 |
| `ED83` | tijolos restantes (zerar faz o jogo passar de round) |
| `ED8B` | grade de tijolos 13 × 18 (linha 0 = y 24) |
| `C4C0` | trava do botão |

## Bola

- **Direção**: índice D de 0 a 31, em sentido horário a partir de "para cima". `D>>3` é o
  quadrante (`0x127A`: flags subir/esquerda). `D & 15` escolhe um par de "classes de
  velocidade" (`0x126A`): nibble alto = eixo vertical, baixo = horizontal. As classes 1, 5,
  7 e F andam 1/4, 1/2, 3/4 e 1 do passo base.
- **Velocidade**: nível L; o passo base é L/2 px por quadro (níveis ímpares alternam). A
  rotina `0x11BF` faz a conta inteira com as tabelas `0x1227..0x124E` e um contador de fase
  de 4 quadros. Por isso a velocidade escalar muda com o ângulo (45° é o mais rápido).
- **Início**: cada round começa num nível lido na RAM ao montar a fase (5, 6 ou 7 —
  `ARKANOID_ARCADE_ROUNDS[].speed`). Na Round 1 a bola sobe a **3 px/quadro** (~178 px/s).
- **Aceleração** (`0x0900`): `EF63` conta tijolos quebrados, toques em prata/ouro e
  quiques em parede/teto. Ao atingir `0x094C[L]` (25, 25, 35, 35, 45, 60, 80, 120…),
  na próxima vez que a bola estiver subindo o nível sobe 1 (máx. 14), o contador zera e a
  direção dá um passo em direção à diagonal.
- **Teto** (`0x1447`): encostar no teto eleva o nível a pelo menos `0x1462[round]`
  (7 na maioria dos rounds) — a famosa aceleração ao chegar no topo.
- **Rasantes** (`0x10D0`): direções quase horizontais (`D & 15` em 6..10) andam 2 níveis
  mais rápido.
- **Paredes** (`0x141B`): esquerda em `s1 ≤ 0x1C`, direita em `s1 > 0xE0`, teto em
  `nx ≤ 0x1C`; a reflexão é o espelho `0x14BA`.

## Vaus

- 32 px (dois sprites), 48 px alargada (três). Limites `s1` 0x16..0xD9. Anda exatamente a
  diferença do spinner.
- **Zonas** (`0x1318`): mede a distância até a ponta mais próxima: menos de 3 px = ponta,
  menos de 8 = meio, resto = centro. Só **3 ângulos por lado**: centro 63,4°, meio 36,9°,
  ponta 26,6° (direções 2/5/6 à direita, 30/27/26 à esquerda). A bola nasce no centro-direito:
  direção 2.
- Girar forte (16+ contagens no quadro) arrasta a bola 3 px.
- **Catch**: segura por 120 quadros (`0x13CC`) e solta sozinha; o botão solta antes.
- A bola do início do round também fica presa 120 quadros.

## Tijolos

- Byte do tijolo: bits 2–7 = cor (ou acertos restantes do prata), bits 0–1: `01` comum,
  `02` **comum que solta cápsula**, `03` prata; `FF` = ouro.
- Quais tijolos soltam cápsula é fixo na fase (Round 1: 39 de 78; Round 11: nenhum;
  Round 16: 72 de 78). O `build_arcade_levels.py` antigo descartava esse bit.
- Prata aguenta 2/3/4/5 acertos (rounds 1–8/9–16/17–24/25–32) e vale 50 × round (`0x5A73`);
  as cores valem 50..120 (`0x5A63`); o ouro não quebra. Ao ser atingido, prata/ouro brilha:
  tiles +2, +4, … +10 por 3 quadros cada.
- **Colisão** (`0x56C0`): a bola testa só as fronteiras de célula que cruzou no quadro
  (linha a cada 8 px, coluna a cada 16 px), pelo canto superior esquerdo do sprite; cruzar
  as duas testa os vizinhos da diagonal (`0x584C`) e bater no canto devolve a bola.

## Cápsulas

- Tipos (`0x5474`): 1 L (laser), 2 E (alarga), 3 C (catch), 4 S (lenta: nível −2),
  5 B (portal), 6 D (disruption), 7 P (vida).
- **Sorteio** (`0x5916`): só tijolos marcados, nunca com outra cápsula caindo, nunca
  durante Disruption. O tipo é `ld a,r` — o registrador de refresh do Z80, na prática
  aleatório — com 3 bits: 0 = nada; igual à última capturada = D; B ou P são re-sorteados
  pelo dígito das centenas do placar; um segundo P na mesma vida vira E. Resultado:
  L 17,5 %, E/C/S/D 15 % cada, B e P 2,5 % cada, nada 17,5 %.
- Cai 1 px por quadro; é capturada com `nx` em 0xE2..0xEB. Toda captura vale 1.000, solta a
  bola presa e **desfaz o modo anterior** antes de aplicar o seu.
- **Laser** (`0x5140`): dois "slots"; cada tiro são dois feixes 12 px apart, 5 px por
  quadro; ao acertar fica 11 quadros mostrando o impacto e ocupa o slot.
- **Disruption** (`0x0A19`): no quadro seguinte a bola vira três, nas direções D−1, D, D+1.
  Acaba quando sobra uma bola.
- **Break** (`0x0D15`): abre o portal; a *Vaus* sai pela direita e ganha 100 × 100 pontos.
- **Vidas extras** (`0x27F5`): 20.000, 60.000 e depois a cada 60.000.
- Botão: `C4C0` guarda a porta quando ela muda; um toque fica pendente até ser consumido
  (soltar a bola ou disparar) ou até soltar o botão.

## Fluxo

- Round montado → 33 quadros → "ROUND n" (sprites 0x1D8…) → +30 "READY" → +49 some →
  Vaus materializa (0xE8…0xF0, ~30 quadros) → bola aparece 36 quadros depois.
- Último tijolo: o jogo segue 25 quadros e monta o próximo round.
- Bola perdida: 11 quadros parada, Vaus pisca (0x106, 0x108), explosão em 4 etapas
  (0x10A…0x129), e a vida é descontada 145 quadros depois.

## Inimigos e DOH (modelados)

- Até 3 inimigos, tipo por `(round−1) & 3` (sprites 0x170, 0x15A, 0x12A, 0x146), entrando
  pelas portas do topo (x 48 e 160; tiles de porta 0x124 → 0x15A, 4 quadros por etapa) a
  ~0,5 px/quadro. Aparecem ~135 quadros após o início do round (~1.950 nos rounds 1, 10,
  12, 18 e 29). Valem 100; encostar na Vaus os destrói. A navegação real (`0x36A5…`) não
  foi portada: a réplica usa uma versão simplificada.
- DOH: a arte e a paleta vêm da ROM; o comportamento (16 acertos, tiros) é modelado.

## Reproduzir

Com o MAME 0.289 na raiz do projeto e as ROMs em `roms/` (Git Bash):

```bash
# fases, VRAM e snapshots de todos os rounds
./mame.exe arkanoid -rompath roms -video none -sound none -nothrottle -skip_gameinfo -snapname rip/%i -autoboot_script tools/mame/rip_all.lua
```

```bash
# uma partida jogada sozinha, gravada quadro a quadro
LOGFILE=partida.txt FRAMES=30000 ./mame.exe arkanoid -rompath roms -video none -sound none -nothrottle -skip_gameinfo -autoboot_script tools/mame/autoplay.lua
```

```bash
node tools/verify_engine_replay.js partida.txt
```
