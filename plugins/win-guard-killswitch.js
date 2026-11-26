// opencode-win-guard, part 2 of 2: an emergency stop for opencode agents, in the folders listed in
// <config>/opencode/win-guard.json (the same file as the sandbox).
//
//  Before a call runs, its text is checked: the shell command, and the scripts in the project that it starts.
//   - "stop": clearly harmful (keys and passwords, a way around the sandbox, disks, system protection). The call does not
//     run and every agent of the folder is interrupted.
//   - "refuse": probably harmless, but not for an unattended agent. The call does not run, the agent goes on.
//     Many refusals in a short time also stop the agents.
//  While calls run: a file STOP in the project, or a large part of the project's files gone, stops the agents.
//
// A stop stays in force, also after a restart of OpenCode, until the user writes a message in a session of the folder.
// With "killswitch": "watch" in the settings the checks of commands and file texts refuse and stop nothing: the log says what
// would have been ("WATCH would stop/refuse ..."), so they can be tried on real work first. Still in force: a file STOP made by
// the user, and read/list/edit/write/grep/webfetch of the files in secrets.txt (these tools run with full rights).
// Text checks see what a command says, not what a compiled program does. That is what the sandbox is for. No network access.
// Other plugins can see a stop: globalThis[Symbol.for("opencode-win-guard.halted")] is a Set of the stopped folders.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"

const DATA = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
const CONFIG = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
const HOME = process.env.OPENCODE_SANDBOX_HOME || path.join(os.homedir(), ".local", "share", "opencode", "sandbox")
const LIST = process.env.OPENCODE_WIN_GUARD_CONFIG || path.join(CONFIG, "win-guard.json")
const SECRETS = path.join(HOME, "secrets.txt")
const LOG = path.join(DATA, "opencode", "log", "win-guard.log")
const NOTE = "AGENT_STOPPED.txt"
const MAX_REFUSED = 8 // refused calls of one agent ...
const MAX_REFUSED_ALL = 24 // ... or of all together ...
const REFUSED_MS = 10 * 60 * 1000 // ... within this time
const POLL_MS = Number(process.env.KILLSWITCH_POLL_MS) || 2000

const log = (...parts) => {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, `${new Date().toISOString()} [killswitch] ${parts.join(" ")}\n`)
  } catch {}
}
const halted = (globalThis[Symbol.for("opencode-win-guard.halted")] ||= new Set()) // folders that are stopped, for other plugins
const norm = (p) => path.resolve(p).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
const inside = (p, dir) => p === dir || p.startsWith(dir + "/")

