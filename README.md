# 🎮 Arkanoid & Breakout Arcade (2D & 3D)

Projeto de engenharia reversa e tributo ao Arkanoid (Taito, 1986). As fases, a física da
bola, as zonas da Vaus, a pontuação e as cápsulas foram lidas **do programa Z80 do arcade**
e conferidas contra o jogo rodando no MAME. Os detalhes estão em
[docs/ARCADE_RE.md](docs/ARCADE_RE.md).

> Versões anteriores usavam tabelas de velocidade e de cápsulas tiradas do *port de MSX*.
> Elas não existem na ROM do arcade e foram substituídas (o modelo antigo está em
> `archive/msx_model/`).

---

## 🕹️ As três experiências

### 1. `arkanoid_classic.html` — réplica do arcade
- O jogo é `arkanoid_arcade_engine.js`: uma porta das rotinas do Z80, quadro a quadro,
  nas coordenadas e na aritmética inteira do hardware, a 59,185 Hz como o vídeo original.
- Com `generated/arkanoid_rom_assets.js` (gerado a partir das **suas** ROMs, veja abaixo)
  a tela usa os tiles, sprites e a paleta originais: fundos, paredes, sombras, HUD, Vaus,
  cápsulas, textos "ROUND/READY", portas, portal e o DOH. Sem o arquivo, desenha uma
  reconstrução com a mesma geometria (`?norom` força esse modo).
- Exato: movimento e aceleração da bola, zonas da Vaus, quiques, tijolos (prata, ouro,
  brilho), pontuação, cápsulas (quais tijolos soltam, sorteio, queda, efeitos), laser,
  alargar, catch, disruption, portal, vidas extras, tempos de início/morte/troca de round.
- Modelado: o caminho dos inimigos e a luta com o DOH.

### 2. `index.html` — Neon
Tributo 2D com visual cyberpunk que roda as **mesmas regras** (`arkanoid_arcade.js`):
32 direções, níveis de velocidade, aceleração por toques e no teto, 6 zonas na Vaus,
cápsulas só dos tijolos marcados, pontos e vidas extras do arcade. O visual (brilho,
partículas) é assumidamente não fiel à época.

### 3. `breakout3d.html` — 3D
Interpretação volumétrica em Three.js com as mesmas regras, física travada no plano Z = 0
em passo fixo, bloom e estilhaços 3D. Inimigos e o DOH (round 33) são desta versão.

---

## 🚀 Como executar

```bash
python -m http.server 8000 --bind 127.0.0.1
```

- Réplica: http://localhost:8000/arkanoid_classic.html
- Neon: http://localhost:8000/index.html
- 3D: http://localhost:8000/breakout3d.html

O `--bind 127.0.0.1` importa: esta pasta também tem as ROMs e o MAME, e sem ele o servidor
fica acessível a toda a rede local.

### Gráficos originais na réplica

```bash
python tools/build_rom_assets.py
```

Lê `roms/arkanoid.zip` e `tools/mame/arcade_rip.txt` e grava
`generated/arkanoid_rom_assets.js`. O script se autoverifica: reconstrói o playfield de
todos os rounds e compara com a VRAM do arcade célula a célula. **O arquivo gerado é
derivado de dados com copyright da Taito: é só para uso local e está no `.gitignore`.**

---

## 🧩 Arquivos

| Arquivo | Conteúdo |
|---|---|
| `arkanoid_arcade.js` | Regras do arcade lidas da ROM (direções, velocidades, zonas, pontos, cápsulas), com o endereço de cada tabela |
| `arkanoid_arcade_engine.js` | O jogo da réplica, sem DOM |
| `arkanoid_levels_arcade.js` | As 32 fases do arcade (13 colunas), quais tijolos soltam cápsula e os dados de cada round (velocidade inicial, resistência do prata, fundo) — gerado |
| `arkanoid_bricks.js` | Cores, bevel e desenho dos tijolos, compartilhados |
| `arkanoid_levels_msx.js` | Tabela de fases do MSX, só como referência |

## 🔬 Verificação

| Comando | O que confere |
|---|---|
| `python tools/verify_arcade_tables.py` | Cada tabela e constante de `arkanoid_arcade.js` contra os bytes da ROM |
| `node tools/verify_arcade_rules.js` | O comportamento das funções de regra usadas pelo Neon e pelo 3D |
| `node tools/verify_engine_replay.js <gravação>` | O motor contra uma partida real gravada no MAME, quadro a quadro |
| `node tools/emit_expected_pixels.js` e `python tools/verify_all_rounds.py` | Os tijolos de todas as fases contra os quadros do MAME, pixel a pixel e célula a célula, nos dois sentidos |
| `node tools/verify_classic.js` | A página da réplica (modo sem ROM) pinta a Round 1 onde o arcade pinta |
| `/tools/verify_replica_pixels.html` (no navegador) | A réplica com os gráficos da ROM contra quadros do MAME (intro e os 33 rounds) |
| `python tools/build_arcade_levels.py` | Regenera as fases a partir do rip; aborta em qualquer byte sem cor ou divergência RAM × tela |

Resultados atuais: 35/35 constantes conferem com a ROM; 28.160 quadros de uma partida real
sem nenhuma divergência (fora contatos com inimigos, que são modelados); 291.480 pixels e
7.488 células das fases idênticos; 37 quadros da réplica idênticos ao MAME.

## 🛠️ Ferramentas de MAME (`tools/mame/`)

| Script | O que faz |
|---|---|
| `rip_all.lua` | Percorre os 33 rounds zerando `BRICKS_LEFT` e grava grade, VRAM, velocidade inicial e um snapshot de cada (`-snapname rip/%i`) |
| `autoplay.lua` | Joga sozinho (movendo a Vaus pelo spinner) e grava sprites, RAM e VRAM quadro a quadro, para análise e para o replay |
| `vram_dump.lua` | Despeja VRAM e sprites em quadros escolhidos, com snapshot (usado para a tela de título e a intro) |
| `trace.lua` | Registra RAM por quadro e quem escreve num intervalo de endereços (PC, IX, IY) |
| `dump.lua`, `play.lua`, `demo.lua`, `gold_anim.lua` | Despejo de RAM, início de partida, modo atract, animação do ouro |

`tools/arcade_gfx.py` reimplementa o hardware de vídeo (tiles, sprites, paleta) e verifica
contra os snapshots. Para rodar o MAME é preciso `roms/m68705p5.zip` com um `bootstrap.bin`
de 115 bytes (região do MCU não usada em operação normal).

`archive/` guarda os scripts de uso único, o modelo do MSX e backups antigos.

## 📝 Licença
Desenvolvido para fins educacionais de engenharia reversa. Arkanoid é © Taito. Este
repositório não contém ROMs nem gráficos do jogo; eles ficam na sua máquina.
