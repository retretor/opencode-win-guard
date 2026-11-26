# opencode-win-guard

[English](../../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Deutsch](README.de.md) · **Français** · [Русский](README.ru.md)

> Ceci est une traduction. La référence est le [README en anglais](../../README.md) ; en cas de divergence, c'est la version anglaise qui fait foi.

Un bac à sable d'écriture et un arrêt d'urgence pour les agents [opencode](https://opencode.ai) sous **Windows**, pour laisser des agents travailler sans surveillance dans un dossier de projet. Sans droits d'administrateur, sans Docker, sans WSL, sans accès réseau.

![Un agent scripté écrit hors de son dossier et se fait refuser par le plugin et par Windows, puis lit un fichier de clés et arrête tous les agents jusqu'à ce que l'utilisateur écrive](../media/demo.gif)

*Un agent scripté face aux vrais plugins et au vrai lanceur dans un `opencode serve` isolé.*

| Partie | Ce qu'elle fait |
|---|---|
| **Bac à sable** (`win-guard-sandbox.js` + lanceur) | Les agents lisent tout, mais n'écrivent qu'à l'intérieur du dossier du projet. Pour `edit`/`write`, le plugin vérifie le chemin réel (liens résolus). Pour le shell, **Windows lui-même** refuse toute écriture, suppression et modification de droits hors du dossier : les commandes s'exécutent avec un jeton d'intégrité Low, et seuls le dossier du projet et un dossier de cache portent l'étiquette Low. |
| **Fichiers secrets** (lanceur, `secrets.txt`) | Les fichiers contenant des clés et des mots de passe (clés SSH, identifiants cloud, clés de navigateur, mot de passe de service d'opencode lui-même...) reçoivent une étiquette obligatoire que les programmes Low ne peuvent pas franchir pour les lire. Vos propres programmes ne sont pas concernés. |
| **Limites** (lanceur) | Chaque commande s'exécute dans un objet job : un plafond mémoire strict qui garde une quantité définie de RAM libre pour vous, un minimum d'espace disque libre, une taille maximale pour le projet et son cache réunis. Au-delà d'une limite, la commande est terminée (code de sortie 125). |
| **Killswitch** (`win-guard-killswitch.js`) | Vérifie chaque appel **avant son exécution** : la commande shell et les scripts du projet qu'elle lance (`build.ps1`, scripts `npm test`...). Les appels clairement nuisibles (lire des clés, demander à Windows les mots de passe enregistrés, effacer des disques, désactiver Defender, contrôler opencode de l'extérieur...) arrêtent **tous les agents du dossier** d'un coup. Les appels risqués (télécharger et exécuter un script sans l'avoir examiné, téléverser des fichiers, entrées de démarrage automatique) sont refusés. Un fichier `STOP` dans le projet, de nombreux appels refusés ou la disparition d'une grande partie des fichiers du projet les arrêtent aussi. L'arrêt survit à un redémarrage d'opencode, jusqu'à ce que vous écriviez un message. |

Il protège contre les erreurs d'un agent et contre les commandes nuisibles qu'on pourrait l'amener à exécuter. Ce n'est pas un mur contre un programme écrit pour s'en échapper : lisez le [modèle de sécurité](../security-model.md) avant de vous y fier.

## Prérequis

- Windows 10 ou 11, NTFS.
- opencode 2.2 ou plus récent (API de plugins V2). Testé avec opencode 2.2.3 sous Windows 10 22H2.
- Le compilateur C# du .NET Framework 4 (`%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`). Il fait partie de Windows, il n'y a donc rien à installer : l'installateur compile le lanceur à partir des sources de [`launcher/`](../../launcher), et aucun programme précompilé n'est téléchargé.
- Pour bash : Git for Windows. L'installateur le copie (environ 400 Mo) dans le dossier du bac à sable, car Git Bash ne démarre en intégrité Low qu'à partir d'une copie qui lui est propre. Sans lui (`-NoGit`), les agents disposent de PowerShell et de cmd.

## Installation