// ---- what a text may not contain: [pattern, reason]
const STOP = [
  // Generic names; every file of secrets.txt is added to this list when the plugin starts (see secrets()).
  [/(?:^|[\s"'`\\/=(])\.(?:ssh|gnupg)[\\/]+\S|\bid_(?:rsa|ed25519|ecdsa|dsa)\b(?!\.pub)|\.git-credentials\b|\.(?:kdbx|pfx|p12|ppk)\b(?!\.)/i, "it names files with keys or passwords"],
  [/opencode[\\/]+(?:service|auth)\.json|\bopencode\.db\b/i, "it names OpenCode's own password or database"],
  // The profile layout shared by Chromium-based browsers.
  [/User Data[\\/]+(?:Local State|[^\\/"']+[\\/]+(?:Login Data|Web Data|Network[\\/]+Cookies))/i, "it names saved passwords of a browser"],
  [/\bcmdkey\b|\bvaultcmd\b|\bCred(?:Read|Enumerate)[AW]?\b|\bPasswordVault\b|\bgit(?:\.exe)?\s+credential\b|\bgit-credential-manager\b|\bgh(?:\.exe)?\s+auth\s+token\b|\bmimikatz\b|\bsekurlsa\b|\bprocdump\b|\blsass\b|ProtectedData\]?::Unprotect|\bCryptUnprotectData\b|\breg(?:\.exe)?\s+save\b/i, "it asks Windows or a program for saved passwords"],
  [/\bopencode(?:\.exe|\.cmd)?["']?\s+(?:serve|run|auth|attach|service|api|web|acp|mcp|debug)\b|(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/api\/(?:session|config|shell|pty)/i, "it would start or control another OpenCode outside the sandbox"],
  [/(?:^|[\s;&|("'`])(?:format(?:\.com)?\s+[A-Za-z]:(?=[\s"'/\\]|$)|diskpart\b|mkfs(?:\.\w+)?\s|cipher(?:\.exe)?\s+\/w|bcdedit\b|vssadmin(?:\.exe)?\s+(?:delete|resize)|wbadmin(?:\.exe)?\s+delete)|\bdd\s+.*\bof=(?:\/dev\/|\\\\\.\\)|\b(?:Clear-Disk|Format-Volume|Remove-Partition|Initialize-Disk)\b|\\\\\.\\PhysicalDrive/i, "it wipes disks or backups"],
  [/(?:^|[\s;&|("'`])shutdown(?:\.exe)?\s+[\/-]\w|\b(?:Stop-Computer|Restart-Computer)\b/i, "it turns the computer off"],
  [/\b(?:Set|Add)-MpPreference\b|\bnetsh(?:\.exe)?\s+(?:advfirewall|firewall)|\b(?:Set|New|Disable|Remove)-NetFirewall\w+|\bnet1?(?:\.exe)?\s+(?:user|localgroup)\s+\S+.*\/(?:add|active)|\bNew-LocalUser\b|\bAdd-LocalGroupMember\b|\bwevtutil(?:\.exe)?\s+cl\b|\bClear-EventLog\b/i, "it weakens the protection of this computer"],
  [/\b(?:rm|del|erase|rd|rmdir|Remove-Item|ri)\b(?=[^;&|\n]*(?:\s-\w*r|\s\/s\b))[^;&|\n]*?\s["']?(?:\/(?:c|mnt\/c)?\/?|[A-Za-z]:[\\/]*|~[\\/]*|\$(?:HOME|\{HOME\}|env:USERPROFILE)[\\/]*|%USERPROFILE%[\\/]*|(?:[A-Za-z]:|\/c)[\\/]+(?:Windows|Users|Program Files[^\\/"';&|]*|ProgramData)(?:[\\/]+[^\\/"'\s;&|]+)?[\\/]*)\*?["']?(?=\s|$|[;&|])/im, "it deletes a whole drive or user folder"],
]
const REFUSE = [
  [/\bschtasks(?:\.exe)?\b.*\/(?:create|change|delete)|\b(?:Register-ScheduledTask|New-Service|sc(?:\.exe)?\s+(?:create|config|delete|stop))\b|CurrentVersion[\\/]+Run\b|Start Menu[\\/]+Programs[\\/]+Startup|\bshell:startup\b/i, "it makes something start on its own"],
  [/\b(?:powershell|pwsh)(?:\.exe)?\b[^\n;|&]*\s-(?:e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{20,}|\bFromBase64String\b[\s\S]{0,400}\b(?:iex|Invoke-Expression|Assembly\]?::Load|ScriptBlock)|\bbase64\s+(?:-d|--decode)\b[^\n]*\|\s*(?:ba|z)?sh\b/i, "it hides what it runs"],
  [/\b(?:iex|Invoke-Expression)\b[\s\S]{0,120}\b(?:iwr|irm|curl|wget|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b|\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString)\b[^\n]*\|\s*(?:(?:ba|z|c)?sh|python3?|node|iex|Invoke-Expression)\b|\b(?:ba)?sh\s+-c\s+["']?\$\(\s*(?:curl|wget)\b|\b(?:mshta|bitsadmin|regsvr32)\b|\bcertutil(?:\.exe)?\s+.*-(?:urlcache|decode)/i, "it runs a program from the internet without looking at it. Download it to a file and read it first"],
  [/\bcurl(?:\.exe)?\b(?=[^;&|\n]*\s(?:-T\s|--upload-file\b|-F\s|--form\b|(?:-d|--data(?:-binary|-raw|-urlencode)?)\s+["']?@))(?![^;&|\n]*(?:127\.0\.0\.1|localhost))/, "it sends data out of this computer"],
  [/\b(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b(?=[^;\n]*-InFile)(?![^;\n]*(?:127\.0\.0\.1|localhost))|\.Upload(?:File|Data|String)\(|(?:^|[\s;&|("'`])(?:(?:scp|sftp|rsync|ssh)(?:\.exe)?\s[^;&|\n=]*?[\w.-]{2,}[@:][\w/~.]|(?:nc|ncat|telnet)(?:\.exe)?\s+[\w.-]+\s+\d{2,5}\b)/i, "it sends data out of this computer"],
  [/\bOPENCODE_SANDBOX_\w+|opencode[\\/]+sandbox[\\/]+(?:bin|stopped|secrets)|\.config[\\/]+opencode[\\/]+(?:plugins|agents|win-guard\.json|opencode\.jsonc?)/i, "it touches the settings that limit this agent"],
]
// Translations of the stop note. Each list maps the start of an English reason to its translation; a reason that is
// not listed stays in English. To add a language, add an entry here (see CONTRIBUTING.md).
const TRANSLATIONS = {
  "zh-CN": {
    locale: "zh-CN",
    reasons: [
      ["it names files with keys or passwords", "访问存放密钥或密码的文件"],
      ["it opens a file with keys or passwords", "试图打开存放密钥或密码的文件"],
      ["it names OpenCode's own password", "访问 opencode 自身的密码或数据库"],
      ["it names saved passwords", "访问浏览器中保存的密码"],
      ["it asks Windows", "向 Windows 或其他程序索取已保存的密码"],
      ["it would start or control another OpenCode", "试图绕过沙箱控制 opencode"],
      ["it wipes disks", "擦除磁盘或备份"],
      ["it turns the computer off", "关闭计算机"],
      ["it weakens the protection", "削弱计算机的安全防护"],
      ["it deletes a whole drive", "删除整个驱动器或用户文件夹"],
      ["it opens a local file", "通过网页工具访问本地文件或 opencode 服务"],
      ["the file STOP", "项目文件夹中存在 STOP 文件"],
      ["a large part", "项目的大部分文件消失了"],
      ["too many refused calls", `${REFUSED_MS / 60000} 分钟内被拒绝的操作过多`],
    ],
    inFile: (file) => `（在文件 ${file} 中）`,
    title: "紧急停止",
    note: ({ when, reason, by, detail, log }) =>
      `代理紧急停止，${when}\n\n原因：${reason}\n触发者：${by || "—"}\n具体内容：\n${detail}\n\n被拒绝的操作没有执行，或已被终止。要继续，请删除 STOP 文件（如果存在），然后在聊天中给代理发一条消息。\n日志：${log}\n`,
  },
  ja: {
    locale: "ja-JP",
    reasons: [
      ["it names files with keys or passwords", "キーやパスワードを含むファイルへの参照"],
      ["it opens a file with keys or passwords", "キーやパスワードを含むファイルを開こうとした"],
      ["it names OpenCode's own password", "opencode 自身のパスワードやデータベースへの参照"],
      ["it names saved passwords", "ブラウザーに保存されたパスワードへの参照"],
      ["it asks Windows", "Windows やプログラムへの保存済みパスワードの要求"],
      ["it would start or control another OpenCode", "サンドボックスを迂回して opencode を操作しようとした"],
      ["it wipes disks", "ディスクやバックアップの消去"],
      ["it turns the computer off", "コンピューターのシャットダウン"],
      ["it weakens the protection", "コンピューターの保護を弱める操作"],
      ["it deletes a whole drive", "ドライブ全体またはユーザーフォルダーの削除"],
      ["it opens a local file", "Web ツールによるローカルファイルや opencode のサービスへのアクセス"],
      ["the file STOP", "プロジェクトフォルダーに STOP ファイルがある"],
      ["a large part", "プロジェクトのファイルの大部分が消えた"],
      ["too many refused calls", `${REFUSED_MS / 60000} 分間に拒否された操作が多すぎる`],
    ],
    inFile: (file) => ` (ファイル: ${file})`,
    title: "緊急停止",
    note: ({ when, reason, by, detail, log }) =>
      `エージェントの緊急停止、${when}\n\n理由: ${reason}\n発生元: ${by || "—"}\n詳細:\n${detail}\n\n拒否された操作は実行されなかったか、中断されました。続行するには、STOP ファイルを削除し(ある場合)、チャットでエージェントにメッセージを書いてください。\nログ: ${log}\n`,
  },
  ko: {
    locale: "ko-KR",
    reasons: [
      ["it names files with keys or passwords", "키 또는 비밀번호가 담긴 파일에 접근"],
      ["it opens a file with keys or passwords", "키 또는 비밀번호가 담긴 파일을 열려는 시도"],
      ["it names OpenCode's own password", "opencode 자체의 비밀번호 또는 데이터베이스에 접근"],
      ["it names saved passwords", "브라우저에 저장된 비밀번호에 접근"],
      ["it asks Windows", "Windows 또는 프로그램에 저장된 비밀번호 요청"],
      ["it would start or control another OpenCode", "샌드박스를 우회해 opencode를 제어하려는 시도"],
      ["it wipes disks", "디스크 또는 백업 지우기"],
      ["it turns the computer off", "컴퓨터 끄기"],
      ["it weakens the protection", "컴퓨터 보호 기능 약화"],
      ["it deletes a whole drive", "드라이브 전체 또는 사용자 폴더 삭제"],
      ["it opens a local file", "웹 도구를 통한 로컬 파일 또는 opencode 서비스 접근"],
      ["the file STOP", "프로젝트 폴더에 STOP 파일이 있음"],
      ["a large part", "프로젝트 파일의 상당 부분이 사라짐"],
      ["too many refused calls", `${REFUSED_MS / 60000}분 동안 거부된 작업이 너무 많음`],
    ],
    inFile: (file) => ` (${file} 파일)`,
    title: "비상 정지",
    note: ({ when, reason, by, detail, log }) =>
      `에이전트 비상 정지, ${when}\n\n이유: ${reason}\n주체: ${by || "—"}\n상세 내용:\n${detail}\n\n거부된 작업은 실행되지 않았거나 종료되었습니다. 계속하려면 STOP 파일을 삭제하고(있는 경우) 채팅에서 에이전트에게 메시지를 쓰세요.\n로그: ${log}\n`,
  },
  es: {
    locale: "es-ES",
    reasons: [
      ["it names files with keys or passwords", "acceso a archivos con claves o contraseñas"],
      ["it opens a file with keys or passwords", "intento de abrir un archivo con claves o contraseñas"],
      ["it names OpenCode's own password", "acceso a la contraseña o la base de datos del propio opencode"],
      ["it names saved passwords", "acceso a las contraseñas guardadas del navegador"],
      ["it asks Windows", "solicitud de contraseñas guardadas a Windows o a un programa"],
      ["it would start or control another OpenCode", "intento de controlar opencode eludiendo el sandbox"],
      ["it wipes disks", "borrado de discos o copias de seguridad"],
      ["it turns the computer off", "apagado del equipo"],
      ["it weakens the protection", "debilitamiento de la protección del equipo"],
      ["it deletes a whole drive", "eliminación de una unidad completa o de la carpeta del usuario"],
      ["it opens a local file", "acceso a un archivo local o a un servicio de opencode mediante una herramienta web"],
      ["the file STOP", "hay un archivo STOP en la carpeta del proyecto"],
      ["a large part", "ha desaparecido una gran parte de los archivos del proyecto"],
      ["too many refused calls", `demasiadas acciones prohibidas en ${REFUSED_MS / 60000} minutos`],
    ],
    inFile: (file) => ` (en el archivo ${file})`,
    title: "Parada de emergencia",
    note: ({ when, reason, by, detail, log }) =>
      `Parada de emergencia de los agentes, ${when}\n\nMotivo: ${reason}\nQuién: ${by || "—"}\nQué exactamente:\n${detail}\n\nLa acción prohibida no se ejecutó o se interrumpió. Para continuar, elimina el archivo STOP (si existe) y escribe un mensaje al agente en el chat.\nRegistro: ${log}\n`,
  },
  "pt-BR": {
    locale: "pt-BR",
    reasons: [
      ["it names files with keys or passwords", "acesso a arquivos com chaves ou senhas"],
      ["it opens a file with keys or passwords", "tentativa de abrir um arquivo com chaves ou senhas"],
      ["it names OpenCode's own password", "acesso à senha ou ao banco de dados do próprio opencode"],
      ["it names saved passwords", "acesso às senhas salvas do navegador"],
      ["it asks Windows", "pedido de senhas salvas ao Windows ou a um programa"],
      ["it would start or control another OpenCode", "tentativa de controlar o opencode por fora da sandbox"],
      ["it wipes disks", "apagamento de discos ou de backups"],
      ["it turns the computer off", "desligamento do computador"],
      ["it weakens the protection", "enfraquecimento da proteção do computador"],
      ["it deletes a whole drive", "exclusão de um drive inteiro ou da pasta do usuário"],
      ["it opens a local file", "acesso a um arquivo local ou a um serviço do opencode por uma ferramenta web"],
      ["the file STOP", "há um arquivo STOP na pasta do projeto"],
      ["a large part", "uma grande parte dos arquivos do projeto sumiu"],
      ["too many refused calls", `ações recusadas demais em ${REFUSED_MS / 60000} minutos`],
    ],
    inFile: (file) => ` (no arquivo ${file})`,
    title: "Parada de emergência",
    note: ({ when, reason, by, detail, log }) =>
      `Parada de emergência dos agentes, ${when}\n\nMotivo: ${reason}\nQuem: ${by || "—"}\nO que exatamente:\n${detail}\n\nA ação recusada não foi executada ou foi encerrada. Para continuar, apague o arquivo STOP (se houver um) e escreva uma mensagem para o agente.\nLog: ${log}\n`,
  },
  de: {
    locale: "de-DE",
    reasons: [
      ["it names files with keys or passwords", "Zugriff auf Dateien mit Schlüsseln oder Passwörtern"],
      ["it opens a file with keys or passwords", "Versuch, eine Datei mit Schlüsseln oder Passwörtern zu öffnen"],
      ["it names OpenCode's own password", "Zugriff auf das Passwort oder die Datenbank von opencode selbst"],
      ["it names saved passwords", "Zugriff auf gespeicherte Browser-Passwörter"],
      ["it asks Windows", "Abfrage gespeicherter Passwörter bei Windows oder einem Programm"],
      ["it would start or control another OpenCode", "Versuch, opencode an der Sandbox vorbei zu steuern"],
      ["it wipes disks", "Löschen von Datenträgern oder Sicherungskopien"],
      ["it turns the computer off", "Ausschalten des Computers"],
      ["it weakens the protection", "Schwächung des Computerschutzes"],
      ["it deletes a whole drive", "Löschen eines ganzen Laufwerks oder Benutzerordners"],
      ["it opens a local file", "Zugriff auf eine lokale Datei oder einen opencode-Dienst über ein Web-Tool"],
      ["the file STOP", "im Projektordner liegt eine Datei STOP"],
      ["a large part", "ein großer Teil der Projektdateien ist verschwunden"],
      ["too many refused calls", `zu viele abgelehnte Aktionen in ${REFUSED_MS / 60000} Minuten`],
    ],
    inFile: (file) => ` (in der Datei ${file})`,
    title: "Not-Aus",
    note: ({ when, reason, by, detail, log }) =>
      `Not-Aus der Agenten, ${when}\n\nGrund: ${reason}\nVon: ${by || "—"}\nWas genau:\n${detail}\n\nDie abgelehnte Aktion wurde nicht ausgeführt oder abgebrochen. Um weiterzumachen, lösche die Datei STOP (falls vorhanden) und schreib dem Agenten eine Nachricht im Chat.\nProtokoll: ${log}\n`,
  },
  fr: {
    locale: "fr-FR",
    reasons: [
      ["it names files with keys or passwords", "accès à des fichiers contenant des clés ou des mots de passe"],
      ["it opens a file with keys or passwords", "tentative d'ouvrir un fichier contenant des clés ou des mots de passe"],
      ["it names OpenCode's own password", "accès au mot de passe ou à la base de données d'opencode lui-même"],
      ["it names saved passwords", "accès aux mots de passe enregistrés du navigateur"],
      ["it asks Windows", "demande de mots de passe enregistrés à Windows ou à un programme"],
      ["it would start or control another OpenCode", "tentative de contrôler opencode en contournant le bac à sable"],
      ["it wipes disks", "effacement de disques ou de sauvegardes"],
      ["it turns the computer off", "arrêt de l'ordinateur"],
      ["it weakens the protection", "affaiblissement de la protection de l'ordinateur"],
      ["it deletes a whole drive", "suppression d'un disque entier ou du dossier utilisateur"],
      ["it opens a local file", "accès à un fichier local ou à un service opencode via un outil web"],
      ["the file STOP", "un fichier STOP se trouve dans le dossier du projet"],
      ["a large part", "une grande partie des fichiers du projet a disparu"],
      ["too many refused calls", `trop d'actions refusées en ${REFUSED_MS / 60000} minutes`],
    ],
    inFile: (file) => ` (dans le fichier ${file})`,
    title: "Arrêt d'urgence",
    note: ({ when, reason, by, detail, log }) =>
      `Arrêt d'urgence des agents, ${when}\n\nRaison : ${reason}\nPar : ${by || "—"}\nQuoi exactement :\n${detail}\n\nL'action refusée n'a pas été exécutée ou a été interrompue. Pour continuer, supprimez le fichier STOP (s'il existe) et écrivez un message à l'agent dans le chat.\nJournal : ${log}\n`,
  },
  ru: {
    locale: "ru-RU",
    reasons: [
      ["it names files with keys or passwords", "обращение к файлам с ключами или паролями"],
      ["it opens a file with keys or passwords", "попытка открыть файл с ключами или паролями"],
      ["it names OpenCode's own password", "обращение к паролю или базе самого opencode"],
      ["it names saved passwords", "обращение к сохранённым паролям браузера"],
      ["it asks Windows", "запрос сохранённых паролей у Windows или программы"],
      ["it would start or control another OpenCode", "попытка управлять opencode в обход песочницы"],
      ["it wipes disks", "стирание дисков или резервных копий"],
      ["it turns the computer off", "выключение компьютера"],
      ["it weakens the protection", "ослабление защиты компьютера"],
      ["it deletes a whole drive", "удаление целого диска или папки пользователя"],
      ["it opens a local file", "доступ к локальному файлу или службе opencode через веб-инструмент"],
      ["the file STOP", "в папке проекта лежит файл STOP"],
      ["a large part", "пропала большая часть файлов проекта"],
      ["too many refused calls", `слишком много запрещённых действий за ${REFUSED_MS / 60000} минут`],
    ],
    inFile: (file) => ` (в файле ${file})`,
    title: "Аварийная остановка",
    note: ({ when, reason, by, detail, log }) =>
      `Аварийная остановка агента, ${when}\n\nПричина: ${reason}\nКто: ${by || "—"}\nЧто именно:\n${detail}\n\nЗапрещённое действие не выполнено или прервано. Чтобы продолжить, удалите файл STOP (если он есть) и напишите агенту в чат.\nЖурнал: ${log}\n`,
  },
}
const translate = (reason, t = TRANSLATIONS[settings.language]) => {
  if (!t) return reason
  const r = t.reasons.find(([en]) => reason.startsWith(en))
  const file = / \(in (.+)\)$/.exec(reason)?.[1]
  return r ? r[1] + (file ? t.inFile(file) : "") : reason
}
const SCRIPT = /\.(?:ps1|psm1|bat|cmd|sh|bash|py|pyw|js|mjs|cjs|ts|vbs|wsf|csx|fsx|rb|pl|lua)$/i
// Files a build or a test run may execute: their new text is checked when an agent writes them.
const CODE = /\.(?:ps1|psm1|bat|cmd|sh|bash|zsh|py|pyw|js|mjs|cjs|ts|mts|cts|jsx|tsx|vbs|wsf|csx|fsx|rb|pl|lua|php|cs|fs|vb|go|rs|java|kt|kts|scala|groovy|gradle|swift|c|cc|cpp|h|hpp|gd|csproj|fsproj|vbproj|props|targets|cmake|mk)$|(?:^|[\\/])(?:Makefile|Justfile|Rakefile|Dockerfile)$/i
const MAX_SCRIPT = 1_000_000
const MAX_SCRIPTS = 25

function verdict(text, list = []) {
  for (const [re, why] of STOP) if (re.test(text)) return { act: "stop", why }
  for (const s of list) if (s.name?.test(text)) return { act: "stop", why: "it names files with keys or passwords" }
  for (const [re, why] of REFUSE) if (re.test(text)) return { act: "refuse", why }
}

// Files the agents can have written. Installed packages are left out: they name everything and nothing.
const own = (p, root) => inside(norm(p), norm(root)) && !/\/(?:site-packages|node_modules)\//.test(norm(p))
// Scripts that a command names, with the scripts these name in turn.
function scripts(command, dir, root) {
  const seen = new Map()
  const add = (text, base) => {
    for (const m of text.matchAll(/"[^"\n]{1,250}\.[A-Za-z0-9]{1,4}"|'[^'\n]{1,250}\.[A-Za-z0-9]{1,4}'|[^\s"'`()<>|;&,=]+\.[A-Za-z0-9]{1,4}\b/g)) {
      const name = m[0].replace(/^["']|["']$/g, "").replace(/^\$(?:PSScriptRoot|PWD)[\\/]|^%~dp0/i, "")
      if (!SCRIPT.test(name)) continue
      for (const b of new Set([base, dir, root])) {
        const p = path.resolve(b, name.replace(/^\/([a-z])\//i, "$1:/"))
        if (seen.has(p)) break
        if (seen.size >= MAX_SCRIPTS) return
        let st
        try {
          st = fs.statSync(p)
        } catch {
          continue
        }
        if (!st.isFile()) continue
        let body = ""
        if (st.size <= MAX_SCRIPT) body = fs.readFileSync(p, "utf8")
        seen.set(p, body)
        // Programs installed on the computer are not followed: only what lies in the project can have been written by the agents.
        if (own(p, root)) add(body, path.dirname(p))
        break
      }
    }
  }
  add(command, dir)
  const run = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/i.exec(command)?.[1]
  if (run)
    try {
      const file = path.join(dir, "package.json")
      const all = JSON.parse(fs.readFileSync(file, "utf8")).scripts || {}
      const body = [`pre${run}`, run, `post${run}`].map((n) => all[n] || "").join("\n")
      seen.set(file, body)
      add(body, dir)
    } catch {}
  return seen
}

function check(command, dir, root, list = []) {
  const v = verdict(command, list)
  if (v) return v
  const r = norm(root)
  const del = [...command.replaceAll("\\", "/").replace(/\/+/g, "/").toLowerCase().matchAll(/\b(?:rm|rd|rmdir|remove-item|ri)\b(?=[^;&|\n]*(?:\s-\w*r|\s\/s\b))[^;&|\n]*/g)]
  for (const d of del) if (d[0].split(/["']|\s(?=[a-z]:|\/)/).some((w) => [r, r.replace(/^([a-z]):/, "/$1")].includes(w.trim().replace(/\/?\*?$/, "")))) return { act: "refuse", why: "it deletes the whole project" }
  for (const [file, body] of scripts(command, dir, root)) {
    if (!own(file, root)) continue
    const s = verdict(body, list)
    if (s) return { act: s.act, why: `${s.why} (in ${path.relative(root, file)})` }
  }
}

// ---- the files with passwords, the same list that the launcher uses
function secrets(file = SECRETS, home = os.homedir(), roaming = process.env.APPDATA || "", local = process.env.LOCALAPPDATA || "") {
  const list = []
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    let line = raw.trim().replace(/^!/, "")
    if (!line || line[0] === "#") continue
    const folder = line.endsWith("\\")
    line = line.replace(/^~/, () => home).replace(/^%APPDATA%/i, () => roaming).replace(/^%LOCALAPPDATA%/i, () => local)
    const n = norm(line.replace(/\\+$/, ""))
    const re = n.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")
    list.push({ re: new RegExp(`^${re}${folder ? "(?:/.*)?" : ""}$`), head: n.split("*")[0], name: nameOf(raw.trim().replace(/^!/, "")) })
  }
  if (!list.length) throw new Error("secrets.txt is empty")
  return list
}
// How a command would name an entry of secrets.txt: by its last two parts, e.g. `.aws\credentials` or `User Data\Local State`
// (three when one of them is a `*`). An entry right in the user folder (`~\.npmrc`) counts only together with that folder,
// so the project's own `.npmrc` stays free. A single short name without a dot would match too much and is left to the sandbox.
const HOME_NAME = String.raw`(?:~|\$\{?HOME\}?|\$env:USERPROFILE|%USERPROFILE%|(?:[A-Za-z]:)?[\\/]+Users[\\/]+[^\\/"'\s]+)[\\/]+`
function nameOf(line) {
  const all = line.replace(/^(?:~|%\w+%|[A-Za-z]:)[\\/]*/, "").split(/[\\/]+/).filter(Boolean)
  let n = Math.min(2, all.length)
  while (n < all.length && all.slice(-n).filter((p) => p !== "*").length < 2) n++
  const parts = all.slice(-n)
  if (!parts.length || (parts.length === 1 && !/\./.test(parts[0]) && parts[0].length < 8)) return
  const body = parts.map((p) => p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(`[^\\\\/"'\\s]*`)).join("[\\\\/]+")
  const head = /^~/.test(line) && all.length === 1 ? HOME_NAME : String.raw`(?<![\w.-])`
  return new RegExp(`${head}${body}(?![\\w-])`, "i")
}
const isSecret = (list, p) => list.some((s) => s.re.test(p))
const holdsSecret = (list, dir) => list.some((s) => inside(s.head, dir) || s.re.test(dir))

function real(p) {
  let cur = path.resolve(p)
  const rest = []
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest)
    } catch (e) {
      const up = path.dirname(cur)
      if (up === cur) return path.resolve(p)
      rest.unshift(path.basename(cur))
      cur = up
    }
  }
}

// ---- how many files the project has, without what programs make again
// Build output, dependencies, caches and editor folders of common tools and engines.
const SKIP = /^(?:bin|obj|build|builds|dist|out|output|target|publish|artifacts|exports?|te?mp|\.?cache|logs?|coverage|testresults|node_modules|bower_components|vendor|\.venv|venv|__pycache__|\.pytest_cache|\.mypy_cache|\.tox|\.gradle|\.next|\.nuxt|\.svelte-kit|\.turbo|\.parcel-cache|\.dart_tool|DerivedData|Pods|\.terraform|\.git|\.hg|\.svn|\.idea|\.vs|\.vscode|\.godot|\.import|\.mono|Library|Temp|Intermediate|Binaries|Saved|DerivedDataCache)$/i
async function count(dir, limit = 50000) {
  let n = 0
  const todo = [dir]
  while (todo.length && n < limit) {
    let list
    try {
      list = await fs.promises.readdir(todo.pop(), { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of list) {
      if (d.isSymbolicLink()) continue
      if (d.isDirectory()) {
        if (!SKIP.test(d.name)) todo.push(path.join(d.parentPath || d.path, d.name))
      } else n++
    }
  }
  return n
}
const lost = (most, now) => most - now >= 40 && now < most * 0.5

const settings = { agents: "*", language: "en", watch: false }
function listed(here, file = LIST) {
  let conf
  try {
    conf = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))
  } catch (e) {
    if (e.code === "ENOENT") return
    throw e
  }
  if (!Array.isArray(conf.folders)) throw new Error('"folders" must be a list of absolute paths')
  if (conf.agents !== undefined) settings.agents = conf.agents === "*" ? "*" : [].concat(conf.agents).map(String)
  settings.language = Object.hasOwn(TRANSLATIONS, conf.language) ? conf.language : "en"
  // Anything but "watch" means on: a typo must not switch the stop off.
  settings.watch = conf.killswitch === "watch"
  const h = norm(here)
  return conf.folders.find((f) => inside(h, norm(String(f))))
}
const covered = (agent) => settings.agents === "*" || settings.agents.includes(agent)

// The note left in the project and shown to the lead.
function note(reason, by, detail, when = new Date()) {
  const t = TRANSLATIONS[settings.language]
  if (t) return t.note({ when: when.toLocaleString(t.locale), reason: translate(reason), by, detail, log: LOG })
  return `Emergency stop of the agents, ${when.toISOString()}\n\nReason: ${reason}\nBy: ${by || "-"}\nWhat exactly:\n${detail}\n\nThe refused action did not run or was ended. To go on, delete the file STOP (if there is one) and write a message to the agent.\nLog: ${LOG}\n`
}

export default {
  id: "win-guard-killswitch",
  _test: { verdict, check, scripts, secrets, nameOf, isSecret, holdsSecret, lost, norm, listed, note, settings, TRANSLATIONS },
  async setup(ctx) {
    const here = ctx.location?.directory
    if (!here) return
    let root, list, broken
    try {
      root = listed(here)
      if (!root) return
      list = secrets()
    } catch (e) {
      broken = e?.message || String(e)
      root ||= here
    }
    const rootN = norm(root)
    const slug = `${path.basename(root).replace(/[^\p{L}\p{N}_-]+/gu, "-")}-${crypto.createHash("sha1").update(rootN).digest("hex").slice(0, 8)}`
    const FILE = path.join(HOME, "stopped", `${slug}.json`)
    const stopFile = path.join(root, "STOP")
    let stopped
    try {
      stopped = JSON.parse(fs.readFileSync(FILE, "utf8"))
    } catch {}
    const active = new Map() // sessions of covered agents: id -> agent
    const parents = new Map() // id -> parent id or null
    const parentOf = async (id) => {
      if (!parents.has(id))
        try {
          parents.set(id, (await ctx.session.get({ sessionID: id })).parentID || null)
        } catch {
          return null
        }
      return parents.get(id)
    }
    const refused = []
    const running = new Set()
    let most = 0
    let mostAt = 0
    if (stopped) halted.add(norm(here))
    log(broken ? `BROKEN (${broken}): agents refused` : stopped ? `still stopped: ${stopped.reason}` : settings.watch ? "watching (nothing is refused or stopped)" : "on", "for", root)
    // One word for "by" and "tool", so that doctor.ps1 can count the reasons.
    const watched = (act, by, tool, why, text) => log(`WATCH would ${act}`, String(by || "-").replace(/\s+/g, "_"), tool || "-", why, JSON.stringify(String(text ?? "")).slice(0, 300))

    const message = () =>
      `EMERGENCY STOP: ${stopped.reason}. Every call is refused until the user writes a message. Do not try again or another way. End now with one short message to the user: what you were doing and why, and the line "STATUS: BLOCKED".`
    const interrupt = async () => {
      // the leads first, so that they cannot start others
      const ids = [...active.keys()]
      const top = new Set()
      for (const id of ids) if (!(await parentOf(id))) top.add(id)
      for (const id of ids.sort((a, b) => top.has(b) - top.has(a)))
        try {
          await ctx.session.interrupt({ sessionID: id })
        } catch (e) {
          log("interrupt failed", id, e?.message || String(e))
        }
    }
    const trip = (reason, detail, by, always = false) => {
      if (stopped) return
      if (settings.watch && by !== "user" && !always) return watched("stop", by, "", reason, detail)
      stopped = { reason, detail: String(detail || "").slice(0, 2000), by, time: new Date().toISOString() }
      halted.add(norm(here))
      log("STOP", by || "", reason, JSON.stringify(stopped.detail).slice(0, 400))
      try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true })
        fs.writeFileSync(FILE, JSON.stringify(stopped, null, 1))
      } catch (e) {
        log("error", e?.message || String(e))
      }
      const text = note(reason, by, stopped.detail)
      try {
        fs.writeFileSync(path.join(root, NOTE), text)
      } catch (e) {
        log("error", e?.message || String(e))
      }
      for (const ms of [50, 1000, 3000]) setTimeout(interrupt, ms) // after the refusal of the call has reached the session
      setTimeout(async () => {
        const leads = []
        for (const id of active.keys()) if (!(await parentOf(id))) leads.push(id)
        for (const id of leads)
          try {
            await ctx.session.synthetic({ sessionID: id, text: `<system-reminder>\n[killswitch] ${text}</system-reminder>`, description: `${TRANSLATIONS[settings.language]?.title ?? "Emergency stop"}: ${translate(reason)}`, resume: false })
          } catch (e) {
            log("notice failed", id, e?.message || String(e))
          }
      }, 4000)
    }
    const strike = (id, what) => {
      const now = Date.now()
      refused.push({ now, id })
      while (refused.length && now - refused[0].now > REFUSED_MS) refused.shift()
      if (refused.length < MAX_REFUSED_ALL && refused.filter((r) => r.id === id).length < MAX_REFUSED) return
      refused.length = 0
      trip(`too many refused calls within ${REFUSED_MS / 60000} minutes`, what, active.get(id))
    }

    await ctx.session.hook("context", (event) => {
      if (covered(event.agent)) active.set(event.sessionID, event.agent)
    })
    await ctx.session.hook("prompt", async (event) => {
      if (!stopped) return
      try {
        const s = await ctx.session.get({ sessionID: event.sessionID })
        if (s.parentID) return // the start of a subagent is not a message of the user
        if (fs.existsSync(stopFile)) return
        log("released by a message of the user in", event.sessionID)
        stopped = undefined
        halted.delete(norm(here))
        refused.length = 0
        most = 0
        fs.rmSync(FILE, { force: true })
        fs.rmSync(path.join(root, NOTE), { force: true })
      } catch (e) {
        log("error", e?.stack || String(e))
      }
    })

    // `always`: also in watch mode. For tools that run inside OpenCode with full rights and name a file of secrets.txt
    // exactly: the launcher does not stand behind them, and a listed path is not a guess.
    const refuse = (event, v, text, always = false) => {
      if (settings.watch && !always) return watched(v.act, event.agent, event.tool, v.why, text)
      log(v.act, event.agent, event.tool, v.why, JSON.stringify(text).slice(0, 300))
      if (v.act === "stop") {
        trip(v.why, `${event.tool}: ${text}`, event.agent, true)
        throw new Error(message())
      }
      // The refusal is counted below, together with those of the other guards.
      throw new Error(`Blocked for unattended agents: ${v.why}. Do it another way, or list it in the final report as a step for the user.`)
    }
    const before = (event) => {
      active.set(event.sessionID, event.agent)
      if (broken) throw new Error(`Blocked: the emergency stop does not work (${broken}), so these agents may not work. Report this.`)
      if (!stopped && fs.existsSync(stopFile)) trip("the file STOP is in the project", "", "user")
      if (stopped) {
        setTimeout(interrupt, 50)
        throw new Error(message())
      }
      const i = event.input || {}
      const at = (p) => real(path.isAbsolute(p) ? p : path.join(here, p))
      if (event.tool === "shell") {
        const command = String(i.command || "")
        const dir = i.workdir ? at(String(i.workdir)) : here
        const v = check(command, dir, root, list)
        if (v) refuse(event, v, command)
      }
      const p = i.path ?? i.filePath ?? i.file_path
      if (/^(?:read|list|edit|write)$/.test(event.tool) && p && isSecret(list, norm(at(String(p))))) refuse(event, { act: "stop", why: "it opens a file with keys or passwords" }, String(p), true)
      if (event.tool === "grep" && holdsSecret(list, norm(at(String(p || "."))))) refuse(event, { act: "refuse", why: "the search would go through files with keys or passwords. Search in a narrower folder" }, String(p), true)
      if (event.tool === "webfetch" && (/^\s*file:/i.test(String(i.url)) || verdict(String(i.url), list)?.act === "stop")) refuse(event, { act: "stop", why: "it opens a local file or OpenCode's own service through the web tool" }, String(i.url), true)
      if (/^(?:edit|write)$/.test(event.tool) && p && CODE.test(String(p))) {
        const v = verdict(String(i.content ?? i.newString ?? i.new_string ?? ""), list)
        if (v) refuse(event, { act: "refuse", why: `the text of the file is not allowed: ${v.why}` }, String(p))
      }
    }
    await ctx.tool.hook("execute.before", (event) => {
      if (!covered(event.agent)) return
      before(event) // any error in here refuses the call
      running.add(event.sessionID + event.id)
    })
    await ctx.tool.hook("execute.after", (event) => {
      running.delete(event.sessionID + event.id)
    })
    // Refusals of all guards end up here, also those that never reach execute.after.
    const controller = new AbortController()
    ;(async () => {
      for await (const event of ctx.event.subscribe()) {
        if (controller.signal.aborted) return
        const d = event.data
        if (event.type !== "session.tool.failed" || !active.has(d?.sessionID)) continue
        running.delete(d.sessionID + d.id)
        const text = String(d.error?.message || "")
        if (/^Blocked/.test(text)) strike(d.sessionID, `the last one: ${text.slice(0, 300)}`)
      }
    })().catch((e) => log("event stream ended", String(e)))

    // ---- while calls run
    let busy = false
    const timer = setInterval(async () => {
      if (busy || stopped || broken || !active.size) return
      busy = true
      try {
        if (fs.existsSync(stopFile)) return trip("the file STOP is in the project", "", "user")
        if (!running.size && most) return
        const n = await count(root)
        const now = Date.now()
        if (lost(most, n)) {
          trip("a large part of the project's files is gone", `${most} files before, ${n} now`, [...running].length ? "a running command" : "")
          if (!settings.watch) return
        }
        if (n >= most || lost(most, n) || now - mostAt > 10 * 60 * 1000) {
          most = n
          mostAt = now
        }
      } catch (e) {
        log("error", e?.stack || String(e))
      } finally {
        busy = false
      }
    }, POLL_MS)
    timer.unref?.()
    return () => {
      clearInterval(timer)
      controller.abort()
    }
  },
}
