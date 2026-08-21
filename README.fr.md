# dsh-wsl-workspace

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)

![alt text](image-3.png)
Ajoutez un espace de travail WSL depuis l'interface web de DeepSeek Harness et exécutez toute la session de l'agent — commandes bash et lectures/écritures de fichiers — dans une distribution WSL locale avec des chemins au format Linux. Aucune installation supplémentaire n'est nécessaire dans WSL. La session peut accéder simultanément à WSL et à Windows : les commandes bash s'exécutent dans la distribution WSL, tandis que les fichiers Windows restent accessibles via `/mnt/<lecteur>` (par exemple `/mnt/c/Users/...`).

## Installation

Choisissez l'une des trois méthodes ci-dessous, puis redémarrez `dsh web` :

```powershell
# 1) Paquet npm
dsh plugin --profile web add dsh-wsl-workspace

# 2) Dépôt GitHub (livré avec lib/ pré-construit, aucune compilation locale requise)
dsh plugin --profile web add https://github.com/6Mikao9/dsh-wsl-workspace

# 3) Répertoire local (développement / usage personnel)
dsh plugin --profile web add D:\path\to\dsh-wsl-workspace
```

Après le redémarrage de `dsh web`, un bouton W apparaît à côté de Settings en bas de la barre latérale.

## Build natif à l'installation

L'installation de ce plugin tire `@deepseek-ai/dsh-fs-local` (une dépendance peer), qui dépend de [`koffi`](https://www.npmjs.com/package/koffi) — une FFI C dynamique pour Node.js. koffi exécute un script d'`install` pendant `npm install` (`node ./cnoke.cjs -P . -D src/koffi --prebuild --release`) :

- **Préconstruit d'abord** : il tente de charger un addon préconstruit spécifique à la plateforme depuis les `optionalDependencies` de koffi (`@koromix/koffi-<plateforme>`), couvrant `win32-x64/arm64/ia32`, `linux-x64/arm64/ia32/riscv64/loong64`, `darwin-x64/arm64`, `freebsd-*`, `openbsd-*`. Quand un préconstruit se charge, **aucune compilation n'a lieu**.
- **Compilation de repli** : uniquement si aucun addon préconstruit n'est disponible/chargeable, il recompile depuis les sources, ce qui nécessite CMake et un compilateur C/C++ (Windows préfère Clang, ou MinGW sous MSYSTEM). C'est le comportement standard de koffi ; ce plugin ne construit ni ne fournit de code natif lui-même.

C'est attendu et non malveillant (koffi est sous licence MIT). Une installation avec `--ignore-scripts` saute la sélection/build de l'addon koffi, donc `@deepseek-ai/dsh-fs-local` peut échouer à se charger sur les plateformes sans binaire préconstruit en cache. La session WSL elle-même ne nécessite pas de toolchain : l'outil bash s'exécute dans la distribution WSL et les outils fichiers passent par le partage WSL côté Windows.

## Utilisation

