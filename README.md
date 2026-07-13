# Wardbook

病棟を「局面」で見渡す個人用入院症例アプリ（Casebook 後継・社内専用）。

- 単一 `index.html`＋Vanilla JS＋PWA（GitHub Pages 配信・¥0）
- 患者カード5要素：Phase（局面）／Next（次の展開）／Today（今日やる）／Pending（待ち）／Seeds（学習の種）
- 患者詳細に **入院時記録**（入院契機・主要既往・ADL・一言の半構造化）と **プロブレム**（能動的な問題の active/resolved リスト。局面文脈の補強で独立サブシステムではない・2026-07-11）
- 種（Seeds）は夕の棚卸し完了時＋起動時に E2E 暗号化のまま自動送信 → 自宅PCの収集役が復号して Obsidian Vault へ（Phase C）
- サーバ（Firestore）には暗号文のみ（E2E）。Firestore ルールは本人uidのみ（`firestore.rules`・コンソールに適用）。写真は端末内限定。氏名・ID・生年月日など直接識別子は入力しない（疑似匿名化。部屋番号など運用メモは可）
- **週間予定×経過表は統合レコード（SPEC-F）**：日付を持つ予定・実績は単一の `entries` ストアに載り、週間予定・今日ビュー・経過表はその投影。予定は済にするまで今日の列に⚠で残る（MAR方式）
- **更新時の運用ルール**：アプリ更新をまたぐ期間は**全端末を同日に起動して更新**すること（旧バージョン端末での編集・削除は新形式へ伝播しない。追加のみ伝播）

## 構成

| パス | 内容 |
|---|---|
| `index.html` | アプリ本体（logic ブロック＝純ロジック、main ブロック＝DOM） |
| `tests/` | Node 単体テスト（`node tests/verify-wardbook.js`）＋描画スモーク |
| `collector/` | 自宅PC側の種収集役（Phase C） |
| `spike/` | M2 技術検証（種の自動送信×E2E暗号化の両立確認・2026-07-07 成立） |
| `SPEC-*.md` | 実装仕様書（Phase 単位） |

## 設計の正本

Obsidian Vault 側：`3_新規事業部/2_PoC中/Wardbook/設計書.md`（M2 成果物）
