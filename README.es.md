# dsh-wsl-workspace

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)

![alt text](image-3.png)
Añade un espacio de trabajo WSL desde la interfaz web de DeepSeek Harness y ejecuta toda la sesión del agente — comandos bash y lectura/escritura de archivos — dentro de una distribución WSL local con rutas en formato Linux. No hay nada que instalar dentro de WSL. La sesión puede acceder a la vez a WSL y a Windows: los comandos bash se ejecutan dentro de la distribución WSL, mientras que los archivos de Windows siguen accesibles vía `/mnt/<unidad>` (por ejemplo `/mnt/c/Users/...`).

## Instalación

Elige uno de los tres métodos siguientes y reinicia `dsh web`:

```powershell
# 1) Paquete npm
dsh plugin --profile web add dsh-wsl-workspace

# 2) Repositorio de GitHub (incluye lib/ precompilado, sin compilar en local)
dsh plugin --profile web add https://github.com/6Mikao9/dsh-wsl-workspace

# 3) Directorio local (desarrollo / uso personal)
dsh plugin --profile web add D:\path\to\dsh-wsl-workspace
```

Tras reiniciar `dsh web`, aparece un botón W junto a Settings en la parte inferior de la barra lateral.

## Uso

Haz clic en el botón W junto a Settings en la parte inferior de la barra lateral para abrir el diálogo «Add WSL workspace». Elige una distribución, explora el árbol de directorios o escribe una ruta Linux absoluta (por ejemplo `/home/me/proj`) — el botón Check verifica que la ruta exista antes de crear el espacio de trabajo. El diálogo sigue el idioma de la interfaz de DeepSeek Harness. El campo de nombre de usuario es opcional: déjalo vacío para ejecutar los comandos con el usuario por defecto de la distribución, o indica un usuario Linux de esa distribución para ejecutar la sesión como ese usuario (equivalente a `wsl.exe -u <usuario>`). El nombre de usuario solo cambia la identidad de ejecución de la herramienta bash — las herramientas de archivos pasan por el recurso compartido WSL del lado de Windows y no se ven afectadas. El nombre de usuario de cada espacio de trabajo se guarda en `<dshHome>/wsl-workspaces.json`; borra la entrada (o recrea el espacio de trabajo desde el diálogo) para volver al usuario por defecto.

Haz clic en «Create & open» para iniciar una nueva sesión en el espacio de trabajo. En la nueva sesión, la herramienta bash ejecuta comandos dentro de la distribución elegida y `read`/`write`/`edit` operan sobre archivos WSL, así que cada ruta que ve el modelo es una ruta Linux. El selector de modos sigue funcionando igual: Standard, PTC, Minimal y Creative aterrizan automáticamente en su variante WSL (las entradas de variante WSL del selector son bilingües, p. ej. `WSL · Standard mode（标准模式）`), y los archivos de Windows siguen accesibles desde la sesión bajo `/mnt/<unidad>` (por ejemplo `/mnt/c/Users/...`).

![alt text](image-2.png)
## Notas de comportamiento

- **Herramienta bash**: se ejecuta dentro de la distribución WSL con el nombre de usuario configurado (vacío = usuario por defecto de la distribución, a menudo `root`), por lo que puede leer y escribir en cualquier parte de la distribución. El sandbox ACL de Windows no puede envolver `wsl.exe` — sus procesos hijo corren del lado del kernel de Linux — así que WSL es en sí la frontera de aislamiento y la política de archivos de DSH no se aplica a bash.
- **Herramientas de archivo (`read`/`write`/`edit`)**: pasan por el recurso compartido WSL 9P del lado de Windows y quedan sujetas a la política de archivos de DSH. Con `workspace-write`, las lecturas funcionan en cualquier lugar pero las escrituras se limitan al espacio de trabajo de la sesión; cambia la política a `danger-full-access` para permitir también escrituras fuera. El campo de nombre de usuario no afecta a las herramientas de archivo.
- El banner de reenvío de puerto `localhost` (texto ilegible) que `wsl.exe` imprime en stderr cuando la distribución aún no estaba en marcha es inofensivo.

## Licencia y atribución

MIT — ver [LICENSE](LICENSE) y [NOTICE](NOTICE). El NOTICE enumera con precisión:

- **Código fuente adaptado/heredado**: DeepSeek Harness (MIT) — `dsh-bash-local` (mecánica del ejecutor), `dsh-fs-local` (`WslFileSystem` lo subclasa) y los agent presets incluidos (leídos y transformados por el generador de variantes);
- **Referencias de diseño (sin código copiado)**: [dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal) (MIT, enfoque wsl argv/WSLENV), [dsh-side-panel](https://github.com/ccq1/dsh-side-panel) (BSD-3-Clause, patrón de ruta del host), [vpshub](https://github.com/Sdongmaker/vpshub) (MIT, referencia de hoja de ruta).

Conserva `LICENSE` y `NOTICE` al redistribuir.

## Agradecimientos

Un agradecimiento especial a [dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale) (serie de skins 鲸鱼娘 para DSH Web · 深海女仆工坊 maid-atelier, CC BY-NC-SA 4.0): el plugin de skins de la chica ballena aporta un conjunto completo de skins adorables a la interfaz web de DeepSeek Harness y hace más cálido el uso diario de DSH.
