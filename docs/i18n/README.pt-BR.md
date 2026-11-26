# opencode-win-guard

[English](../../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · **Português (Brasil)** · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md)

> Esta é uma tradução. A referência é o [README em inglês](../../README.md); onde houver divergência, vale o inglês.

Uma sandbox de escrita e uma parada de emergência para agentes do [opencode](https://opencode.ai) no **Windows**, para deixar agentes trabalhando sem supervisão em uma pasta de projeto. Sem direitos de administrador, sem Docker, sem WSL, sem acesso à rede.

![Um agente roteirizado escreve fora da sua pasta e é barrado pelo plugin e pelo Windows; depois lê um arquivo de chaves e para todos os agentes até que o usuário escreva](../media/demo.gif)

*Um agente roteirizado contra os plugins e o launcher reais em um `opencode serve` isolado.*

| Parte | O que faz |
|---|---|
| **Sandbox** (`win-guard-sandbox.js` + launcher) | Os agentes leem tudo, mas só escrevem dentro da pasta do projeto. Para `edit`/`write`, o plugin verifica o caminho real (com links resolvidos). Para o shell, **o próprio Windows** recusa toda escrita, exclusão e alteração de permissões fora da pasta: os comandos rodam com um token de integridade Low, e só a pasta do projeto e uma pasta de cache têm o rótulo Low. |
| **Arquivos secretos** (launcher, `secrets.txt`) | Arquivos com chaves e senhas (chaves SSH, credenciais de nuvem, chaves do navegador, a senha de serviço do próprio opencode...) recebem um rótulo obrigatório que programas Low não conseguem ultrapassar para ler. Seus próprios programas não são afetados. |
| **Limites** (launcher) | Cada comando roda em um job object: um teto rígido de memória que mantém uma quantidade definida de RAM livre para você, um mínimo de espaço livre em disco e um tamanho máximo para o projeto mais o cache. Acima de um limite, o comando é encerrado (código de saída 125). |
| **Killswitch** (`win-guard-killswitch.js`) | Verifica cada chamada **antes de ela rodar**: o comando de shell e os scripts do projeto que ele inicia (`build.ps1`, scripts de `npm test`...). Chamadas claramente nocivas (ler chaves, pedir ao Windows senhas salvas, apagar discos, desligar o Defender, controlar o opencode de fora...) param **todos os agentes da pasta** de uma vez. As arriscadas (baixar e executar um script sem olhar, enviar arquivos, entradas de inicialização automática) são recusadas. Um arquivo `STOP` no projeto, muitas chamadas recusadas ou o sumiço de uma grande parte dos arquivos do projeto também os param. A parada sobrevive a uma reinicialização do opencode até você escrever uma mensagem. |

Ele protege contra os erros de um agente e contra os comandos nocivos que ele pode ser convencido a executar. Não é uma muralha contra um programa escrito para escapar: leia o [modelo de segurança](../security-model.md) antes de confiar nele.

## Requisitos

- Windows 10 ou 11, NTFS.
- opencode 2.2 ou mais recente (API de plugins V2). Testado com opencode 2.2.3 no Windows 10 22H2.
- O compilador C# do .NET Framework 4 (`%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`). Ele faz parte do Windows, então não é preciso instalar nada: o instalador compila o launcher a partir dos fontes em [`launcher/`](../../launcher), e nenhum programa pré-compilado é baixado.
- Para bash: Git for Windows. O instalador o copia (cerca de 400 MB) para a pasta da sandbox, porque o Git Bash só inicia com integridade Low a partir de uma cópia própria. Sem ele (`-NoGit`), os agentes ficam com PowerShell e cmd.

## Instalação

Baixe o código-fonte da [versão mais recente](https://github.com/retretor/opencode-win-guard/releases/latest) (ou clone o repositório) e, no PowerShell:

```powershell
cd opencode-win-guard
.\install.ps1 -Folder C:\Users\me\Projects\my-project
```

O instalador compila o launcher em `~\.local\share\opencode\sandbox\bin`, copia o Git, cria `secrets.txt` e `~\.config\opencode\win-guard.json` a partir dos exemplos (os já existentes são mantidos), copia os plugins para `~\.config\opencode\plugins` e fecha os arquivos listados em `secrets.txt`. Depois:

1. **Leia `~\.local\share\opencode\sandbox\secrets.txt`** e adicione os arquivos com chaves e senhas do seu computador. `protect.exe --list` na pasta `bin` mostra o que está fechado.
2. Reinicie o opencode e inicie uma sessão na pasta do projeto. O log `~\.local\share\opencode\log\win-guard.log` diz `on for <folder>`.

Execute `install.ps1` de novo para atualizar; para remover tudo, `uninstall.ps1` (`-RemoveData` também apaga a cópia do Git, os caches e as configurações). Se o PowerShell se recusar a executar o script, inicie-o com `powershell -ExecutionPolicy Bypass -File .\install.ps1 ...`.

## Configurações: `~\.config\opencode\win-guard.json`

```json
{
  "folders": ["C:\\Users\\me\\Projects\\my-project"],
  "limits": { "ramFreeGB": 4, "diskFreeGB": 15, "folderGB": 15 },
  "agents": "*",
  "extraTools": [],
  "alsoWritable": [],
  "lowLabel": [],
  "env": {},
  "language": "en"
}
```

| Chave | Padrão | Significado |
|---|---|---|
| `folders` | (obrigatório) | Caminhos absolutos. Uma sessão iniciada em um deles (ou abaixo) é protegida; em qualquer outro lugar nada muda. Um drive inteiro, sua pasta de usuário ou uma pasta do sistema são recusados. |
| `limits.ramFreeGB` | 4 | Memória que sempre fica livre para você. Um comando espera até 60 s por ela para iniciar e é encerrado se a memória livre cair abaixo desse valor. |
| `limits.diskFreeGB` | 15 | Espaço livre que o drive da pasta mantém. |
| `limits.folderGB` | 15 | Tamanho máximo da pasta junto com o cache. |
| `agents` | `"*"` | Agentes protegidos: `"*"` para todos, ou uma lista de nomes. Os outros (seu próprio agente interativo, por exemplo) trabalham com direitos totais. Com uma lista, um agente protegido só pode iniciar subagentes dessa lista. |
| `extraTools` | `[]` | Ferramentas de outros plugins que os agentes podem usar. Toda ferramenta que não se sabe que não escreve nada é recusada, porque um plugin ou servidor MCP novo rodaria com direitos totais. Adicione um nome só se a ferramenta não escreve nada ou verifica as próprias escritas, por exemplo `["crew_list", "crew_send"]` para o [opencode-crew-mail](https://github.com/retretor/opencode-crew-mail). |
| `alsoWritable` | `[]` | Mais pastas que `edit` e `write` podem alterar (não o shell). |
| `lowLabel` | `[]` | Mais pastas que recebem o rótulo Low, para que programas na sandbox possam escrever nelas. Os caminhos podem começar com `%APPDATA%`, `%LOCALAPPDATA%` ou outra variável de ambiente. Útil para a pasta de dados de um programa compilado no projeto: esse programa roda com direitos reduzidos (também quando você mesmo o inicia) e pode falhar se não conseguir gravar suas configurações ou seus saves. Uma pasta que não existe é criada. |
| `env` | `{}` | Mais variáveis de ambiente para os comandos na sandbox, por exemplo `{ "CARGO_HOME": "${cache}/cargo" }`. `${cache}` é a pasta de cache do projeto, `${folder}` a pasta do projeto. A sandbox já move para lá os caches de npm, yarn, pnpm, bun, pip, uv, Poetry, Go, Gradle, NuGet e .NET, além de `TEMP`, `APPDATA` e `LOCALAPPDATA`. |
| `language` | `"en"` | Idioma do aviso de parada: `"en"`, `"zh-CN"`, `"ja"`, `"ko"`, `"es"`, `"pt-BR"`, `"de"`, `"fr"` ou `"ru"`. Outros são bem-vindos, veja [CONTRIBUTING.md](../../CONTRIBUTING.md#translations). |

Um arquivo de configurações com defeito não desliga a proteção: o shell é recusado e o log diz o motivo.

## O que os agentes veem

- Uma vez por sessão, eles são informados de onde podem escrever, de que arquivos secretos não podem ser abertos, dos limites e de que chamadas nocivas param todos.
- Uma chamada de ferramenta recusada retorna `Blocked: ...` com o motivo; recusas do Windows aparecem como "Access denied" no shell.
- Códigos de saída do launcher: **125** um limite ou `STOP` encerrou ou impediu o comando, **126** o comando não foi iniciado (sandbox incompleta). O comando nunca roda com direitos totais no lugar disso.
- Depois de uma parada de emergência, toda chamada falha com `EMERGENCY STOP: <reason>`, os agentes são interrompidos (os principais primeiro), e `AGENT_STOPPED.txt` no projeto diz o que aconteceu. Apague o arquivo `STOP`, se você criou um, e depois escreva qualquer mensagem em uma sessão da pasta.

## Pare os agentes você mesmo

Crie um arquivo chamado `STOP` na pasta do projeto. Os comandos em execução são encerrados em um ou dois segundos, novos não iniciam e todos os agentes da pasta são interrompidos.

## Trabalhando com outros plugins

- `globalThis[Symbol.for("opencode-win-guard.halted")]` é um `Set` das pastas que estão paradas (em minúsculas, com barras normais). Um plugin que continua agentes por conta própria (um piloto automático) deve olhar ali primeiro.
- Ferramentas de outros plugins precisam de `extraTools`, veja acima.

## Por que o launcher é escrito em C#

A sandbox precisa de funções do Windows que nenhum script consegue chamar diretamente: um token restrito com nível de integridade Low, `CreateProcessAsUser`, job objects com limites de memória e rótulos obrigatórios em arquivos. O C# chega a elas com P/Invoke simples, e seu compilador vem com todo Windows 10 e 11 como parte do .NET Framework. Assim, o launcher é compilado a partir dos fontes legíveis no seu próprio computador durante a instalação, sem SDK, sem download e sem nenhum programa não assinado vindo da internet. O código se limita a C# 5 para que esse compilador antigo consiga compilá-lo.

## Testes

```powershell
npm test                                   # pure parts, any OS
$env:WIN_GUARD_E2E = "1"; npm run test:e2e # also the launcher and both plugins in a real `opencode serve` with a fake model
```

Os testes de ponta a ponta trabalham em pastas temporárias com seu próprio arquivo de segredos, compilam o launcher para si mesmos e restauram todos os rótulos que definem. Eles não tocam sua configuração, suas sessões nem sua sandbox do opencode, e não precisam de provedor nem de conta.

## Projetos relacionados

Encontrados em novembro de 2026; nenhum deles coloca o shell em sandbox no Windows nem para uma árvore de sessões inteira:

- [opencode-sandbox](https://github.com/Hamza-Abili/opencode-sandbox): uma sandbox do sistema operacional para o shell com bubblewrap (Linux) e Seatbelt (macOS); o Windows nativo não é suportado.
- [opencode-guard](https://github.com/gigi206/opencode-guard): negar/perguntar com base em regras para chamadas de ferramentas, mais um modelo de decisão opcional, e ocultação de segredos antes que cheguem ao modelo.
- [opencode-hook-safety](https://github.com/MansM/opencode-hook-safety): listas de bloqueio para caminhos secretos e comandos destrutivos, classificador opcional.
- [opencode-damage-control](https://github.com/nicounii/opencode-damage-control): bloqueia mais de 90 padrões de comandos perigosos, três níveis de proteção de caminhos.

Eles trabalham no nível do texto dos comandos e dos caminhos; combinam bem com este, que acrescenta a recusa do próprio sistema operacional.

## Contribuindo

Relatos de bugs, ideias e pull requests são bem-vindos: veja [CONTRIBUTING.md](../../CONTRIBUTING.md). Formas de burlar a sandbox: por favor, reporte-as em privado, veja [SECURITY.md](../../SECURITY.md).

## Licença

[MIT](../../LICENSE)
