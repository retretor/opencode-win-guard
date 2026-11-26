# opencode-win-guard

[English](../../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español** · [Português (Brasil)](README.pt-BR.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Русский](README.ru.md)

> Esto es una traducción. La referencia es el [README en inglés](../../README.md); donde difieran, el inglés es el correcto.

Un sandbox de escritura y una parada de emergencia para agentes de [opencode](https://opencode.ai) en **Windows**, para dejar que los agentes trabajen desatendidos en una carpeta de proyecto. Sin derechos de administrador, sin Docker, sin WSL, sin acceso a la red.

![Un agente guionizado escribe fuera de su carpeta y es rechazado por el plugin y por Windows; después lee un archivo de claves y detiene a todos los agentes hasta que el usuario escribe](../media/demo.gif)

*Un agente guionizado contra los plugins y el launcher reales en un `opencode serve` aislado.*

| Parte | Qué hace |
|---|---|
| **Sandbox** (`win-guard-sandbox.js` + launcher) | Los agentes leen todo, pero solo escriben dentro de la carpeta del proyecto. Para `edit`/`write`, el plugin comprueba la ruta real (con los enlaces resueltos). Para el shell, **el propio Windows** rechaza toda escritura, eliminación o cambio de permisos fuera de la carpeta: los comandos se ejecutan con un token de integridad Low, y solo la carpeta del proyecto y una carpeta de caché llevan la etiqueta Low. |
| **Archivos secretos** (launcher, `secrets.txt`) | Los archivos con claves y contraseñas (claves SSH, credenciales de la nube, claves del navegador, la contraseña de servicio del propio opencode...) reciben una etiqueta obligatoria que los programas Low no pueden atravesar para leerlos. Tus propios programas no se ven afectados. |
| **Límites** (launcher) | Cada comando se ejecuta en un objeto de trabajo (job object): un tope estricto de memoria que mantiene libre para ti una cantidad fija de RAM, un mínimo de espacio libre en disco y un tamaño máximo del proyecto más la caché. Al superar un límite, el comando se termina (código de salida 125). |
| **Killswitch** (`win-guard-killswitch.js`) | Comprueba cada llamada **antes de que se ejecute**: el comando del shell y los scripts del proyecto que este inicia (`build.ps1`, scripts de `npm test`...). Las llamadas claramente dañinas (leer claves, pedir a Windows las contraseñas guardadas, borrar discos, desactivar Defender, controlar opencode desde fuera...) detienen de inmediato a **todos los agentes de la carpeta**. Las arriesgadas (descargar y ejecutar un script sin revisarlo, subir archivos, entradas de inicio automático) se rechazan. Un archivo `STOP` en el proyecto, muchas llamadas rechazadas o la desaparición de una gran parte de los archivos del proyecto también los detienen. La parada sobrevive a un reinicio de opencode hasta que escribas un mensaje. |

Protege contra los errores de un agente y contra los comandos dañinos que se le puedan inducir a ejecutar. No es un muro contra un programa escrito para escapar: lee el [modelo de seguridad](../security-model.md) antes de confiar en él.

## Requisitos

- Windows 10 u 11, NTFS.
- opencode 2.2 o posterior (API de plugins V2). Probado con opencode 2.2.3 en Windows 10 22H2.
- El compilador de C# de .NET Framework 4 (`%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`). Forma parte de Windows, así que no hay que instalar nada: el instalador compila el launcher a partir de las fuentes de [`launcher/`](../../launcher), y no se descarga ningún programa precompilado.
- Para bash: Git for Windows. El instalador lo copia (unos 400 MB) en la carpeta del sandbox, porque Git Bash solo arranca con integridad Low desde una copia propia. Sin él (`-NoGit`), los agentes usan PowerShell y cmd.

## Instalación

Descarga el código fuente de la [última versión](https://github.com/retretor/opencode-win-guard/releases/latest) (o clona el repositorio) y, en PowerShell:

```powershell
cd opencode-win-guard
.\install.ps1 -Folder C:\Users\me\Projects\my-project
```

El instalador compila el launcher en `~\.local\share\opencode\sandbox\bin`, copia Git, crea `secrets.txt` y `~\.config\opencode\win-guard.json` a partir de los ejemplos (los existentes se conservan), copia los plugins en `~\.config\opencode\plugins` y cierra los archivos de `secrets.txt`. Después:

1. **Lee `~\.local\share\opencode\sandbox\secrets.txt`** y añade los archivos con claves y contraseñas de tu equipo. `protect.exe --list` en la carpeta `bin` muestra qué está cerrado.
2. Reinicia opencode e inicia una sesión en la carpeta del proyecto. El registro `~\.local\share\opencode\log\win-guard.log` dice `on for <folder>`.

Vuelve a ejecutar `install.ps1` para actualizar; para quitarlo todo, `uninstall.ps1` (`-RemoveData` también elimina la copia de Git, las cachés y los ajustes). Si PowerShell se niega a ejecutar el script, inícialo con `powershell -ExecutionPolicy Bypass -File .\install.ps1 ...`.

## Ajustes: `~\.config\opencode\win-guard.json`

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

| Clave | Valor predeterminado | Significado |
|---|---|---|
| `folders` | (obligatorio) | Rutas absolutas. Una sesión iniciada en una de ellas (o debajo) queda protegida; en cualquier otro lugar no cambia nada. Se rechazan una unidad completa, tu carpeta de usuario o una carpeta del sistema. |
| `limits.ramFreeGB` | 4 | Memoria que siempre queda libre para ti. Un comando espera hasta 60 s a que la haya para arrancar, y se termina si la memoria libre baja de ese valor. |
| `limits.diskFreeGB` | 15 | Espacio libre que conserva la unidad de la carpeta. |
| `limits.folderGB` | 15 | Tamaño máximo de la carpeta junto con su caché. |
| `agents` | `"*"` | Agentes que quedan protegidos: `"*"` para todos, o una lista de nombres. Los demás (tu propio agente interactivo, por ejemplo) trabajan con todos los derechos. Con una lista, un agente protegido solo puede iniciar subagentes de esa lista. |
| `extraTools` | `[]` | Herramientas de otros plugins que los agentes pueden usar. Se rechaza toda herramienta de la que no se sepa que no escribe nada, porque un plugin o servidor MCP nuevo se ejecutaría con todos los derechos. Añade un nombre solo si la herramienta no escribe nada o comprueba sus propias escrituras, p. ej. `["crew_list", "crew_send"]` para [opencode-crew-mail](https://github.com/retretor/opencode-crew-mail). |
| `alsoWritable` | `[]` | Carpetas adicionales que `edit` y `write` pueden modificar (no el shell). |
| `lowLabel` | `[]` | Carpetas adicionales que reciben la etiqueta Low, para que los programas del sandbox puedan escribir en ellas. Las rutas pueden empezar con `%APPDATA%`, `%LOCALAPPDATA%` u otra variable de entorno. Útil para la carpeta de datos de un programa compilado en el proyecto: ese programa se ejecuta con derechos reducidos (también cuando lo inicias tú) y puede fallar si no puede escribir sus ajustes o partidas guardadas. Si la carpeta no existe, se crea. |
| `env` | `{}` | Variables de entorno adicionales para los comandos del sandbox, p. ej. `{ "CARGO_HOME": "${cache}/cargo" }`. `${cache}` es la carpeta de caché del proyecto y `${folder}`, la carpeta del proyecto. El sandbox ya traslada allí las cachés de npm, yarn, pnpm, bun, pip, uv, Poetry, Go, Gradle, NuGet y .NET, además de `TEMP`, `APPDATA` y `LOCALAPPDATA`. |
| `language` | `"en"` | Idioma de la nota de parada: `"en"`, `"zh-CN"`, `"ja"`, `"ko"`, `"es"`, `"pt-BR"`, `"de"`, `"fr"` o `"ru"`. Se agradecen más idiomas, consulta [CONTRIBUTING.md](../../CONTRIBUTING.md#translations). |

Un archivo de ajustes dañado no desactiva la protección: el shell se rechaza y el registro indica por qué.

## Qué ven los agentes

- Una vez por sesión se les indica dónde pueden escribir, que los archivos secretos no se pueden abrir, los límites y que las llamadas dañinas detienen a todos.
- Una llamada a herramienta rechazada devuelve `Blocked: ...` con el motivo; los rechazos de Windows aparecen en el shell como "Access denied".
- Códigos de salida del launcher: **125**: un límite o `STOP` terminó o impidió el comando; **126**: el comando no se inició (sandbox incompleto). En ningún caso el comando se ejecuta con todos los derechos en su lugar.
- Tras una parada de emergencia, toda llamada falla con `EMERGENCY STOP: <reason>`, los agentes se interrumpen (primero los líderes) y `AGENT_STOPPED.txt` en el proyecto explica qué pasó. Elimina el archivo `STOP` si lo creaste y luego escribe cualquier mensaje en una sesión de la carpeta.

## Detener tú mismo a los agentes

Crea un archivo llamado `STOP` en la carpeta del proyecto. Los comandos en ejecución se terminan en uno o dos segundos, no se inician comandos nuevos y todos los agentes de la carpeta se interrumpen.

## Uso con otros plugins

- `globalThis[Symbol.for("opencode-win-guard.halted")]` es un `Set` de las carpetas detenidas (en minúsculas, con barras normales). Un plugin que continúa agentes por su cuenta (un piloto automático) debería consultarlo primero.
- Las herramientas de otros plugins necesitan `extraTools`, ver más arriba.

## Por qué el launcher está escrito en C#

El sandbox necesita funciones de Windows que ningún script puede llamar directamente: un token restringido con nivel de integridad Low, `CreateProcessAsUser`, objetos de trabajo (job objects) con límites de memoria y etiquetas obligatorias en los archivos. C# llega a ellas con P/Invoke simple, y su compilador viene con todo Windows 10 y 11 como parte de .NET Framework. Así, el launcher se compila a partir de fuentes legibles en tu propio equipo durante la instalación, sin SDK, sin descargas y sin ningún programa sin firmar de internet. El código se limita a C# 5 para que este compilador antiguo pueda compilarlo.

## Pruebas

```powershell
npm test                                   # pure parts, any OS
$env:WIN_GUARD_E2E = "1"; npm run test:e2e # also the launcher and both plugins in a real `opencode serve` with a fake model
```

Las pruebas de extremo a extremo trabajan en carpetas temporales con su propio archivo secreto, compilan el launcher para sí mismas y restauran todas las etiquetas que ponen. No tocan tu configuración de opencode, tus sesiones ni tu sandbox, y no necesitan proveedor ni cuenta.

## Proyectos relacionados

Encontrados en noviembre de 2026; ninguno de ellos aísla el shell en Windows ni detiene un árbol de sesiones completo:

- [opencode-sandbox](https://github.com/Hamza-Abili/opencode-sandbox): un sandbox del sistema operativo para el shell con bubblewrap (Linux) y Seatbelt (macOS); Windows nativo no está soportado.
- [opencode-guard](https://github.com/gigi206/opencode-guard): denegar/preguntar según reglas para las llamadas a herramientas, más un modelo de decisión opcional, y ocultación de secretos antes de que lleguen al modelo.
- [opencode-hook-safety](https://github.com/MansM/opencode-hook-safety): listas de denegación para rutas secretas y comandos destructivos, clasificador opcional.
- [opencode-damage-control](https://github.com/nicounii/opencode-damage-control): bloquea más de 90 patrones de comandos peligrosos, tres niveles de protección de rutas.

Trabajan a nivel del texto de los comandos y de las rutas; se combinan bien con este, que añade el rechazo del propio sistema operativo.

## Contribuir

Los informes de errores, las ideas y los pull requests son bienvenidos: consulta [CONTRIBUTING.md](../../CONTRIBUTING.md). Formas de saltarse el sandbox: por favor, infórmalas en privado, consulta [SECURITY.md](../../SECURITY.md).

## Licencia

[MIT](../../LICENSE)
