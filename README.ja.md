# dsh-wsl-workspace

[English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)

![alt text](image-3.png)
DeepSeek Harness Web GUI から WSL ワークスペースを追加し、エージェントセッション全体（bash コマンドとファイルの読み書き）をローカルの WSL ディストリビューション内で実行します。パスはすべて Linux 形式です。WSL 内への追加インストールは不要です。セッションから WSL と Windows の両方に同時にアクセスできます。bash コマンドは WSL ディストリビューション内で実行され、Windows のファイルは `/mnt/<drive>`（例：`/mnt/c/Users/...`）経由でいつでもアクセスできます。

## インストール

次のいずれかの方法でインストールし、`dsh web` を再起動してください：

```powershell
# 1) npm パッケージ
dsh plugin --profile web add dsh-wsl-workspace

# 2) GitHub リポジトリ（事前ビルド済みの lib/ を含むためローカルビルド不要）
dsh plugin --profile web add https://github.com/6Mikao9/dsh-wsl-workspace

# 3) ローカルディレクトリ（開発・自用）
dsh plugin --profile web add D:\path\to\dsh-wsl-workspace
```

`dsh web` を再起動すると、サイドバー下部の Settings の隣に W ボタンが表示されます。

## 使い方

サイドバー下部の Settings の隣にある W ボタンをクリックして「Add WSL workspace」ダイアログを開きます。ディストリビューションを選択し、ディレクトリツリーを閲覧するか Linux の絶対パス（例：`/home/me/proj`）を入力します。Check ボタンでパスの存在を確認できます。ダイアログの言語は DeepSeek Harness の UI 言語に追従します。ユーザー名フィールドは任意です。空欄の場合はディストリビューションのデフォルトユーザーで実行され、入力した場合はそのユーザーで実行されます（`wsl.exe -u <ユーザー名>` と同等）。ユーザー名は bash ツールの実行ユーザーのみに影響し、ファイルツールは Windows 側の WSL 共有経由のため影響を受けません。ワークスペースごとのユーザー名は `<dshHome>/wsl-workspaces.json` に保存されます。エントリを削除する（またはダイアログからワークスペースを作り直す）とデフォルトユーザーに戻ります。

「Create & open」をクリックすると、新しいセッションが WSL で起動します。セッション内では bash ツールが選択したディストリビューション内でコマンドを実行し、`read`/`write`/`edit` は WSL のファイルを操作するため、モデルが見るすべてのパスは Linux 形式です。モード選択は従来どおり機能します。Standard・PTC・Minimal・Creative はそれぞれ対応する WSL バリアントに自動的に割り当てられます（選択肢の WSL バリアントは二言語表示、例：`WSL · Standard mode（标准模式）`）。セッション内から Windows のファイルは `/mnt/<drive>`（例：`/mnt/c/Users/...`）経由でアクセスできます。

![alt text](image-2.png)
## 動作メモ

- **bash ツール**：設定されたユーザー名で WSL ディストリビューション内で実行されます（空欄＝ディストリビューションのデフォルトユーザー、多くの場合 `root`）。ディストリビューション内のどこでも読み書きできます。Windows の ACL サンドボックスは `wsl.exe` を包み込めません（子プロセスは Linux カーネル側で実行されるため）。WSL 自体が分離境界となり、DSH のファイルポリシーは bash には適用されません。
- **ファイルツール（`read`/`write`/`edit`）**：Windows 側の WSL 9P 共有経由で動作し、DSH のファイルポリシーの適用を受けます。`workspace-write` では読み取りはどこでも可能ですが、書き込みはセッションのワークスペース内に制限されます。ファイルポリシーを `danger-full-access` に変更するとワークスペース外への書き込みも可能になります。ユーザー名フィールドはファイルツールには影響しません。
- ディストリビューションがまだ起動していないときに `wsl.exe` が stderr に出力する `localhost` ポート転送の文字化けバナーは無害です。

## ライセンスとクレジット

MIT — [LICENSE](LICENSE) と [NOTICE](NOTICE) をご覧ください。NOTICE に正確なリストがあります：

- **改変・継承したソースコード**：DeepSeek Harness（MIT）— `dsh-bash-local`（実行機構）、`dsh-fs-local`（`WslFileSystem` がサブクラス化）、同梱の agent presets（バリアント生成で読み取り・変換）；
- **設計参照（コードの複製なし）**：[dsh-bash-terminal](https://github.com/MAXeaglet/dsh-bash-terminal)（MIT、wsl argv/WSLENV の手法）、[dsh-side-panel](https://github.com/ccq1/dsh-side-panel)（BSD-3-Clause、ホストルートパターン）、[vpshub](https://github.com/Sdongmaker/vpshub)（MIT、ロードマップ参考）。

再配布の際は `LICENSE` と `NOTICE` を保持してください。

## 謝辞

[dsh-deep-whale](https://github.com/Small-tailqwq/dsh-deep-whale)（DSH Web 鲸鱼娘 スキンシリーズ · 深海女仆工坊 maid-atelier、CC BY-NC-SA 4.0）に感謝します。クジラ娘スキンプラグインは DeepSeek Harness Web UI に可愛いスキン一式をもたらし、DSH の日常利用をより温かみのあるものにしてくれます。
