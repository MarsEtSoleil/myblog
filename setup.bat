@echo off
REM 依存モジュールをインストール
npm install

REM （初回だけ必要）package.json が無ければ生成
REM npm init -y

REM サーバー起動（必要ならコメントアウト） npm startでも良い
REM node server.js

pause
