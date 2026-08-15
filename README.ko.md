# dsh-wsl-workspace

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)

![alt text](image-3.png)
DeepSeek Harness Web GUI에서 WSL 워크스페이스를 추가하고 에이전트 세션 전체(bash 명령과 파일 읽기/쓰기)를 로컬 WSL 배포판 안에서 실행합니다. 모든 경로는 Linux 형식이며, WSL 내부에 별도로 설치할 것이 없습니다. 세션에서 WSL과 Windows 양쪽에 동시에 접근할 수 있습니다. bash 명령은 WSL 배포판 안에서 실행되고, Windows 파일은 `/mnt/<drive>`(예: `/mnt/c/Users/...`)로 언제든 접근할 수 있습니다.

## 설치

아래 세 가지 방법 중 하나를 선택한 뒤 `dsh web`을 다시 시작하세요:

```powershell
# 1) npm 패키지
dsh plugin --profile web add dsh-wsl-workspace

# 2) GitHub 저장소(사전 빌드된 lib/ 포함, 로컬 빌드 불필요)
dsh plugin --profile web add https://github.com/6Mikao9/dsh-wsl-workspace

# 3) 로컬 디렉터리(개발/개인용)
dsh plugin --profile web add D:\path\to\dsh-wsl-workspace
```

`dsh web`을 다시 시작하면 사이드바 하단 Settings 옆에 W 버튼이 나타납니다.

## 사용법

사이드바 하단 Settings 옆의 W 버튼을 클릭해 "Add WSL workspace" 대화상자를 엽니다. 배포판을 선택하고 디렉터리 트리를 탐색하거나 Linux 절대 경로(예: `/home/me/proj`)를 입력하세요. Check 버튼으로 경로 존재 여부를 확인할 수 있습니다. 대화상자 언어는 DeepSeek Harness UI 언어를 따릅니다. 사용자 이름 필드는 선택 사항입니다. 비워 두면 배포판의 기본 사용자로 실행되고, 입력하면 해당 사용자로 실행됩니다(`wsl.exe -u <사용자 이름>`과 동일). 사용자 이름은 bash 도구의 실행 사용자에게만 영향을 주며, 파일 도구는 Windows 쪽 WSL 공유를 거치므로 영향을 받지 않습니다. 워크스페이스별 사용자 이름은 `<dshHome>/wsl-workspaces.json`에 저장됩니다. 항목을 삭제하거나(또는 대화상자에서 워크스페이스를 다시 만들면) 기본 사용자로 돌아갑니다.

"Create & open"을 클릭하면 새 세션이 WSL에서 시작됩니다. 세션에서 bash 도구는 선택한 배포판 안에서 명령을 실행하고 `read`/`write`/`edit`는 WSL 파일을 다루므로 모델이 보는 모든 경로는 Linux 형식입니다. 모드 선택은 평소와 같이 작동합니다. Standard, PTC, Minimal, Creative는 각각 해당하는 WSL 변형으로 자동 연결됩니다(선택기의 WSL 변형 항목은 이중 언어로 표시, 예: `WSL · Standard mode（标准模式）`). 세션 안에서도 Windows 파일은 `/mnt/<drive>`(예: `/mnt/c/Users/...`)로 접근할 수 있습니다.

![alt text](image-2.png)
## 동작 참고

- **bash 도구**: 설정된 사용자 이름으로 WSL 배포판 안에서 실행됩니다(비움 = 배포판 기본 사용자, 대개 `root`). 배포판 어디든 읽고 쓸 수 있습니다. Windows ACL 샌드박스는 `wsl.exe`를 감쌀 수 없으며(자식 프로세스는 Linux 커널 쪽에서 실행됨), WSL 자체가 격리 경계가 되어 DSH 파일 정책은 bash에 적용되지 않습니다.
- **파일 도구(`read`/`write`/`edit`)**: Windows 쪽 WSL 9P 공유를 통해 동작하며 DSH 파일 정책의 적용을 받습니다. `workspace-write`에서는 읽기는 어디서나 가능하지만 쓰기는 세션 워크스페이스 안으로 제한됩니다. 파일 정책을 `danger-full-access`로 바꾸면 워크스페이스 밖 쓰기도 가능합니다. 사용자 이름 필드는 파일 도구에 영향을 주지 않습니다.
- 배포판이 아직 시작되지 않았을 때 `wsl.exe`가 stderr로 출력하는 `localhost` 포트 포워딩 깨진 배너는 무해합니다.

## 라이선스 및 출처

MIT — [LICENSE](LICENSE)와 [NOTICE](NOTICE)를 참고하세요. NOTICE에 정확한 목록이 있습니다:

- **개작/계승한 소스 코드**: DeepSeek Harness(MIT) — `dsh-bash-local`(실행 메커니즘), `dsh-fs-local`(`WslFileSystem`이 서브클래싱), 번들 agent presets(변형 생성에서 읽고 변환);
- **설계 참조(코드 복제 없음)**: [dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal)(MIT, wsl argv/WSLENV 방식), [dsh-side-panel](https://github.com/ccq1/dsh-side-panel)(BSD-3-Clause, 호스트 라우트 패턴), [vpshub](https://github.com/Sdongmaker/vpshub)(MIT, 로드맵 참고).

재배포 시 `LICENSE`와 `NOTICE`를 유지하세요.

## 감사의 말

[dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)(DSH Web 鲸鱼娘 스킨 시리즈 · 深海女仆工坊 maid-atelier, CC BY-NC-SA 4.0)에 특별히 감사드립니다. 고래 소녀 스킨 플러그인은 DeepSeek Harness Web UI에 귀여운 스킨 세트를 제공하며 DSH 사용을 더 따뜻하게 만들어 줍니다.