Téléchargez les sources de la [dernière version](https://github.com/retretor/opencode-win-guard/releases/latest) (ou clonez le dépôt), puis dans PowerShell :

```powershell
cd opencode-win-guard
.\install.ps1 -Folder C:\Users\me\Projects\my-project
```

L'installateur compile le lanceur dans `~\.local\share\opencode\sandbox\bin`, copie Git, crée `secrets.txt` et `~\.config\opencode\win-guard.json` à partir des exemples (les fichiers existants sont conservés), copie les plugins dans `~\.config\opencode\plugins`, et ferme l'accès aux fichiers listés dans `secrets.txt`. Ensuite :

1. **Lisez `~\.local\share\opencode\sandbox\secrets.txt`** et ajoutez-y les fichiers de votre ordinateur qui contiennent des clés et des mots de passe. `protect.exe --list` dans le dossier `bin` montre ce qui est fermé.
2. Redémarrez opencode et lancez une session dans le dossier du projet. Le journal `~\.local\share\opencode\log\win-guard.log` indique `on for <folder>`.

Relancez `install.ps1` pour mettre à jour ; pour tout supprimer, lancez `uninstall.ps1` (`-RemoveData` supprime aussi la copie de Git, les caches et les paramètres). Si PowerShell refuse d'exécuter le script, lancez-le avec `powershell -ExecutionPolicy Bypass -File .\install.ps1 ...`.

## Paramètres : `~\.config\opencode\win-guard.json`

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

| Clé | Par défaut | Signification |
|---|---|---|
| `folders` | (obligatoire) | Chemins absolus. Une session lancée dans l'un d'eux (ou en dessous) est protégée ; partout ailleurs, rien ne change. Un disque entier, votre dossier utilisateur ou un dossier système sont refusés. |
| `limits.ramFreeGB` | 4 | Mémoire qui reste toujours libre pour vous. Une commande attend jusqu'à 60 s que cette mémoire soit disponible pour démarrer, et elle est terminée si la mémoire libre passe en dessous. |
| `limits.diskFreeGB` | 15 | Espace libre que conserve le disque du dossier. |
| `limits.folderGB` | 15 | Taille maximale du dossier avec son cache. |
| `agents` | `"*"` | Agents protégés : `"*"` pour tous, ou une liste de noms. Les autres (votre propre agent interactif, par exemple) travaillent avec tous les droits. Avec une liste, un agent protégé ne peut lancer que des sous-agents de cette liste. |
| `extraTools` | `[]` | Outils d'autres plugins que les agents peuvent utiliser. Tout outil dont on ne sait pas qu'il n'écrit rien est refusé, car un nouveau plugin ou serveur MCP s'exécuterait avec tous les droits. N'ajoutez un nom que si l'outil n'écrit rien ou vérifie lui-même ses écritures, par exemple `["crew_list", "crew_send"]` pour [opencode-crew-mail](https://github.com/retretor/opencode-crew-mail). |
| `alsoWritable` | `[]` | Dossiers supplémentaires que `edit` et `write` peuvent modifier (pas le shell). |
| `lowLabel` | `[]` | Dossiers supplémentaires qui reçoivent l'étiquette Low, afin que les programmes du bac à sable puissent y écrire. Les chemins peuvent commencer par `%APPDATA%`, `%LOCALAPPDATA%` ou une autre variable d'environnement. Utile pour le dossier de données d'un programme compilé dans le projet : un tel programme s'exécute avec des droits réduits (y compris quand vous le lancez vous-même) et peut échouer s'il ne peut pas écrire ses paramètres ou ses sauvegardes. Un dossier manquant est créé. |
| `env` | `{}` | Variables d'environnement supplémentaires pour les commandes du bac à sable, par exemple `{ "CARGO_HOME": "${cache}/cargo" }`. `${cache}` est le dossier de cache du projet, `${folder}` le dossier du projet. Le bac à sable y déplace déjà les caches de npm, yarn, pnpm, bun, pip, uv, Poetry, Go, Gradle, NuGet et .NET, ainsi que `TEMP`, `APPDATA` et `LOCALAPPDATA`. |
| `language` | `"en"` | Langue de la note d'arrêt : `"en"`, `"zh-CN"`, `"ja"`, `"ko"`, `"es"`, `"pt-BR"`, `"de"`, `"fr"` ou `"ru"`. D'autres langues sont les bienvenues, voir [CONTRIBUTING.md](../../CONTRIBUTING.md#translations). |

Un fichier de paramètres invalide ne désactive pas la protection : le shell est refusé et le journal indique pourquoi.

## Ce que voient les agents

- Une fois par session, on leur indique où ils peuvent écrire, que les fichiers secrets ne peuvent pas être ouverts, quelles sont les limites, et que les appels nuisibles arrêtent tout le monde.
- Un appel d'outil refusé renvoie `Blocked: ...` avec la raison ; les refus de Windows apparaissent dans le shell sous la forme « Access denied ».
- Codes de sortie du lanceur : **125** une limite ou `STOP` a terminé ou empêché la commande, **126** la commande n'a pas été lancée (bac à sable incomplet). La commande ne s'exécute jamais à la place avec tous les droits.
- Après un arrêt d'urgence, chaque appel échoue avec `EMERGENCY STOP: <reason>`, les agents sont interrompus (les agents principaux d'abord), et `AGENT_STOPPED.txt` dans le projet explique ce qui s'est passé. Supprimez le fichier `STOP` si vous en avez créé un, puis écrivez n'importe quel message dans une session du dossier.

## Arrêter les agents vous-même

Créez un fichier nommé `STOP` dans le dossier du projet. Les commandes en cours sont terminées en une ou deux secondes, les nouvelles ne démarrent pas, et tous les agents du dossier sont interrompus.

## Fonctionnement avec d'autres plugins

- `globalThis[Symbol.for("opencode-win-guard.halted")]` est un `Set` des dossiers arrêtés (en minuscules, avec des barres obliques normales). Un plugin qui relance des agents de lui-même (un pilote automatique) doit d'abord y regarder.
- Les outils d'autres plugins nécessitent `extraTools`, voir ci-dessus.

## Pourquoi le lanceur est écrit en C#

Le bac à sable a besoin de fonctions Windows qu'aucun script ne peut appeler directement : un jeton restreint avec un niveau d'intégrité Low, `CreateProcessAsUser`, des objets job avec des limites de mémoire, et des étiquettes obligatoires sur les fichiers. C# y accède par un simple P/Invoke, et son compilateur est fourni avec chaque Windows 10 et 11, dans le cadre du .NET Framework. Le lanceur est donc compilé à partir de sources lisibles sur votre propre ordinateur lors de l'installation, sans SDK, sans téléchargement et sans programme non signé venu d'internet. Le code se limite à C# 5 pour que cet ancien compilateur puisse le compiler.

## Tests

```powershell
npm test                                   # pure parts, any OS
$env:WIN_GUARD_E2E = "1"; npm run test:e2e # also the launcher and both plugins in a real `opencode serve` with a fake model
```

Les tests de bout en bout travaillent dans des dossiers temporaires avec leur propre fichier secret, compilent le lanceur pour eux-mêmes et rétablissent chaque étiquette qu'ils posent. Ils ne touchent ni à votre configuration opencode, ni à vos sessions, ni à votre bac à sable, et n'ont besoin d'aucun fournisseur ni d'aucun compte.

## Projets liés

Trouvés en novembre 2026 ; aucun d'eux ne place le shell dans un bac à sable sous Windows ni n'arrête un arbre de sessions entier :

- [opencode-sandbox](https://github.com/Hamza-Abili/opencode-sandbox) : un bac à sable au niveau du système d'exploitation pour le shell, avec bubblewrap (Linux) et Seatbelt (macOS) ; Windows natif n'est pas pris en charge.
- [opencode-guard](https://github.com/gigi206/opencode-guard) : refus/demande de confirmation à base de règles pour les appels d'outils, plus un modèle de décision facultatif, et masquage des secrets avant qu'ils n'atteignent le modèle.
- [opencode-hook-safety](https://github.com/MansM/opencode-hook-safety) : listes de refus pour les chemins secrets et les commandes destructrices, classifieur facultatif.
- [opencode-damage-control](https://github.com/nicounii/opencode-damage-control) : bloque plus de 90 motifs de commandes dangereuses, trois niveaux de protection des chemins.

Ils travaillent au niveau du texte des commandes et des chemins ; ils se combinent bien avec celui-ci, qui ajoute le refus du système d'exploitation lui-même.

## Contribuer

Les rapports de bugs, les idées et les pull requests sont les bienvenus : voir [CONTRIBUTING.md](../../CONTRIBUTING.md). Moyens de contourner le bac à sable : merci de les signaler en privé, voir [SECURITY.md](../../SECURITY.md).

## Licence

[MIT](../../LICENSE)
