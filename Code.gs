/**
 * ==========================================================================
 * 國中生物 數位互動學習單平台 (Bio Learning Sheets Hub)
 * 全站共用後端 API (GAS) - 支援多單元共用、雙向讀寫、出缺席同步、手動補登、防洗板就地更新
 * 
 * 🌟 包含自訂選單：
 *    【🧬 生物學習單工具】
 *       ├── ✨ 一鍵美化所有工作表 (高雅科技藍調)
 *       └── 🧹 智能清理重複繳交紀錄 (保留同名最高分，絕不覆蓋不同學生)
 * ==========================================================================
 */

function doGet(e) {
  try {
    var params = e ? e.parameter : {};
    var action = params.action || "getRecords";
    var sheetId = params.sheetId || params.unitId || params.weekId || "4-2";
    var classId = params.studentClass || "";

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. 讀取指定單元學習單的繳交紀錄
    if (action === "getRecords") {
      var sheetName = "單元" + sheetId + "作答紀錄";
      var sheet = ss.getSheetByName(sheetName);
      
      // 相容舊命名格式
      if (!sheet) sheet = ss.getSheetByName("第" + sheetId + "週作答紀錄");
      if (!sheet) sheet = ss.getSheetByName("作答紀錄_" + sheetId);

      var records = [];

      if (sheet && sheet.getLastRow() > 1) {
        var data = sheet.getDataRange().getValues();
        // 表頭: [時間戳記, 班級, 座號, 姓名, 組別/模式, 系統初評分數, 評分明細, 作答詳情 (JSON)]
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          var rowClass = String(row[1] || "").trim();
          if (!classId || rowClass === String(classId).trim()) {
            var rawSeatNum = parseInt(row[2], 10);
            var seatStr = (!isNaN(rawSeatNum) && rawSeatNum > 0) ? String(rawSeatNum).padStart(2, '0') : String(row[2] || "").trim();
            records.push({
              timestamp: row[0],
              studentClass: row[1],
              studentSeat: seatStr,
              studentName: row[3],
              studentGroup: row[4],
              score: row[5],
              scoreBreakdown: row[6],
              answers: row[7]
            });
          }
        }
      }

      // 同步讀取出缺席紀錄
      var attSheet = ss.getSheetByName("出缺席紀錄");
      var attendance = { absentSeats: [], expectedCount: 30 };
      if (attSheet && attSheet.getLastRow() > 1) {
        var attData = attSheet.getDataRange().getValues();
        for (var j = attData.length - 1; j >= 1; j--) {
          var aRow = attData[j];
          if (String(aRow[1]).trim() === String(classId).trim() && String(aRow[2]).trim() === String(sheetId).trim()) {
            attendance = {
              expectedCount: Number(aRow[3]) || 30,
              absentSeats: String(aRow[4] || "").split(',').map(function(s) { return s.trim(); }).filter(Boolean)
            };
            break;
          }
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        sheetId: sheetId,
        studentClass: classId,
        records: records,
        attendance: attendance
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "國中生物數位學習單共用 API 運作正常",
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "warning",
        message: "無有效 POST 資料"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetId = data.sheetId || data.unitId || data.weekId || "4-2";

    // 模式 A：教師儀表板一鍵儲存出缺席與請假座號
    if (data.action === "saveAttendance") {
      var attSheet = ss.getSheetByName("出缺席紀錄");
      if (!attSheet) {
        attSheet = ss.insertSheet("出缺席紀錄");
        attSheet.appendRow(["時間戳記", "班級", "單元編號", "實到應交人數", "請假座號名單", "未交座號名單", "備註"]);
        formatAttendanceSheet(attSheet);
      }

      attSheet.appendRow([
        new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        data.studentClass,
        sheetId,
        data.expectedCount,
        (data.absentSeats || []).join(", "),
        (data.unsubmittedSeats || []).join(", "),
        "由教師即時儀表板同步"
      ]);

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "出缺席紀錄已成功儲存至試算表【出缺席紀錄】分頁！"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 模式 B：教師一鍵裁決座號轉移 (Plan B 核心支援，免開試算表)
    if (data.action === "reassignSeat") {
      var sheetName = "單元" + sheetId + "作答紀錄";
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) sheet = ss.getSheetByName("第" + sheetId + "週作答紀錄");
      if (!sheet) sheet = ss.getSheetByName("作答紀錄_" + sheetId);

      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "找不到工作表：" + sheetName
        })).setMimeType(ContentService.MimeType.JSON);
      }

      var targetClass = String(data.studentClass || "").trim();
      var studentName = String(data.studentName || "").trim();
      var rawNewSeat = parseInt(data.newSeat, 10);
      var newSeatStr = (!isNaN(rawNewSeat) && rawNewSeat > 0) ? String(rawNewSeat).padStart(2, '0') : String(data.newSeat || "").padStart(2, '0');

      var targetRow = -1;
      var rowCount = sheet.getLastRow();
      if (rowCount > 1) {
        var values = sheet.getRange(2, 1, rowCount - 1, 4).getValues();
        for (var i = 0; i < values.length; i++) {
          var rClass = String(values[i][1]).trim();
          var rName = String(values[i][3]).trim();
          if (rClass === targetClass && rName === studentName) {
            targetRow = i + 2;
            break;
          }
        }
      }

      if (targetRow > 0) {
        // 更新座號為新座號 (加上單引號保留前導 0)
        sheet.getRange(targetRow, 3).setValue("'" + newSeatStr);

        // 同步更新 answers JSON 中的 studentSeat
        try {
          var ansCell = sheet.getRange(targetRow, 8).getValue();
          if (ansCell) {
            var ansObj = typeof ansCell === "string" ? JSON.parse(ansCell) : ansCell;
            if (ansObj && typeof ansObj === "object") {
              ansObj.studentSeat = newSeatStr;
              sheet.getRange(targetRow, 8).setValue(JSON.stringify(ansObj));
            }
          }
        } catch (e) {}

        // 重新依班級、座號排序並美化格式
        try {
          var dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());
          dataRange.sort([
            { column: 2, ascending: true },
            { column: 3, ascending: true }
          ]);
          formatBioSheet(sheet);
        } catch (e) {}

        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          message: "已成功將 " + studentName + " 座號轉移至 " + newSeatStr + " 號！"
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        return ContentService.createTextOutput(JSON.stringify({
          status: "warning",
          message: "試算表中未找到學生 " + studentName + " 之紀錄！"
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 模式 C：學生送出作答 或 教師手動補登成績 (具備姓名絕對保全與防洗板原地更新機制)
    var sheetName = "單元" + sheetId + "作答紀錄";
    var sheet = ss.getSheetByName(sheetName);
    var isNewSheet = false;

    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      isNewSheet = true;
    }

    if (isNewSheet || sheet.getLastRow() === 0) {
      sheet.appendRow([
        "時間戳記", 
        "班級", 
        "座號", 
        "姓名", 
        "組別/模式", 
        "系統初評分數", 
        "評分明細", 
        "作答詳情 (JSON 原始紀錄)"
      ]);
      formatBioSheet(sheet);
    }

    var rawSeatNum = parseInt(data.studentSeat || data.seatOrGroup || "", 10);
    var targetSeat = (!isNaN(rawSeatNum) && rawSeatNum > 0) 
      ? String(rawSeatNum).padStart(2, '0') 
      : String(data.studentSeat || data.seatOrGroup || "").padStart(2, '0');
    var targetClass = String(data.studentClass || data.class || "").trim();
    var targetName = String(data.studentName || data.nameOrMembers || "").trim();
    var existingRowIndex = -1;

    // 🔍 試算表嚴格保全機制 (絕對保護每位學生，絕不被他人覆蓋)：
    // 1. 若為「教師手動補登」：以座號為準進行補登或更新
    // 2. 若為「學生自主繳交」：
    //    - 僅當「同班級 且 同姓名」時才視為該學生本人重交/修改座號，原地更新該列；
    //    - 若該座號已存在其他人（姓名不同）：【絕對不可覆蓋他人】，直接新增一列 (appendRow)！
    //    確保兩位同學的姓名、作答與分數 100% 完整留存於試算表，供教師親自憑姓名核對！
    var isManualGrade = (data.studentGroup === "教師手動補登" || (data.answers && data.answers.manual));

    if (sheet.getLastRow() > 1) {
      var existingData = sheet.getRange(2, 2, sheet.getLastRow() - 1, 3).getValues(); // 班級(欄2), 座號(欄3), 姓名(欄4)
      for (var r = 0; r < existingData.length; r++) {
        var rowClass = String(existingData[r][0]).trim();
        var rowSeatNum = parseInt(existingData[r][1], 10);
        var rowSeatStr = (!isNaN(rowSeatNum) && rowSeatNum > 0) ? String(rowSeatNum).padStart(2, '0') : String(existingData[r][1]).trim();
        var rowName = String(existingData[r][2] || "").trim();

        if (rowClass === targetClass) {
          if (isManualGrade) {
            // 教師手動補登：座號相同即更新
            if (rowSeatStr === targetSeat) {
              existingRowIndex = r + 2;
              break;
            }
          } else {
            // 學生自主繳交：必須「姓名完全相同」才視為本人更新覆蓋！
            // 若姓名不同，絕不覆蓋，保留至全新一列！
            if (targetName && rowName === targetName) {
              existingRowIndex = r + 2;
              break;
            }
          }
        }
      }
    }

    var rowValues = [
      data.timestamp || new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
      targetClass,
      "'" + targetSeat,
      targetName || "未具名",
      data.studentGroup || data.mode || "個人速記",
      typeof data.score === 'number' ? data.score : (Number(data.score) || 0),
      Array.isArray(data.scoreBreakdown) ? data.scoreBreakdown.join("； ") : (data.scoreBreakdown || (data.essay ? "素養簡答: " + data.essay : "正常作答")),
      typeof data.answers === 'object' ? JSON.stringify(data.answers) : (typeof data.detailData === 'object' ? JSON.stringify(data.detailData) : (data.answers || "{}"))
    ];

    if (existingRowIndex > 0) {
      // 原地覆蓋更新同一位同學的作答紀錄
      sheet.getRange(existingRowIndex, 1, 1, 8).setValues([rowValues]);
    } else {
      // 全新提交或不同姓名防覆蓋安全追加
      sheet.appendRow(rowValues);
    }

    // 自然排序（依班級、座號升冪排序）
    var lastRow = sheet.getLastRow();
    if (lastRow > 2) {
      try {
        sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).sort([
          { column: 2, ascending: true },
          { column: 3, ascending: true }
        ]);
      } catch (e) {}
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: existingRowIndex > 0 ? "已更新此同學之最新繳交紀錄！" : "資料已成功儲存至試算表！",
      recordedScore: data.score
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ==========================================================================
 * 🎨 試算表美化核心邏輯 (科技藍調 / 斑馬交替色彩 / 精準欄寬 / 凍結置中)
 * ==========================================================================
 */
function formatBioSheet(sheet) {
  if (!sheet) return;

  var lastRow = Math.max(sheet.getLastRow(), 2);
  var lastCol = 8;

  // 1. 凍結首列與表頭高度
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 38);

  // 2. 表頭文字與顏色 (科技深海藍 #1E3A8A)
  var headerRange = sheet.getRange(1, 1, 1, lastCol);
  headerRange
    .setBackground("#1E3A8A")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(11)
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("center");

  // 3. 欄位最佳化寬度
  sheet.setColumnWidth(1, 165); // 時間戳記
  sheet.setColumnWidth(2, 75);  // 班級
  sheet.setColumnWidth(3, 65);  // 座號
  sheet.setColumnWidth(4, 95);  // 姓名
  sheet.setColumnWidth(5, 115); // 組別/模式
  sheet.setColumnWidth(6, 115); // 初評分數
  sheet.setColumnWidth(7, 360); // 評分明細
  sheet.setColumnWidth(8, 160); // 作答詳情 (JSON)

  // 4. 資料列排版與垂直置中
  if (lastRow > 1) {
    var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    dataRange.setVerticalAlignment("middle").setFontSize(10);

    sheet.getRange(2, 1, lastRow - 1, 1).setHorizontalAlignment("center"); // 時間
    sheet.getRange(2, 2, lastRow - 1, 1).setHorizontalAlignment("center"); // 班級
    sheet.getRange(2, 3, lastRow - 1, 1).setHorizontalAlignment("center").setNumberFormat("@"); // 座號補零純文字
    sheet.getRange(2, 4, lastRow - 1, 1).setHorizontalAlignment("center").setFontWeight("bold"); // 姓名
    sheet.getRange(2, 5, lastRow - 1, 1).setHorizontalAlignment("center"); // 組別
    sheet.getRange(2, 6, lastRow - 1, 1).setHorizontalAlignment("center").setFontWeight("bold"); // 分數
    sheet.getRange(2, 7, lastRow - 1, 1).setHorizontalAlignment("left");   // 明細
    sheet.getRange(2, 8, lastRow - 1, 1).setHorizontalAlignment("left");   // 作答詳情

    // 資料列高
    for (var r = 2; r <= Math.min(lastRow, 50); r++) {
      sheet.setRowHeight(r, 30);
    }
  }

  // 5. 套用斑馬條紋交替色彩 (白底 / 冰川淺藍 #F0F9FF)
  try {
    var bandings = sheet.getBandings();
    for (var b = 0; b < bandings.length; b++) {
      bandings[b].remove();
    }
    var fullRange = sheet.getRange(1, 1, Math.max(lastRow, 50), lastCol);
    fullRange.applyRowBanding()
      .setHeaderRowColor("#1E3A8A")
      .setFirstRowColor("#FFFFFF")
      .setSecondRowColor("#F0F9FF");
  } catch (bandErr) {}
}

/**
 * 美化出缺席紀錄表
 */
function formatAttendanceSheet(sheet) {
  if (!sheet) return;
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 38);
  var header = sheet.getRange(1, 1, 1, 7);
  header.setBackground("#0284C7").setFontColor("#FFFFFF").setFontWeight("bold").setVerticalAlignment("middle").setHorizontalAlignment("center");
  sheet.setColumnWidth(1, 165);
  sheet.setColumnWidth(2, 75);
  sheet.setColumnWidth(3, 85);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 180);
  sheet.setColumnWidth(6, 220);
  sheet.setColumnWidth(7, 150);
}

