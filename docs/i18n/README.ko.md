# opencode-win-guard

[English](../../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **한국어** · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md)

> 이 문서는 번역본입니다. 기준 문서는 [영어 README](../../README.md)이며, 내용이 서로 다르면 영어 문서가 옳습니다.

**Windows**에서 [opencode](https://opencode.ai) 에이전트를 위한 쓰기 샌드박스와 비상 정지 기능으로, 에이전트가 프로젝트 폴더에서 무인으로 작업할 수 있게 해 줍니다. 관리자 권한, Docker, WSL, 네트워크 접근이 필요 없습니다.

![스크립트로 동작하는 에이전트가 자기 폴더 밖에 쓰려다 플러그인과 Windows에게 거부당하고, 이어 키 파일을 읽자 사용자가 메시지를 쓸 때까지 모든 에이전트가 정지됩니다](../media/demo.gif)

*격리된 `opencode serve`에서 실제 플러그인과 런처를 대상으로, 스크립트로 동작하는 에이전트를 실행한 모습입니다.*

| 구성 요소 | 하는 일 |
|---|---|
| **샌드박스** (`win-guard-sandbox.js` + 런처) | 에이전트는 모든 것을 읽을 수 있지만, 쓰기는 프로젝트 폴더 안에서만 할 수 있습니다. `edit`/`write`의 경우 플러그인이 실제 경로(링크를 해석한 경로)를 검사합니다. 셸의 경우 **Windows 자체가** 폴더 밖에서의 모든 쓰기, 삭제, 권한 변경을 거부합니다: 명령은 Low 무결성 토큰으로 실행되고, Low 레이블이 붙은 것은 프로젝트 폴더와 캐시 폴더뿐입니다. |
| **비밀 파일** (런처, `secrets.txt`) | 키와 비밀번호가 담긴 파일(SSH 키, 클라우드 자격 증명, 브라우저 키, opencode 자체의 서비스 비밀번호...)에는 Low 프로그램이 넘어서 읽을 수 없는 필수 레이블이 붙습니다. 사용자 자신의 프로그램에는 영향이 없습니다. |
| **제한** (런처) | 모든 명령은 작업 개체(job object) 안에서 실행됩니다: 사용자를 위해 정해진 양의 RAM을 항상 비워 두는 엄격한 메모리 상한, 디스크 여유 공간의 최솟값, 프로젝트와 캐시를 합한 최대 크기. 제한을 넘으면 명령이 종료됩니다(종료 코드 125). |
| **킬 스위치** (`win-guard-killswitch.js`) | 모든 호출을 **실행되기 전에** 검사합니다: 셸 명령과, 그 명령이 시작하는 프로젝트 스크립트(`build.ps1`, `npm test` 스크립트...). 명백히 해로운 호출(키 읽기, Windows에 저장된 비밀번호 요청, 디스크 지우기, Defender 끄기, 외부에서 opencode 제어하기...)은 **해당 폴더의 모든 에이전트**를 즉시 정지시킵니다. 위험한 호출(스크립트를 확인하지 않고 내려받아 실행하기, 파일 업로드, 자동 시작 항목)은 거부됩니다. 프로젝트 안의 `STOP` 파일, 많은 수의 거부된 호출, 프로젝트 파일 상당 부분의 소실도 에이전트를 정지시킵니다. 정지 상태는 opencode를 다시 시작해도 사용자가 메시지를 쓸 때까지 유지됩니다. |

이 도구는 에이전트의 실수와, 에이전트가 설득당해 실행할 수 있는 해로운 명령으로부터 보호합니다. 탈출하도록 작성된 프로그램을 막는 벽은 아닙니다: 이 도구에 의존하기 전에 [보안 모델](../security-model.md)을 읽어 보세요.

## 요구 사항

- Windows 10 또는 11, NTFS.
- opencode 2.2 이상(V2 플러그인 API). Windows 10 22H2에서 opencode 2.2.3으로 테스트했습니다.
- .NET Framework 4의 C# 컴파일러(`%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`). Windows에 포함되어 있으므로 따로 설치할 것이 없습니다: 설치 프로그램은 [`launcher/`](../../launcher)의 소스로 런처를 빌드하며, 미리 빌드된 프로그램은 전혀 내려받지 않습니다.
- bash를 쓰려면: Git for Windows. Git Bash는 자기 자신의 복사본에서만 Low 무결성으로 시작되므로, 설치 프로그램이 이를 샌드박스 폴더에 복사합니다(약 400 MB). 없으면(`-NoGit`) 에이전트는 PowerShell과 cmd를 사용합니다.

## 설치

[최신 릴리스](https://github.com/retretor/opencode-win-guard/releases/latest)의 소스를 내려받거나(또는 저장소를 클론하고), PowerShell에서 다음을 실행합니다:

```powershell
cd opencode-win-guard
.\install.ps1 -Folder C:\Users\me\Projects\my-project
```

설치 프로그램은 런처를 `~\.local\share\opencode\sandbox\bin`에 빌드하고, Git을 복사하고, 예제로부터 `secrets.txt`와 `~\.config\opencode\win-guard.json`을 만들고(기존 파일은 유지), 플러그인을 `~\.config\opencode\plugins`에 복사한 다음, `secrets.txt`에 적힌 파일들을 잠급니다. 그다음:

1. **`~\.local\share\opencode\sandbox\secrets.txt`를 읽고** 사용 중인 컴퓨터에서 키와 비밀번호가 담긴 파일을 추가하세요. `bin` 폴더의 `protect.exe --list`로 무엇이 잠겼는지 볼 수 있습니다.
2. opencode를 다시 시작하고 프로젝트 폴더에서 세션을 시작합니다. 로그 `~\.local\share\opencode\log\win-guard.log`에 `on for <folder>`라고 나옵니다.

업데이트하려면 `install.ps1`을 다시 실행하세요. 모두 제거하려면 `uninstall.ps1`을 실행합니다(`-RemoveData`는 Git 복사본, 캐시, 설정도 삭제합니다). PowerShell이 스크립트 실행을 거부하면 `powershell -ExecutionPolicy Bypass -File .\install.ps1 ...`로 시작하세요.

## 설정: `~\.config\opencode\win-guard.json`

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

| 키 | 기본값 | 의미 |
|---|---|---|
| `folders` | (필수) | 절대 경로. 이 중 하나(또는 그 하위)에서 시작한 세션은 보호되고, 그 밖의 모든 곳에서는 아무것도 바뀌지 않습니다. 드라이브 전체, 사용자 폴더, 시스템 폴더는 거부됩니다. |
| `limits.ramFreeGB` | 4 | 사용자를 위해 항상 비워 두는 메모리. 명령은 이만큼의 메모리가 생길 때까지 시작을 최대 60초 기다리며, 여유 메모리가 이 값 아래로 떨어지면 종료됩니다. |
| `limits.diskFreeGB` | 15 | 폴더가 있는 드라이브에 유지되는 여유 공간. |
| `limits.folderGB` | 15 | 캐시를 포함한 폴더의 최대 크기. |
| `agents` | `"*"` | 보호 대상 에이전트: 전부라면 `"*"`, 또는 이름 목록. 나머지(예: 사용자가 직접 대화하는 에이전트)는 전체 권한으로 작동합니다. 목록을 지정하면, 보호 대상 에이전트는 그 목록에 있는 서브에이전트만 시작할 수 있습니다. |
| `extraTools` | `[]` | 에이전트가 사용할 수 있는 다른 플러그인의 도구. 아무것도 쓰지 않는다고 알려지지 않은 도구는 모두 거부됩니다. 새 플러그인이나 MCP 서버는 전체 권한으로 실행되기 때문입니다. 도구가 아무것도 쓰지 않거나 자신의 쓰기를 스스로 검사하는 경우에만 이름을 추가하세요. 예: [opencode-crew-mail](https://github.com/retretor/opencode-crew-mail)용 `["crew_list", "crew_send"]`. |
| `alsoWritable` | `[]` | `edit`와 `write`가 변경할 수 있는 추가 폴더(셸에는 적용되지 않음). |
| `lowLabel` | `[]` | Low 레이블을 붙여 샌드박스 안의 프로그램이 쓸 수 있게 할 추가 폴더. 경로는 `%APPDATA%`, `%LOCALAPPDATA%` 또는 다른 환경 변수로 시작할 수 있습니다. 프로젝트에서 빌드한 프로그램의 데이터 폴더에 유용합니다: 그런 프로그램은 낮춰진 권한으로 실행되며(사용자가 직접 시작해도 마찬가지), 설정이나 저장 파일을 쓰지 못하면 실패할 수 있습니다. 없는 폴더는 생성됩니다. |
| `env` | `{}` | 샌드박스 안의 명령에 줄 추가 환경 변수. 예: `{ "CARGO_HOME": "${cache}/cargo" }`. `${cache}`는 프로젝트의 캐시 폴더, `${folder}`는 프로젝트 폴더입니다. 샌드박스는 이미 npm, yarn, pnpm, bun, pip, uv, Poetry, Go, Gradle, NuGet, .NET의 캐시와 `TEMP`, `APPDATA`, `LOCALAPPDATA`를 그곳으로 옮겨 둡니다. |
| `language` | `"en"` | 정지 안내문의 언어: `"en"`, `"zh-CN"`, `"ja"`, `"ko"`, `"es"`, `"pt-BR"`, `"de"`, `"fr"` 또는 `"ru"`. 다른 언어도 환영합니다. [CONTRIBUTING.md](../../CONTRIBUTING.md#translations)를 참고하세요. |
| `killswitch` | `"on"` | `"watch"`로 두면 검사를 먼저 시험해 볼 수 있습니다. 명령과 파일 내용은 거부되지 않고 에이전트도 정지하지 않으며, 로그에는 원래 어떻게 되었을지만 기록됩니다(`doctor.ps1`이 집계합니다). `read`, `grep`, `webfetch`로 `secrets.txt`의 파일을 읽는 것과 `STOP` 파일은 여전히 에이전트를 정지시키고, 샌드박스는 평소대로 동작합니다. 그 밖의 값은 모두 켜짐으로 취급합니다. |

설정 파일이 손상되어도 보호 기능이 꺼지지 않습니다: 셸이 거부되고, 로그에 그 이유가 남습니다.

## 에이전트에게 보이는 것

- 세션마다 한 번, 어디에 쓸 수 있는지, 비밀 파일은 열 수 없다는 것, 제한 사항, 해로운 호출은 모두를 정지시킨다는 것을 안내받습니다.
- 거부된 도구 호출은 이유와 함께 `Blocked: ...`를 반환합니다. Windows의 거부는 셸에서 "Access denied"로 나타납니다.
- 런처 종료 코드: **125** 제한이나 `STOP` 때문에 명령이 종료되었거나 실행되지 못함, **126** 명령이 시작되지 않음(샌드박스가 불완전함). 그 대신 명령이 전체 권한으로 실행되는 일은 결코 없습니다.
- 비상 정지 후에는 모든 호출이 `EMERGENCY STOP: <reason>`으로 실패하고, 에이전트는 중단되며(리드부터 먼저), 프로젝트의 `AGENT_STOPPED.txt`에 무슨 일이 있었는지 적힙니다. `STOP` 파일을 만들었다면 삭제한 다음, 해당 폴더의 세션에 아무 메시지나 쓰세요.

## 설정 점검

```powershell
& "$HOME\.local\share\opencode\sandbox\doctor.ps1"
& "$HOME\.local\share\opencode\sandbox\doctor.ps1" -Why "npm test"
```

플러그인, 런처, 설정이 제자리에 있는지, 폴더와 그 캐시에 Low 레이블이 붙어 있는지 확인하고, 런처를 통해 실제 명령을 하나 실행합니다. 이 명령은 Low 무결성으로 실행되어야 하며, 캐시에는 쓸 수 있지만 다른 곳에 쓰거나 닫힌 파일을 읽을 수는 없어야 합니다. 에이전트가 정지 상태인지와 로그의 최근 거부 및 정지도 보여 주며, watch 모드에서는 거부되었을 항목을 집계합니다. 프로젝트 폴더에서 실행하거나 `-Folder`를 지정하세요. `-Why "<명령>"`을 주면 에이전트가 실행하기 전에 플러그인이 그 명령을 어떻게 처리할지 알려 줍니다(Node.js 필요). 아무것도 바꾸지 않으며, 문제가 있으면 종료 코드 1로 끝납니다.

## 직접 에이전트 정지하기

프로젝트 폴더에 `STOP`이라는 이름의 파일을 만드세요. 실행 중인 명령은 1~2초 안에 종료되고, 새 명령은 시작되지 않으며, 해당 폴더의 모든 에이전트가 중단됩니다.

## 다른 플러그인과 함께 쓰기

- `globalThis[Symbol.for("opencode-win-guard.halted")]`는 정지된 폴더들(소문자, 슬래시 `/` 사용)의 `Set`입니다. 스스로 에이전트를 이어서 실행하는 플러그인(오토파일럿)은 먼저 여기를 확인해야 합니다.
- 다른 플러그인의 도구에는 `extraTools`가 필요합니다. 위를 참고하세요.

## 런처를 C#으로 작성한 이유

샌드박스에는 어떤 스크립트도 직접 호출할 수 없는 Windows 함수가 필요합니다: Low 무결성 수준의 제한된 토큰, `CreateProcessAsUser`, 메모리 제한이 있는 작업 개체, 파일의 필수 레이블. C#은 평범한 P/Invoke로 이 함수들에 접근할 수 있고, 그 컴파일러는 .NET Framework의 일부로 모든 Windows 10과 11에 포함되어 있습니다. 그래서 런처는 설치할 때 사용자의 컴퓨터에서 읽을 수 있는 소스로부터 빌드되며, SDK도, 다운로드도, 인터넷에서 받은 서명되지 않은 프로그램도 필요 없습니다. 이 오래된 컴파일러로 빌드할 수 있도록 코드는 C# 5로 제한됩니다.

## 테스트

```powershell
npm test                                   # pure parts, any OS
$env:WIN_GUARD_E2E = "1"; npm run test:e2e # also the launcher and both plugins in a real `opencode serve` with a fake model
```

엔드투엔드 테스트는 자체 비밀 파일을 둔 임시 폴더에서 동작하고, 런처를 스스로 빌드하며, 설정한 레이블은 모두 원래대로 되돌립니다. 사용자의 opencode 설정, 세션, 샌드박스는 건드리지 않으며, 프로바이더나 계정도 필요 없습니다.

## 관련 프로젝트

2026년 11월에 찾은 것들이며, 이 중 Windows에서 셸을 샌드박스로 격리하거나 세션 트리 전체를 정지시키는 것은 없습니다:

- [opencode-sandbox](https://github.com/Hamza-Abili/opencode-sandbox): bubblewrap(Linux)과 Seatbelt(macOS)을 사용하는 셸용 OS 샌드박스. 네이티브 Windows는 지원하지 않습니다.
- [opencode-guard](https://github.com/gigi206/opencode-guard): 도구 호출에 대한 규칙 기반 거부/확인(deny/ask)과 선택적 판단 모델, 그리고 비밀 정보가 모델에 닿기 전에 가리는 기능.
- [opencode-hook-safety](https://github.com/MansM/opencode-hook-safety): 비밀 경로와 파괴적인 명령에 대한 거부 목록, 선택적 분류기.
- [opencode-damage-control](https://github.com/nicounii/opencode-damage-control): 90개 이상의 위험한 명령 패턴 차단, 3단계 경로 보호.

이 프로젝트들은 명령 텍스트와 경로 수준에서 동작합니다. 운영 체제 자체의 거부를 더하는 이 플러그인과 잘 어울립니다.

## 기여

버그 보고, 아이디어, 풀 리퀘스트를 환영합니다: [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참고하세요. 샌드박스를 우회하는 방법은 비공개로 알려 주세요. [SECURITY.md](../../SECURITY.md)를 참고하세요.

## 라이선스

[MIT](../../LICENSE)
