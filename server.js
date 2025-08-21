// server.js (primitive / C-Java style)

const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const url = require('url');
const querystring = require('querystring');
const fs = require('fs');
const multiparty = require('multiparty');
const db = new sqlite3.Database('myblog.db');
const dbPath = path.join(__dirname, 'myblog.db');
const uploadDir = path.join(__dirname, 'photos'); // 写真保存

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

/*
git add .
git commit -m "Init with sqlite auto-create tables"
git push origin main
*/
// 初期テーブル作成
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS rireki (
    key INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT,
    name TEXT,
    title TEXT,
    date TEXT,
    comments TEXT,
    photo TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS member (
    key INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT,
    name TEXT,
    pass TEXT
  )`);

  // データがまだ無ければ white.png を登録
  db.get("SELECT COUNT(*) as cnt FROM rireki", (err, row) => {
    if (row.cnt === 0) {
      db.run(
        `INSERT INTO rireki (id, name, title, date, comments, photo) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["admin", "管理者", "最初の投稿", new Date().toISOString(), "サンプルコメント", "white.png"]
      );
    }
  });
});

  // member の初期レコード
  db.get("SELECT COUNT(*) AS cnt FROM member", (err, row) => {
    if (err) {
      console.error("Error checking member table:", err);
    } else if (row.cnt === 0) {
      db.run(`INSERT INTO member (id, name, pass)
              VALUES (?, ?, ?)`,
        ["admin", "管理者", "admin"]
      );
      console.log("初期レコードを追加しました (member)");
    }
  });
});

module.exports = db;

// ============ サーバ本体 ============
const server = http.createServer(function(req, res) {
  var parsedUrl = url.parse(req.url, true);
  var pathname = parsedUrl.pathname;
  var method = req.method;

  // index.html の配信
  if (pathname.indexOf('/index.html') === 0) {
    var filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, function(err, data) {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ファイルが見つかりません');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      }
    });
    return;
  }

  // 画像配信 (/photos/～)
  if (pathname.indexOf('/photos/') === 0) {
    var imgPath = path.join(__dirname, pathname);
    fs.readFile(imgPath, function(err, data) {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('画像が見つかりません');
        return;
      }
      var ext = path.extname(imgPath).toLowerCase();
      var contentType = 'application/octet-stream';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.gif') contentType = 'image/gif';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
    return;
  }

  // ルーティング
  if (pathname === '/' || pathname === '/portal') {
    var page = parsedUrl.query.page || 1;
    showPortal(res, page);
    return;
  }

  if (pathname === '/tableshow') {
    var tablename1 = parsedUrl.query.tablename;
    showTable(res, tablename1);
    return;
  }

  if (pathname === '/insert' && method === 'GET') {
    var tbl2 = parsedUrl.query.tablename || '';
    var photoName = parsedUrl.query.photo || 'white.png';
    showInsertForm(res, tbl2, photoName);
    return;
  }

  if (pathname === '/update') {
    var tbl3 = parsedUrl.query.tablename;
    showUpdateForm(tbl3, res);
    return;
  }

  if (pathname === '/delete') {
    var tbl4 = parsedUrl.query.tablename;
    showDeleteForm(tbl4, res);
    return;
  }

  if ((pathname === '/insert_ex' || pathname === '/update_ex' || pathname === '/delete_ex') && method === 'POST') {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      var postData = querystring.parse(body);
      if (pathname === '/insert_ex') executeInsert(postData, res);
      else if (pathname === '/update_ex') executeUpdate(postData, res);
      else if (pathname === '/delete_ex') executeDelete(postData, res);
    });
    return;
  }

  if (pathname === '/upphoto' && method === 'POST') {
    var form = new multiparty.Form({ uploadDir: uploadDir });
    form.parse(req, function(err, fields, files) {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Upload error: ' + err.message);
        return;
      }
      var tablename = (fields.tablename && fields.tablename[0]) ? fields.tablename[0] : 'rireki';
      var file = files.file && files.file[0] ? files.file[0] : null;
      if (!file) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ファイルが選択されていません');
        return;
      }
      var originalName = path.basename(file.originalFilename);
      var newPath = path.join(uploadDir, originalName);

      fs.rename(file.path, newPath, function(renameErr) {
        if (renameErr) {
          // フォールバック：コピー→元を削除
          fs.copyFile(file.path, newPath, function(copyErr) {
            if (copyErr) {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('File copy error: ' + copyErr.message);
              return;
            }
            fs.unlink(file.path, function(unlinkErr) {
              // unlink 失敗はログのみにする
              if (unlinkErr) console.error('Temporary file unlink error:', unlinkErr);
              res.writeHead(302, {
                'Location': '/insert?tablename=' + encodeURIComponent(tablename) + '&photo=' + encodeURIComponent(originalName)
              });
              res.end();
            });
          });
          return;
        }
        // rename 成功
        res.writeHead(302, {
          'Location': '/insert?tablename=' + encodeURIComponent(tablename) + '&photo=' + encodeURIComponent(originalName)
        });
        res.end();
      });
    });
    return;
  }

  // fallback
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('ページが見つかりません');
});