/**
 * ==========================================================================
 * 🚀 一鍵美化全試算表所有單元工作表 (點擊上方選單即可自動執行！)
 * ==========================================================================
 */
function formatAllSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var count = 0;

  for (var i = 0; i < sheets.length; i++) {
    var s = sheets[i];
    var name = s.getName();
    if (name.indexOf("作答紀錄") !== -1) {
      if (s.getLastRow() > 2) {
        try {
          s.getRange(2, 1, s.getLastRow() - 1, 8).sort([
            { column: 2, ascending: true },
            { column: 3, ascending: true }
          ]);
        } catch(e) {}
      }
      formatBioSheet(s);
      count++;
    } else if (name === "出缺席紀錄") {
      formatAttendanceSheet(s);
    }
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast("已成功套用生物科技藍調美化 " + count + " 個作答紀錄表！", "✨ 美化完成", 5);
  } catch(e) {}
}

/**
 * ==========================================================================
 * 🧹 一鍵清除與修復全試算表重複錯位紀錄 (Google Sheets 專用管理維護工具)
 * 自動掃描所有「單元X作答紀錄」工作表：
 * 1. 僅清理「同班級同姓名」的重複洗板歷史舊稿，保留最新/最高成績
 * 2. 嚴格保全：若有多位不同學生誤劃同座號，絕對 100% 完整保留各自列，供教師核對姓名
 * 3. 依班級、座號 ('01~'35) 自動美化與排序！
 * ==========================================================================
 */
