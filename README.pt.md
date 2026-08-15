# dsh-wsl-workspace

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)

![alt text](image-3.png)
Adicione um espaço de trabalho WSL a partir da interface web do DeepSeek Harness e execute toda a sessão do agente — comandos bash e leitura/escrita de arquivos — dentro de uma distribuição WSL local com caminhos em formato Linux. Não é necessário instalar nada dentro do WSL. A sessão pode acessar WSL e Windows ao mesmo tempo: os comandos bash são executados dentro da distribuição WSL, enquanto os arquivos do Windows continuam acessíveis via `/mnt/<unidade>` (por exemplo `/mnt/c/Users/...`).

## Instalação

Escolha um dos três métodos abaixo e reinicie o `dsh web`:

```powershell
# 1) Pacote npm
dsh plugin --profile web add dsh-wsl-workspace

# 2) Repositório GitHub (inclui lib/ pré-compilado, sem build local)
dsh plugin --profile web add https://github.com/6Mikao9/dsh-wsl-workspace

# 3) Diretório local (desenvolvimento / uso próprio)
dsh plugin --profile web add D:\path\to\dsh-wsl-workspace
```

Após reiniciar o `dsh web`, um botão W aparece ao lado de Settings na parte inferior da barra lateral.

## Uso

Clique no botão W ao lado de Settings na parte inferior da barra lateral para abrir o diálogo "Add WSL workspace". Escolha uma distribuição, navegue pela árvore de diretórios ou digite um caminho Linux absoluto (por exemplo `/home/me/proj`) — o botão Check verifica se o caminho existe antes de criar o espaço de trabalho. O diálogo segue o idioma da interface do DeepSeek Harness. O campo nome de usuário é opcional: deixe vazio para executar os comandos com o usuário padrão da distribuição, ou informe um usuário Linux dessa distribuição para executar a sessão como esse usuário (equivalente a `wsl.exe -u <usuário>`). O nome de usuário só altera a identidade de execução da ferramenta bash — as ferramentas de arquivo passam pelo compartilhamento WSL do lado do Windows e não são afetadas. O nome de usuário de cada espaço de trabalho fica em `<dshHome>/wsl-workspaces.json`; exclua a entrada (ou recrie o espaço de trabalho pelo diálogo) para voltar ao usuário padrão.

Clique em "Create & open" para iniciar uma nova sessão no espaço de trabalho. Na nova sessão, a ferramenta bash executa comandos dentro da distribuição escolhida e `read`/`write`/`edit` operam nos arquivos WSL, portanto cada caminho visto pelo modelo é um caminho Linux. O seletor de modos continua funcionando normalmente: Standard, PTC, Minimal e Creative caem automaticamente na sua variante WSL (as entradas de variante WSL no seletor são bilíngues, ex. `WSL · Standard mode（标准模式）`), e os arquivos do Windows continuam acessíveis a partir da sessão sob `/mnt/<unidade>` (por exemplo `/mnt/c/Users/...`).

![alt text](image-2.png)
## Notas de comportamento

- **Ferramenta bash**: é executada dentro da distribuição WSL com o nome de usuário configurado (vazio = usuário padrão da distribuição, geralmente `root`), podendo ler e escrever em qualquer lugar da distribuição. O sandbox de ACL do Windows não consegue envolver o `wsl.exe` — seus processos filhos rodam no lado do kernel Linux — então o WSL em si é a fronteira de isolamento e a política de arquivos do DSH não se aplica ao bash.
- **Ferramentas de arquivo (`read`/`write`/`edit`)**: passam pelo compartilhamento WSL 9P do lado do Windows e ficam sujeitas à política de arquivos do DSH. Com `workspace-write`, leituras funcionam em qualquer lugar, mas escritas ficam restritas ao espaço de trabalho da sessão; mude a política para `danger-full-access` para permitir também escritas fora dele. O campo nome de usuário não afeta as ferramentas de arquivo.
- O banner de encaminhamento de porta `localhost` (texto ilegível) que o `wsl.exe` imprime em stderr quando a distribuição ainda não estava em execução é inofensivo.

## Licença e atribuição

MIT — veja [LICENSE](LICENSE) e [NOTICE](NOTICE). O NOTICE lista com precisão:

- **Código-fonte adaptado/herdado**: DeepSeek Harness (MIT) — `dsh-bash-local` (mecânica do executor), `dsh-fs-local` (`WslFileSystem` o subclassifica) e os agent presets fornecidos (lidos e transformados pelo gerador de variantes);
- **Referências de design (nenhum código copiado)**: [dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal) (MIT, abordagem wsl argv/WSLENV), [dsh-side-panel](https://github.com/ccq1/dsh-side-panel) (BSD-3-Clause, padrão de rota do host), [vpshub](https://github.com/Sdongmaker/vpshub) (MIT, referência de roadmap).

Mantenha `LICENSE` e `NOTICE` ao redistribuir.

## Agradecimentos

Agradecimento especial a [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) (série de skins 鲸鱼娘 para DSH Web · 深海女仆工坊 maid-atelier, CC BY-NC-SA 4.0): o plugin de skins da garota-baleia traz um conjunto completo de skins adoráveis para a interface web do DeepSeek Harness e torna o uso diário do DSH mais acolhedor.