server.listen(8080, function() {
  console.log('Server running at http://localhost:8080/');
});

// ============ ユーティリティ ============
function getTableColumns(tablename, callback) {
  var db = new sqlite3.Database(dbPath);
  db.all('PRAGMA table_info(' + tablename + ')', function(err, rows) {
    db.close();
    if (err) { callback(err); return; }
    var list = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      list.push(rows[i].name);
    }
    callback(null, list);
  });
}

function getColumnsWithTypes(tablename, callback) {
  var db = new sqlite3.Database(dbPath);
  db.all('PRAGMA table_info(' + tablename + ')', function(err, cols) {
    db.close();
    if (err) { callback(err); return; }
    var out = [];
    var i;
    for (i = 0; i < cols.length; i++) {
      var item = { name: cols[i].name, type: (cols[i].type || '').toUpperCase() };
      out.push(item);
    }
    callback(null, out);
  });
}

function getCurrentDateTime() {
  var now = new Date();
  function pad2(n) { return (n < 10 ? '0' + n : '' + n); }
  return '' + now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) +
         '-' + pad2(now.getHours()) + '-' + pad2(now.getMinutes());
}

// ============ 表示系 ============
function showPortal(res, page) {
  var p = parseInt(page, 10);
  if (isNaN(p) || p < 1) p = 1;
  var pageSize = 3;
  var offset = (p - 1) * pageSize;
  var db = new sqlite3.Database(dbPath);

  db.get('SELECT COUNT(*) AS cnt FROM rireki', function(err, countRow) {
    if (err) {
      res.end('<p>DBエラー: ' + err.message + '</p>');
      return;
    }
    var totalCount = countRow.cnt;
    var totalPages = Math.ceil(totalCount / pageSize);

    db.all('SELECT * FROM rireki ORDER BY key DESC LIMIT ? OFFSET ?', [pageSize, offset], function(err2, rows) {
      if (err2) {
        res.end('<p>DBエラー: ' + err2.message + '</p>');
        return;
      }

      var html = '';
      html += '<!DOCTYPE html>';
      html += '<html><head><meta charset="utf-8"><title>Portal</title></head>';
      html += '<body>';
      html += '<h2>ポータル</h2>';
      html += '<a href="/tableshow?tablename=member">member表示</a> ';
      html += '<a href="/tableshow?tablename=rireki">rireki表示</a> ';
      html += '<a href="/insert?tablename=member">member追加</a> ';
      html += '<a href="/insert?tablename=rireki">rireki追加</a> ';
      html += '<hr>';
      html += '<table border="0">';

      var i;
      for (i = 0; i < rows.length; i++) {
        var r = rows[i];
        var photoName = r.photo && r.photo !== '' ? r.photo : 'white.png';

        html += '<tr>';
        html += '<td><img src="photos/' + photoName + '" alt="' + photoName + '" height="100" border="0"></td>';
        html += '<td>&nbsp;&nbsp;&nbsp;</td>';
        html += '<td>＜' + r.key + '＞<br><b>' + (r.name || '') + '</b><br><small>' + (r.comments || '') + '</small><br>------</td>';
        html += '</tr>';
      }
      html += '</table>';

      html += '<hr>';
      html += '<div style="margin-top:0px;">';
      if (p > 1) {
        html += '<a href="/portal?page=' + (p - 1) + '">前へ</a> ';
      }
      if (p < totalPages) {
        html += '<a href="/portal?page=' + (p + 1) + '">次へ</a>';
      }
      html += '</div>';

      html += '<hr>';
      html += '<a href="/tableshow?tablename=member">member表示</a> ';
      html += '<a href="/tableshow?tablename=rireki">rireki表示</a> ';
      html += '<a href="/insert?tablename=member">member追加</a> ';
      html += '<a href="/insert?tablename=rireki">rireki追加</a> ';

      html += '</body></html>';

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });

  db.close();
}

function showTable(res, tablename) {
  if (!tablename) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('tablename が指定されていません');
    return;
  }
  var db = new sqlite3.Database(dbPath);
  db.all('SELECT * FROM ' + tablename, function(err, rows) {
    if (err) {
      res.end('<p>DBエラー: ' + err.message + '</p>');
      return;
    }
    getTableColumns(tablename, function(err2, cols) {
      if (err2) {
        res.end('<p>カラム取得エラー: ' + err2.message + '</p>');
        return;
      }
      var html = '';
      html += '<!DOCTYPE html>';
      html += '<html><head><meta charset="utf-8"><title>' + tablename + ' Table</title></head>';
      html += '<body>';
      html += '<h2>' + tablename + ' テーブル</h2>';
      html += '<a href="/">portal</a> | ';
      html += '<a href="/insert?tablename=' + tablename + '">insert</a> ';
      html += '<a href="/update?tablename=' + tablename + '">update</a> ';
      html += '<a href="/delete?tablename=' + tablename + '">delete</a> ';
      html += '<table border="1"><tr>';

      var i, j;
      for (i = 0; i < cols.length; i++) {
        html += '<th>' + cols[i] + '</th>';
      }
      html += '</tr>';

      for (i = 0; i < rows.length; i++) {
        var r = rows[i];
        html += '<tr>';
        for (j = 0; j < cols.length; j++) {
          var c = cols[j];
          html += '<td>' + (r[c] !== undefined && r[c] !== null ? r[c] : '') + '</td>';
        }
        html += '</tr>';
      }
      html += '</table></body></html>';

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
  db.close();
}

function showInsertForm(res, tablename, photoName) {
  if (!tablename) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('tablename が指定されていません');
    return;
  }
  if (!photoName) photoName = 'white.png';

  // rireki は専用フォーム
  if (tablename === 'rireki') {
    var dateStr = getCurrentDateTime();
    var html = '';
    html += '<!DOCTYPE html>';
    html += '<html><head><meta charset="utf-8"><title>Insert Table</title>';
    html += '<script type="text/javascript">';
    html += 'function checkfilename(){';
    html += ' var filePath=document.getElementById("file").value;';
    html += ' if(filePath!=""){';
    html += '  var parts=filePath.split("\\\\");';
    html += '  document.getElementById("fname").value=parts[parts.length-1];';
    html += '  return false;';
    html += ' } else { return true; }';
    html += '}';
    html += '</script>';
    html += '</head><body bgcolor="#ffffff">';
    html += '<h3>記事入力 (' + tablename + ')</h3>';
    html += '先に写真アップロード<br>';
    html += '<form action="/upphoto" method="POST" enctype="multipart/form-data">';
    html += '<b>FILE選択</b>';
    html += '<input type="file" name="file" id="file" size="50">';
    html += '<input type="hidden" name="fname" id="fname" value="">';
    html += '<input type="hidden" name="tablename" value="' + tablename + '">';
    html += '<input type="submit" name="submit" value="upload" onclick="checkfilename();">';
    html += '</form>';
    html += '<hr>';
    html += '<h3>項目入力</h3>';
    html += '<form action="/insert_ex" method="post">';
    html += '<table border="0">';
    html += '<tr><td>Date</td><td><input type="text" name="date" value="' + dateStr + '"></td></tr>';
    html += '<tr><td>ID</td><td><input type="text" name="id" value=""></td></tr>';
    html += '<tr><td>Name</td><td><input type="text" name="name" value=""></td></tr>';
    html += '<tr><td>Title</td><td><input type="text" name="title" value=""></td></tr>';
    html += '<tr><td>Comments</td><td><textarea name="comments" cols="50" rows="5"></textarea></td></tr>';
    html += '<tr><td>Photo</td><td><table><tr>';
    html += '<td><input type="text" name="photo" value="' + photoName + '"></td>';
    html += '<td><img src="photos/' + photoName + '" height="100" alt="insert_photo" border="1"></td>';
    html += '</tr></table></td></tr>';
    html += '</table>';
    html += '<input type="hidden" name="tablename" value="' + tablename + '">';
    html += '<input type="submit" value="入力">';
    html += '</form>';
    html += '<hr>';
    html += '<a href="/">中止・TOPへ</a>';
    html += '</body></html>';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // 汎用フォーム（他テーブル）
  getTableColumns(tablename, function(err, cols) {
    if (err) {
      res.end('<p>カラム取得エラー: ' + err.message + '</p>');
      return;
    }
    var html = '';
    html += '<!DOCTYPE html>';
    html += '<html><head><meta charset="utf-8"><title>Insert ' + tablename + '</title></head>';
    html += '<body><h2>' + tablename + ' に追加</h2>';
    html += '<form action="/insert_ex" method="POST">';
    var i;
    for (i = 0; i < cols.length; i++) {
      var c = cols[i];
      html += c + ': <input type="text" name="' + c + '"><br>';
    }
    html += '<input type="hidden" name="tablename" value="' + tablename + '">';
    html += '<input type="submit" value="登録"></form>';
    html += '<a href="/">ポータルへ戻る</a></body></html>';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

function showUpdateForm(tablename, res) {
  getColumnsWithTypes(tablename, function(err, cols) {
    if (err) { res.end('列情報取得エラー: ' + err.message); return; }
    var colNames = [];
    var i;
    for (i = 0; i < cols.length; i++) colNames.push(cols[i].name);

    var db = new sqlite3.Database(dbPath);
    db.all('SELECT * FROM ' + tablename, function(err2, rows) {
      db.close();
      if (err2) { res.end('DBエラー: ' + err2.message); return; }

      var html = '';
      html += '<!DOCTYPE html>';
      html += '<html><head><meta charset="utf-8"><title>' + tablename + ' update</title></head>';
      html += '<body>';
      html += '<h2>' + tablename + ' update</h2>';
      html += '<form action="/update_ex" method="POST">';
      html += '<input type="hidden" name="tablename" value="' + tablename + '">';
      html += '<table border="1">';
      html += '<tr><th>選択</th>';

      for (i = 0; i < colNames.length; i++) {
        html += '<th>' + colNames[i] + '</th>';
      }
      html += '</tr>';

      var r, j;
      for (i = 0; i < rows.length; i++) {
        r = rows[i];
        html += '<tr><td><input type="radio" name="shiteigyou" value="' + r.key + '"></td>';
        for (j = 0; j < colNames.length; j++) {
          var cn = colNames[j];
          var val = (r[cn] !== undefined && r[cn] !== null) ? r[cn] : '';
          html += '<td><input type="text" name="' + cn + '_' + r.key + '" value="' + val + '"></td>';
        }
        html += '</tr>';
      }

      html += '</table>';
      html += '<input type="submit" value="update">';
      html += '</form>';
      html += '<a href="/tableshow?tablename=' + tablename + '">back</a>';
      html += '</body></html>';

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
}

function showDeleteForm(tablename, res) {
  getColumnsWithTypes(tablename, function(err, cols) {
    if (err) { res.end('列情報取得エラー: ' + err.message); return; }
    var colNames = [];
    var i;
    for (i = 0; i < cols.length; i++) colNames.push(cols[i].name);

    var db = new sqlite3.Database(dbPath);
    db.all('SELECT * FROM ' + tablename, function(err2, rows) {
      db.close();
      if (err2) { res.end('DBエラー: ' + err2.message); return; }

      var html = '';
      html += '<!DOCTYPE html>';
      html += '<html><head><meta charset="utf-8"><title>' + tablename + ' delete</title></head>';
      html += '<body>';
      html += '<h2>' + tablename + ' delete</h2>';
      html += '<form action="/delete_ex" method="POST">';
      html += '<input type="hidden" name="tablename" value="' + tablename + '">';
      html += '<table border="1">';
      html += '<tr><th>選択</th>';

      for (i = 0; i < colNames.length; i++) {
        html += '<th>' + colNames[i] + '</th>';
      }
      html += '</tr>';

      var r, j;
      for (i = 0; i < rows.length; i++) {
        r = rows[i];
        html += '<tr><td><input type="radio" name="shiteigyou" value="' + r.key + '"></td>';
        for (j = 0; j < colNames.length; j++) {
          var cn = colNames[j];
          var cell = (r[cn] !== undefined && r[cn] !== null) ? r[cn] : '';
          html += '<td>' + cell + '</td>';
        }
        html += '</tr>';
      }

      html += '</table>';
      html += '<input type="submit" value="delete">';
      html += '</form>';
      html += '<a href="/tableshow?tablename=' + tablename + '">back</a>';
      html += '</body></html>';

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
}

// ============ 実行系 ============
function castValue(sqliteType, value) {
  var t = sqliteType || '';
  t = t.toUpperCase();
  if (t.indexOf('INT') >= 0) {
    if (value === '' || value === null || value === undefined) return null;
    var n = parseInt(value, 10);
    if (isNaN(n)) return null;
    return n;
  }
  if (t.indexOf('REAL') >= 0 || t.indexOf('NUM') >= 0 || t.indexOf('DOUBLE') >= 0 || t.indexOf('FLOAT') >= 0) {
    if (value === '' || value === null || value === undefined) return null;
    var f = parseFloat(value);
    if (isNaN(f)) return null;
    return f;
  }
  // TEXT, BLOB などはそのまま
  return (value === undefined ? null : value);
}

function executeInsert(postData, res) {
  var tablename = postData.tablename;
  getColumnsWithTypes(tablename, function(err, cols) {
    if (err) { res.end('列情報取得エラー: ' + err.message); return; }

    var colNames = [];
    var placeholders = '';
    var values = [];
    var i;

    for (i = 0; i < cols.length; i++) {
      colNames.push(cols[i].name);
      values.push(castValue(cols[i].type, postData[cols[i].name]));
      placeholders += '?';
      if (i < cols.length - 1) placeholders += ',';
    }

    var sql = 'INSERT INTO ' + tablename + ' (';
    for (i = 0; i < colNames.length; i++) {
      sql += colNames[i];
      if (i < colNames.length - 1) sql += ',';
    }
    sql += ') VALUES (' + placeholders + ')';

    var db = new sqlite3.Database(dbPath);
    db.run(sql, values, function(err2) {
      db.close();
      if (err2) { res.end('INSERT失敗: ' + err2.message); return; }
      res.writeHead(302, { 'Location': '/tableshow?tablename=' + tablename });
      res.end();
    });
  });
}

function executeUpdate(postData, res) {
  var tablename = postData.tablename;
  var key = postData.shiteigyou;
  if (!key) { res.end('行未選択'); return; }

  getColumnsWithTypes(tablename, function(err, cols) {
    if (err) { res.end('列情報取得エラー: ' + err.message); return; }

    var setClause = '';
    var values = [];
    var i;
    for (i = 0; i < cols.length; i++) {
      setClause += cols[i].name + ' = ?';
      if (i < cols.length - 1) setClause += ',';
      var fld = cols[i].name + '_' + key;
      values.push(castValue(cols[i].type, postData[fld]));
    }

    // WHERE key は整数扱い（テーブル設計に合わせて）
    var keyInt = parseInt(key, 10);
    if (isNaN(keyInt)) keyInt = key; // 念のため文字列としても通す
    values.push(keyInt);

	/*
    var sql = 'UPDATE ' + tablename + ' SET ' + setClause + ' WHERE key = ?';
    var db = new sqlite3.Database(dbPath);
    db.run(sql, values, function(err2) {
      db.close();
      if (err2) { res.end('UPDATE失敗: ' + err2.message); return; }
      res.writeHead(302, { 'Location': '/tableshow?tablename=' + tablename });
      res.end();
    });
	*/
// 1行分だけ更新する
var sql = 'UPDATE ' + tablename + ' SET ';
var db = new sqlite3.Database(dbPath);
for (var i = 0; i < cols.length; i++) {
    var col = cols[i].name;
    var val = postData[col + '_' + key]; // HTMLフォームからの値
    if (cols[i].type.includes('INT') || cols[i].type.includes('REAL')) {
        sql += col + ' = ' + val; // 数値ならそのまま
    } else {
        sql += col + " = '" + val.replace(/'/g, "''") + "'"; // 文字列ならクォート、シングルクォートはエスケープ
    }
    if (i < cols.length - 1) sql += ', ';
}
sql += ' WHERE key = ' + key;

db.run(sql, function(err){
    if (err) return res.end('UPDATE失敗: ' + err.message);
    res.writeHead(302, {Location: '/tableshow?tablename=' + tablename});
    res.end();
});
	
  });
}

function executeDelete(postData, res) {
  var tablename = postData.tablename;
  var key = postData.shiteigyou;
  if (!key) { res.end('行未選択'); return; }

  var keyInt = parseInt(key, 10);
  if (isNaN(keyInt)) keyInt = key;

  var db = new sqlite3.Database(dbPath);
  db.run('DELETE FROM ' + tablename + ' WHERE key = ?', [keyInt], function(err) {
    db.close();
    if (err) { res.end('DELETE失敗: ' + err.message); return; }
    res.writeHead(302, { 'Location': '/tableshow?tablename=' + tablename });
    res.end();
  });
}
/*
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/MarsEtSoleil/weather-proxy.git
git push -u origin main
git push -f origin main

git init
git add .

git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/MarsEtSoleil/myblog.git
git push -u origin main
*/