Cliquez sur le bouton W à côté de Settings en bas de la barre latérale pour ouvrir la boîte de dialogue « Add WSL workspace ». Choisissez une distribution, parcourez l'arborescence ou saisissez un chemin Linux absolu (par exemple `/home/me/proj`) — le bouton Check vérifie que le chemin existe avant la création. La langue de la boîte de dialogue suit la langue de l'interface DeepSeek Harness. Le champ nom d'utilisateur est facultatif : laissez-le vide pour exécuter les commandes avec l'utilisateur par défaut de la distribution, ou indiquez un utilisateur Linux de cette distribution pour exécuter la session sous cet utilisateur (équivalent à `wsl.exe -u <utilisateur>`). Le nom d'utilisateur ne change que l'identité d'exécution de l'outil bash — les outils de fichiers passent par le partage WSL côté Windows et ne sont pas affectés. Le nom d'utilisateur de chaque espace de travail est conservé dans `<dshHome>/wsl-workspaces.json` ; supprimez l'entrée (ou recréez l'espace de travail depuis la boîte de dialogue) pour revenir à l'utilisateur par défaut.

Cliquez sur « Create & open » pour démarrer une nouvelle session dans l'espace de travail. Dans la nouvelle session, l'outil bash exécute les commandes dans la distribution choisie et `read`/`write`/`edit` opèrent sur les fichiers WSL, donc chaque chemin vu par le modèle est un chemin Linux. Le sélecteur de mode fonctionne comme d'habitude : Standard, PTC, Minimal et Creative tombent chacun automatiquement sur leur variante WSL (les entrées des variantes WSL dans le sélecteur sont bilingues, ex. `WSL · Standard mode（标准模式）`), et les fichiers Windows restent accessibles depuis la session sous `/mnt/<lecteur>` (par exemple `/mnt/c/Users/...`).

![alt text](image-2.png)
## Notes de comportement

- **Outil bash** : s'exécute dans la distribution WSL avec le nom d'utilisateur configuré (vide = utilisateur par défaut de la distribution, souvent `root`), il peut donc lire et écrire n'importe où dans la distribution. Le sandbox ACL de Windows ne peut pas envelopper `wsl.exe` — ses enfants s'exécutent côté noyau Linux — donc WSL lui-même est la frontière d'isolation et la politique de fichiers de DSH ne s'applique pas à bash.
- **Outils de fichiers (`read`/`write`/`edit`)** : passent par le partage WSL 9P côté Windows et sont soumis à la politique de fichiers de DSH. Sous `workspace-write`, les lectures fonctionnent partout mais les écritures sont limitées à l'espace de travail de la session ; passez la politique à `danger-full-access` pour autoriser aussi les écritures en dehors. Le champ nom d'utilisateur n'affecte pas les outils de fichiers.
- La bannière de transfert de port `localhost` (texte illisible) que `wsl.exe` imprime sur stderr quand la distribution n'était pas encore démarrée est inoffensive.

## Journal des modifications

### 0.2.4

- **Correction du #5 — le mode WSL Minimal ne casse plus la chaîne de pensée « we need/lets » de la première requête.** Auparavant, la variante WSL d'un preset minimal (qui n'expose que `persistent-bash` + `str-replace-editor`) injectait aussi l'outil `bash` à usage unique et les outils fichiers `read`/`write`/`edit`/`read_image` ; le nom d'outil `bash` dupliqué et les schémas supplémentaires gonflaient le catalogue d'outils de la première requête et perturbaient la chaîne de pensée. Les variantes minimales ne conservent désormais que `persistent-bash`, `str-replace-editor` et le fournisseur `fs-wsl` ; les presets standard reçoivent toujours l'environnement complet shell + outils fichiers.

## Licence et attribution

MIT — voir [LICENSE](LICENSE) et [NOTICE](NOTICE). Le NOTICE liste précisément :

- **Code source adapté/hérité** : DeepSeek Harness (MIT) — `dsh-bash-local` (mécanique de l'exécuteur), `dsh-fs-local` (`WslFileSystem` le sous-classe), et les agent presets fournis (lus et transformés par le générateur de variantes) ;
- **Références de conception (aucun code copié)** : [dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal) (MIT, approche wsl argv/WSLENV), [dsh-side-panel](https://github.com/ccq1/dsh-side-panel) (BSD-3-Clause, motif de route hôte), [vpshub](https://github.com/Sdongmaker/vpshub) (MIT, référence de feuille de route).

Conservez `LICENSE` et `NOTICE` lors de la redistribution.

## Remerciements

Merci tout particulier à [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) (série de skins 鲸鱼娘 pour le web DSH · 深海女仆工坊 maid-atelier, CC BY-NC-SA 4.0) : le plugin de skin de la fille-baleine apporte une gamme complète de skins adorables à l'interface web de DeepSeek Harness et rend l'usage quotidien de DSH plus chaleureux.