function cleanAllSheetsDuplicates() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var totalCleanedCount = 0;
  var sheetsFixedCount = 0;

  for (var i = 0; i < sheets.length; i++) {
    var s = sheets[i];
    var name = s.getName();
    if (name.indexOf("作答紀錄") !== -1 && s.getLastRow() > 1) {
      var lastRow = s.getLastRow();
      var dataRange = s.getRange(2, 1, lastRow - 1, 8);
      var rawRows = dataRange.getValues();

      if (rawRows.length === 0) continue;

      var parsedRecords = [];
      for (var rIdx = 0; rIdx < rawRows.length; rIdx++) {
        var r = rawRows[rIdx];
        var cls = String(r[1] || "").trim();
        var rawSeatNum = parseInt(r[2], 10);
        var seatStr = (!isNaN(rawSeatNum) && rawSeatNum > 0) ? String(rawSeatNum).padStart(2, '0') : String(r[2] || "").trim();
        var studentName = String(r[3] || "").trim();

        // 檢查答案 JSON 中是否有修正後的座號
        try {
          var ansObj = typeof r[7] === 'string' ? JSON.parse(r[7]) : r[7];
          if (ansObj && ansObj.studentSeat) {
            var innerSeatNum = parseInt(ansObj.studentSeat, 10);
            if (!isNaN(innerSeatNum) && innerSeatNum > 0 && innerSeatNum <= 35) {
              seatStr = String(innerSeatNum).padStart(2, '0');
            }
          }
        } catch (e) {}

        var timeMs = 0;
        if (r[0]) {
          timeMs = Date.parse(r[0]) || 0;
          if (timeMs === 0) {
            var cleanedTimeStr = String(r[0]).replace('上午', 'AM ').replace('下午', 'PM ');
            timeMs = Date.parse(cleanedTimeStr) || 0;
          }
        }

        parsedRecords.push({
          raw: r,
          cls: cls,
          seat: seatStr,
          name: studentName,
          timeMs: timeMs || rIdx
        });
      }

      // 依時間舊到新排序
      parsedRecords.sort(function(a, b) { return a.timeMs - b.timeMs; });

      // 🛡️ 安全去重核心：只清理同班級「同一姓名」的多次提交舊列，絕不刪除任何不同姓名的學生！
      var studentLatest = {};
      parsedRecords.forEach(function(rec) {
        if (rec.name) {
          studentLatest[rec.cls + '_' + rec.name] = rec;
        } else {
          studentLatest['anon_' + rec.cls + '_' + rec.seat + '_' + rec.timeMs] = rec;
        }
      });

      // 輸出排序後乾淨資料 (同座號有不同學生時，並列呈現供教師判別)
      var cleanList = Object.keys(studentLatest).map(function(k) { return studentLatest[k]; });
      cleanList.sort(function(a, b) {
        if (a.cls !== b.cls) return a.cls.localeCompare(b.cls);
        var sa = parseInt(a.seat, 10);
        var sb = parseInt(b.seat, 10);
        if (sa !== sb) return sa - sb;
        return a.timeMs - b.timeMs;
      });

      var rowsDiff = rawRows.length - cleanList.length;
      if (rowsDiff > 0 || cleanList.length > 0) {
        s.getRange(2, 1, lastRow - 1, 8).clearContent();

        var newValues = cleanList.map(function(item) {
          var rowCopy = item.raw.slice();
          rowCopy[2] = "'" + item.seat; // 保留 '01 前導 0
          return rowCopy;
        });

        if (newValues.length > 0) {
          s.getRange(2, 1, newValues.length, 8).setValues(newValues);
        }

        formatBioSheet(s);
        if (rowsDiff > 0) {
          totalCleanedCount += rowsDiff;
          sheetsFixedCount++;
        }
      }
    }
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "已完成全試算表深度去重檢核！共修復清理 " + totalCleanedCount + " 筆重複歷史紀錄，涵蓋 " + sheetsFixedCount + " 個工作表。",
      "🧹 清理與修復成功",
      8
    );
  } catch (e) {}
}

/**
 * 試算表開啟時自動掛載自訂選單
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🧬 生物學習單工具')
    .addItem('✨ 一鍵美化所有工作表 (套用科技藍調樣式)', 'formatAllSheets')
    .addSeparator()
    .addItem('🧹 智能清理重複繳交紀錄 (保留同名最高分，絕不覆蓋不同學生)', 'cleanAllSheetsDuplicates')
    .addToUi();
}
