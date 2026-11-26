# opencode-win-guard

[English](../../README.md) · **简体中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md)

> 这是译文。原文为[英文 README](../../README.md)；两者不一致时，以英文版为准。

面向 **Windows** 上 [opencode](https://opencode.ai) 代理的写入沙箱和紧急停止，让代理可以在项目文件夹中无人值守地工作。无需管理员权限，无需 Docker，无需 WSL，不访问网络。

![一个脚本化代理在其文件夹之外写入，被插件和 Windows 拒绝；随后它读取一个密钥文件，于是所有代理都被停止，直到用户发送消息](../media/demo.gif)

*在隔离的 `opencode serve` 中，一个脚本化代理针对真实插件和启动器运行。*

| 组成部分 | 作用 |
|---|---|
| **沙箱**（`win-guard-sandbox.js` + 启动器） | 代理可以读取一切，但只能在项目文件夹内写入。对于 `edit`/`write`，插件会检查真实路径（链接会被解析）。对于 shell，由 **Windows 本身**拒绝文件夹之外的所有写入、删除和权限更改：命令以 Low 完整性令牌运行，而只有项目文件夹和一个缓存文件夹带有 Low 标签。 |
| **机密文件**（启动器、`secrets.txt`） | 存放密钥和密码的文件（SSH 密钥、云服务凭据、浏览器密钥、opencode 自身的服务密码……）会被加上强制标签，Low 程序无法越过它读取。你自己的程序不受影响。 |
| **限制**（启动器） | 每条命令都在作业对象（job object）中运行：硬性内存上限，为你始终保留一定量的空闲内存；最低磁盘剩余空间；项目加缓存的最大大小。超出限制时命令会被终止（退出码 125）。 |
| **紧急开关**（`win-guard-killswitch.js`） | 在每次调用**运行之前**进行检查：shell 命令，以及它启动的项目脚本（`build.ps1`、`npm test` 脚本……）。明显有害的调用（读取密钥、向 Windows 索取已保存的密码、擦除磁盘、关闭 Defender、从外部控制 opencode……）会立即停止**该文件夹的所有代理**。有风险的调用（未经查看就下载并运行脚本、上传文件、添加自启动项）会被拒绝。项目中出现 `STOP` 文件、被拒绝的调用过多，或项目的大部分文件消失，也会停止代理。停止状态在 opencode 重启后依然保持，直到你发送一条消息。 |

它能防范代理的失误，以及代理可能被诱导执行的有害命令。它不是一堵能挡住专门为突破而编写的程序的墙：在依赖它之前，请阅读[安全模型](../security-model.md)。

## 要求

- Windows 10 或 11，NTFS。
- opencode 2.2 或更高版本（V2 插件 API）。已在 Windows 10 22H2 上用 opencode 2.2.3 测试。
- .NET Framework 4 的 C# 编译器（`%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`）。它是 Windows 的一部分，因此无需安装任何东西：安装程序会用 [`launcher/`](../../launcher) 中的源代码构建启动器，不会下载任何预编译程序。
- 使用 bash 需要 Git for Windows。安装程序会把它（约 400 MB）复制到沙箱文件夹中，因为 Git Bash 只有从它自己的副本启动时才能以 Low 完整性运行。没有它（`-NoGit`）时，代理使用 PowerShell 和 cmd。

## 安装

下载[最新版本](https://github.com/retretor/opencode-win-guard/releases/latest)的源代码（或克隆仓库），然后在 PowerShell 中执行：

```powershell
cd opencode-win-guard
.\install.ps1 -Folder C:\Users\me\Projects\my-project
```

安装程序会把启动器构建到 `~\.local\share\opencode\sandbox\bin`，复制 Git，根据示例创建 `secrets.txt` 和 `~\.config\opencode\win-guard.json`（已有的文件会保留），把插件复制到 `~\.config\opencode\plugins`，并封锁 `secrets.txt` 中列出的文件。然后：

1. **阅读 `~\.local\share\opencode\sandbox\secrets.txt`**，并添加你电脑上存放密钥和密码的文件。`bin` 文件夹中的 `protect.exe --list` 会显示哪些文件已被封锁。
2. 重启 opencode，并在项目文件夹中启动一个会话。日志 `~\.local\share\opencode\log\win-guard.log` 中会出现 `on for <folder>`。

再次运行 `install.ps1` 即可更新；要移除全部内容，运行 `uninstall.ps1`（`-RemoveData` 还会删除 Git 副本、缓存和设置）。如果 PowerShell 拒绝运行该脚本，请用 `powershell -ExecutionPolicy Bypass -File .\install.ps1 ...` 启动。

## 设置：`~\.config\opencode\win-guard.json`

```json
{
  "folders": ["C:\\Users\\me\\Projects\\my-project"],
  "limits": { "ramFreeGB": 4, "diskFreeGB": 15, "folderGB": 15 },
  "agents": "*",
  "extraTools": [],
  "alsoWritable": [],
  "lowLabel": [],
  "env": {},
  "language": "en",
  "killswitch": "on"
}
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `folders` | （必填） | 绝对路径。在其中某个文件夹（或其子文件夹）中启动的会话会受到保护；其他任何地方都不受影响。整个驱动器、你的用户文件夹或系统文件夹会被拒绝。 |
| `limits.ramFreeGB` | 4 | 始终为你保留的空闲内存。命令启动前最多等待 60 秒以获得这部分内存；如果空闲内存低于该值，命令会被终止。 |
| `limits.diskFreeGB` | 15 | 文件夹所在驱动器保留的剩余空间。 |
| `limits.folderGB` | 15 | 文件夹连同其缓存的最大大小。 |
| `agents` | `"*"` | 受保护的代理：`"*"` 表示全部，或者一个名称列表。其他代理（比如你自己的交互式代理）以完整权限工作。使用列表时，受保护的代理只能启动该列表中的子代理。 |
| `extraTools` | `[]` | 允许代理使用的其他插件的工具。凡是不能确认不写入任何内容的工具都会被拒绝，因为新插件或 MCP 服务器会以完整权限运行。只有当工具不写入任何内容，或会自行检查其写入时，才添加它的名称，例如为 [opencode-crew-mail](https://github.com/retretor/opencode-crew-mail) 添加 `["crew_list", "crew_send"]`。 |
| `alsoWritable` | `[]` | `edit` 和 `write` 还可以修改的其他文件夹（不适用于 shell）。 |
| `lowLabel` | `[]` | 额外加上 Low 标签的文件夹，使沙箱中的程序可以在其中写入。路径可以以 `%APPDATA%`、`%LOCALAPPDATA%` 或其他环境变量开头。适用于在项目中构建的程序的数据文件夹：这样的程序以降低的权限运行（你自己启动它时也是如此），如果无法写入其设置或存档，就可能出错。不存在的文件夹会被创建。 |
| `env` | `{}` | 为沙箱中的命令额外设置的环境变量，例如 `{ "CARGO_HOME": "${cache}/cargo" }`。`${cache}` 是项目的缓存文件夹，`${folder}` 是项目文件夹。沙箱已经把 npm、yarn、pnpm、bun、pip、uv、Poetry、Go、Gradle、NuGet 和 .NET 的缓存，以及 `TEMP`、`APPDATA` 和 `LOCALAPPDATA` 移到那里。 |
| `language` | `"en"` | 停止说明的语言：`"en"`、`"zh-CN"`、`"ja"`、`"ko"`、`"es"`、`"pt-BR"`、`"de"`、`"fr"` 或 `"ru"`。欢迎添加更多语言，参见 [CONTRIBUTING.md](../../CONTRIBUTING.md#translations)。 |
| `killswitch` | `"on"` | 设为 `"watch"` 可以先试用这些检查：命令和文件内容不会被拒绝，也不会停止代理，日志只记录本来会发生什么（由 `doctor.ps1` 统计）。用 `read`、`grep` 或 `webfetch` 读取 `secrets.txt` 中的文件，以及 `STOP` 文件，仍会停止代理，沙箱也照常工作。其他任何值都视为开启。 |

损坏的设置文件不会关闭防护：shell 会被拒绝，日志会说明原因。

## 代理看到的内容

- 每个会话中会告知它们一次：可以在哪里写入、机密文件无法打开、各项限制，以及有害调用会停止所有代理。
- 被拒绝的工具调用会返回 `Blocked: ...` 及原因；Windows 的拒绝在 shell 中显示为“Access denied”（拒绝访问）。
- 启动器退出码：**125** 表示限制或 `STOP` 终止或阻止了命令，**126** 表示命令未启动（沙箱不完整）。命令绝不会改为以完整权限运行。
- 紧急停止之后，每次调用都会以 `EMERGENCY STOP: <reason>` 失败，代理会被中断（主代理优先），项目中的 `AGENT_STOPPED.txt` 会说明发生了什么。如果你创建了 `STOP` 文件，请删除它，然后在该文件夹的某个会话中发送任意一条消息。

## 检查安装

```powershell
& "$HOME\.local\share\opencode\sandbox\doctor.ps1"
& "$HOME\.local\share\opencode\sandbox\doctor.ps1" -Why "npm test"
```

它检查插件、启动器和设置是否就位，文件夹及其缓存是否带有 Low 标签，并通过启动器运行一条真实命令：该命令必须以 Low 完整性运行，可以写入缓存，但不能写入其他位置，也不能读取已封锁的文件。它还会显示代理是否处于停止状态，以及日志中最近的拒绝和停止；在 watch 模式下，它会统计本来会被拒绝的内容。请在项目文件夹中运行，或指定 `-Folder`。加上 `-Why "<命令>"` 时，它会在代理运行之前告诉你插件会如何处理该命令（需要 Node.js）。它不做任何修改，出现问题时以退出码 1 结束。

## 自己停止代理

在项目文件夹中创建一个名为 `STOP` 的文件。正在运行的命令会在一两秒内被终止，新命令不会启动，该文件夹的所有代理都会被中断。

## 与其他插件配合使用

- `globalThis[Symbol.for("opencode-win-guard.halted")]` 是一个 `Set`，包含已停止的文件夹（小写，使用正斜杠）。会自行让代理继续工作的插件（自动驾驶类）应先检查这里。
- 其他插件的工具需要 `extraTools`，见上文。

## 为什么启动器用 C# 编写

沙箱需要一些任何脚本都无法直接调用的 Windows 函数：具有 Low 完整性级别的受限令牌、`CreateProcessAsUser`、带内存限制的作业对象，以及文件上的强制标签。C# 通过普通的 P/Invoke 就能调用它们，而且它的编译器作为 .NET Framework 的一部分随每台 Windows 10 和 11 提供。因此，启动器会在安装时于你自己的电脑上从可读的源代码构建，无需 SDK、无需下载，也没有来自互联网的未签名程序。代码限制在 C# 5，以便这个旧编译器能够构建它。

## 测试

```powershell
npm test                                   # pure parts, any OS
$env:WIN_GUARD_E2E = "1"; npm run test:e2e # also the launcher and both plugins in a real `opencode serve` with a fake model
```

端到端测试在临时文件夹中进行，使用它们自己的机密文件，自行构建启动器，并恢复它们设置的每一个标签。它们不会触碰你的 opencode 配置、会话或沙箱，也不需要提供商或账号。

## 相关项目

于 2026 年 11 月查找；它们都不能在 Windows 上为 shell 提供沙箱，也不能停止整棵会话树：

- [opencode-sandbox](https://github.com/Hamza-Abili/opencode-sandbox)：使用 bubblewrap（Linux）和 Seatbelt（macOS）为 shell 提供操作系统级沙箱；不支持原生 Windows。
- [opencode-guard](https://github.com/gigi206/opencode-guard)：基于规则对工具调用执行拒绝/询问，外加可选的决策模型，并在机密信息到达模型之前将其遮蔽。
- [opencode-hook-safety](https://github.com/MansM/opencode-hook-safety)：针对机密路径和破坏性命令的拒绝列表，可选分类器。
- [opencode-damage-control](https://github.com/nicounii/opencode-damage-control)：拦截 90 多种危险命令模式，提供三级路径保护。

它们在命令文本和路径层面工作；与本项目搭配效果很好，本项目额外提供了操作系统自身的拒绝。

## 参与贡献

欢迎提交错误报告、想法和拉取请求：参见 [CONTRIBUTING.md](../../CONTRIBUTING.md)。绕过沙箱的方法：请私下报告，参见 [SECURITY.md](../../SECURITY.md)。

## 许可证

[MIT](../../LICENSE)
