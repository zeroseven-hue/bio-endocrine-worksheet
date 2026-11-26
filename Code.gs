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
      var sheetName = sheetId === "4-1" ? nervousSheetName("作答紀錄") : "單元" + sheetId + "作答紀錄";
      var sheet = ss.getSheetByName(sheetName);
      
      // 相容舊命名格式
      if (!sheet && (sheetId !== "4-1" || !nervousCohort())) sheet = ss.getSheetByName("第" + sheetId + "週作答紀錄");
      if (!sheet && (sheetId !== "4-1" || !nervousCohort())) sheet = ss.getSheetByName("作答紀錄_" + sheetId);

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
          if (String(aRow[1]).trim() === String(classId).trim() && String(aRow[2]).trim() === (sheetId === "4-1" ? nervousAttendanceId() : String(sheetId).trim())) {
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
        attendance: attendance,
        cohort: sheetId === "4-1" ? nervousCohort() : ""
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
  var groupLock;
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

    if (sheetId === "4-1") {
      groupLock = LockService.getScriptLock();
      groupLock.waitLock(15000);
      if (data.mode === "group" && !data.action) return submitNervousGroup(ss, data);
    }

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
        sheetId === "4-1" ? nervousAttendanceId() : sheetId,
        data.expectedCount,
        (data.absentSeats || []).join(", "),
        (data.unsubmittedSeats || []).join(", "),
        "由教師即時儀表板同步"
      ]);

      if (sheetId === "4-1") updateNervousSummary(ss);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "出缺席紀錄已成功儲存至試算表【出缺席紀錄】分頁！"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 模式 B：教師一鍵裁決座號轉移 (Plan B 核心支援，免開試算表)
    if (data.action === "reassignSeat") {
      var sheetName = sheetId === "4-1" ? nervousSheetName("作答紀錄") : "單元" + sheetId + "作答紀錄";
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet && (sheetId !== "4-1" || !nervousCohort())) sheet = ss.getSheetByName("第" + sheetId + "週作答紀錄");
      if (!sheet && (sheetId !== "4-1" || !nervousCohort())) sheet = ss.getSheetByName("作答紀錄_" + sheetId);

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
          if (rClass === targetClass && rName === studentName &&
              (sheetId !== "4-1" || nervousSeat(values[i][2]) === nervousSeat(data.oldSeat))) {
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

        if (sheetId === "4-1") updateNervousSummary(ss);
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

    // 模式 C：學生送出作答 或 教師手動補登成績
    var sheetName = sheetId === "4-1" ? nervousSheetName("作答紀錄") : "單元" + sheetId + "作答紀錄";
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
        var rowSeatNum = parseInt(String(existingData[r][1]).trim().replace(/^'/, ""), 10);
        var rowSeatStr = (!isNaN(rowSeatNum) && rowSeatNum > 0) ? String(rowSeatNum).padStart(2, '0') : String(existingData[r][1]).trim();
        var rowName = String(existingData[r][2] || "").trim();

        if (rowClass === targetClass) {
          if (sheetId === "4-1") {
            if (targetName && rowName === targetName && rowSeatStr === targetSeat) {
              existingRowIndex = r + 2;
              break;
            }
          } else if (isManualGrade) {
            // 小組依組別重交，教師補登依座號更新。
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

    if (sheetId === "4-1" && existingRowIndex > 0 && !isManualGrade && Number(sheet.getRange(existingRowIndex, 6).getValue()) >= rowValues[5]) {
      return nervousResult({ status: "success", message: "已保留原有最高分。", recordedScore: Number(sheet.getRange(existingRowIndex, 6).getValue()) });
    }

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

    if (sheetId === "4-1") updateNervousSummary(ss);
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
  } finally {
    if (groupLock && groupLock.hasLock()) {
      try {
        SpreadsheetApp.flush();
      } finally {
        groupLock.releaseLock();
      }
    }
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
    if (!/^單元4-1(?:小組)?作答紀錄(?:$|｜)/.test(name) && name.indexOf("作答紀錄") !== -1 && s.getLastRow() > 1) {
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
    .addItem('📊 更新 4-1 成績總覽', 'refreshNervousSummary')
    .addItem('📅 切換 4-1 作答梯次', 'switchNervousCohort')
    .addSeparator()
    .addItem('🧹 智能清理重複繳交紀錄 (保留同名最高分，絕不覆蓋不同學生)', 'cleanAllSheetsDuplicates')
    .addToUi();
}


function nervousCohort() {
  return PropertiesService.getScriptProperties().getProperty("NERVOUS_4_1_COHORT") || "";
}

function nervousAttendanceId() {
  const cohort = nervousCohort();
  return cohort ? "4-1｜" + cohort : "4-1";
}

function nervousSheetName(kind) {
  const cohort = nervousCohort();
  return "單元4-1" + kind + (cohort ? "｜" + cohort : "");
}

function switchNervousCohort() {
  const ui = SpreadsheetApp.getUi();
  const reply = ui.prompt("切換 4-1 作答梯次",
    "目前：" + (nervousCohort() || "原有梯次") + "。請輸入三位數學年度（例如 116）。留白可回到原有梯次。",
    ui.ButtonSet.OK_CANCEL);
  if (reply.getSelectedButton() !== ui.Button.OK) return;
  const cohort = reply.getResponseText().trim();
  if (cohort && !/^\d{3}$/.test(cohort)) {
    ui.alert("請輸入三位數學年度。");
    return;
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    PropertiesService.getScriptProperties().setProperty("NERVOUS_4_1_COHORT", cohort);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    updateNervousSummary(ss);
    SpreadsheetApp.flush();
    ss.toast("目前梯次：" + (cohort || "原有梯次"), "4-1 作答梯次");
  } finally {
    lock.releaseLock();
  }
}

function nervousResult(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function nervousRows(sheet) {
  return sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues() : [];
}

function nervousDetail(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw || "{}") || {}; } catch (error) { return {}; }
}

function nervousSeat(raw) {
  const seat = String(raw || "").trim().replace(/^'/, "");
  return /^\d{1,2}$/.test(seat) && Number(seat) >= 1 && Number(seat) <= 35
    ? seat.padStart(2, "0") : "";
}

function nervousMembers(raw) {
  return Array.from(new Set((Array.isArray(raw) ? raw : String(raw || "").split(/[,，]/))
    .map(nervousSeat).filter(Boolean))).sort();
}

function nervousGroupTasks(detail) {
  const traffic = detail.traffic || {};
  const tasks = {};
  function add(id, source, fields, assignee) {
    const answers = {};
    fields.forEach(field => {
      const value = source[field];
      if (typeof value === "string" && value.trim()) answers[field] = value.trim();
      else if (Array.isArray(value) && value.length && value.every(item => typeof item === "string")) {
        answers[field] = Array.from(new Set(value)).sort();
      }
    });
    if (!Object.keys(answers).length) return;
    const seat = nervousSeat(assignee);
    tasks[id] = { answers, seat, complete: Object.keys(answers).length === fields.length };
  }
  ["A","B","C","D"].forEach(id => {
    const center = (detail.centers || {})[id] || {};
    add(id, center, ["name","func","case"], center.assignee);
  });
  const first = detail.compare1 || {};
  const second = detail.compare2 || {};
  add("比較表一", first, ["con_center","ref_center","con_path","ref_path","con_time","ref_time","con_sign","ref_sign"], first.assignee);
  add("比較表二", second, ["pull_center","pull_order","pain_center","pain_order"], second.assignee);
  add("安全車距", traffic, ["t1_dist_calc","t1_dist_reason"], traffic.t1_assignee);
  add("酒駕分析", traffic, ["t2_alcohol"], traffic.t2_assignee);
  add("行動承諾", traffic, ["group_traffic_essay"]);
  return tasks;
}

function submitNervousGroup(ss, data) {
  const cls = String(data.studentClass || data.class || "").trim();
  const group = String(data.studentGroup || data.seatOrGroup || "").trim();
  const members = nervousMembers(data.groupMembers || data.nameOrMembers);
  if (!/^70[1-9]$|^710$/.test(cls) || !/^[1-8]$/.test(group) || members.length < 3 || members.length > 6) {
    return nervousResult({ status: "warning", message: "請確認班級、組別與出席組員座號。" });
  }
  const incoming = nervousGroupTasks(nervousDetail(data.detailData));
  const taskIds = Object.keys(incoming);
  if (!taskIds.length || taskIds.some(id => id !== "行動承諾" && !members.includes(incoming[id].seat))) {
    return nervousResult({ status: "warning", message: "請先填寫至少一項任務，並為本次作答的任務選擇認領組員。" });
  }

  const sheetName = nervousSheetName("小組作答紀錄");
  let sheet = ss.getSheetByName(sheetName);
  const rows = nervousRows(sheet);
  const index = rows.findIndex(row => String(row[1]).trim() === cls && nervousSeat(row[2]) === nervousSeat(group));
  const oldRow = index >= 0 ? rows[index] : null;
  const previous = nervousDetail(oldRow && oldRow[7]);
  const existing = nervousGroupTasks(previous);
  const mergedDetail = {
    class: cls, groupNum: group, groupSize: String(members.length), members,
    centers: {}, compare1: {}, compare2: {}, traffic: {}
  };

  const sameTeam = !oldRow || JSON.stringify(nervousMembers(oldRow[3])) === JSON.stringify(members);
  if (!sameTeam) {
    return nervousResult({ status: "warning", message: "本組已登記的出席座號與這次不同。請核對班級、組別及組員，或請老師處理後再交。" });
  }
  const conflicts = taskIds.filter(id => {
    if (!existing[id]) return false;
    const prior = existing[id];
    const next = incoming[id];
    return Object.keys(next.answers).some(field => field in prior.answers &&
      JSON.stringify(prior.answers[field]) !== JSON.stringify(next.answers[field])) ||
      Boolean(prior.seat && next.seat && prior.seat !== next.seat);
  });
  const revision = oldRow ? Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, JSON.stringify(oldRow)
  )) : "";
  if (conflicts.length && data.confirmedRevision !== revision) {
    return nervousResult({ status: "conflict", tasks: conflicts, revision });
  }

  Array.from(new Set(Object.keys(existing).concat(taskIds))).forEach(id => {
    const previousTask = existing[id] || { answers: {}, seat: "" };
    const nextTask = incoming[id] || { answers: {}, seat: "" };
    const answers = Object.assign({}, previousTask.answers, nextTask.answers);
    const seat = nextTask.seat || previousTask.seat;
    if (/^[A-D]$/.test(id)) mergedDetail.centers[id] = Object.assign({ assignee: seat }, answers);
    else if (id === "比較表一") mergedDetail.compare1 = Object.assign({ assignee: seat }, answers);
    else if (id === "比較表二") mergedDetail.compare2 = Object.assign({ assignee: seat }, answers);
    else {
      Object.assign(mergedDetail.traffic, answers);
      if (id === "安全車距") mergedDetail.traffic.t1_assignee = seat;
      if (id === "酒駕分析") mergedDetail.traffic.t2_assignee = seat;
    }
  });

  const tasks = Object.values(nervousGroupTasks(mergedDetail));
  const complete = tasks.length === 9 && tasks.every(task => task.complete) &&
    members.every(member => tasks.some(task => task.seat === member));
  mergedDetail.complete = complete;
  const result = scoreNervousGroup(mergedDetail);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  if (!sheet.getLastRow()) {
    sheet.appendRow(["時間戳記","班級","座號","姓名","組別/模式","系統初評分數","評分明細","作答詳情 (JSON 原始紀錄)"]);
    formatBioSheet(sheet);
  }
  const values = [new Date(), cls, "'" + nervousSeat(group), members.join(", "), group,
    complete ? result.score : "", result.breakdown.join("； "), JSON.stringify(mergedDetail)];
  if (oldRow) sheet.getRange(index + 2, 1, 1, 8).setValues([values]);
  else sheet.appendRow(values);
  if (sheet.getLastRow() > 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).sort([
    {column: 2, ascending: true}, {column: 3, ascending: true}
  ]);
  updateNervousSummary(ss);
  return nervousResult({ status: "success", complete, recordedScore: complete ? result.score : null, breakdown: result.breakdown });
}

function refreshNervousSummary() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    updateNervousSummary(SpreadsheetApp.getActiveSpreadsheet());
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function nervousSubmissionTime(value) {
  if (value instanceof Date) return value.getTime();
  const match = String(value || "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ ,，]*(上午|下午)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return Date.parse(value) || 0;
  const [, year, month, day, period, hour, minute, second] = match;
  const hour24 = period ? Number(hour) % 12 + (period === "下午" ? 12 : 0) : Number(hour);
  return Date.UTC(Number(year), Number(month) - 1, Number(day), hour24 - 8, Number(minute), Number(second || 0));
}

function updateNervousSummary(ss) {
  const seats = new Map();
  function seatEntry(cls, seat) {
    const key = cls + "/" + seat;
    if (!seats.has(key)) seats.set(key, { cls, seat, names: new Map(), groups: new Map(), absent: false, submittedAt: 0 });
    return seats.get(key);
  }
  function scoreOf(value) {
    return value === "" || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
  }
  function schoolClass(value) {
    return /^70[1-9]$|^710$/.test(value);
  }

  const attendance = ss.getSheetByName("出缺席紀錄");
  const settings = new Map();
  if (attendance && attendance.getLastRow() > 1) {
    attendance.getRange(2, 2, attendance.getLastRow() - 1, 4).getValues().forEach(row => {
      const cls = String(row[0]).trim();
      if (String(row[1]).trim() === nervousAttendanceId() && schoolClass(cls)) settings.set(cls, row);
    });
  }
  settings.forEach((row, cls) => {
    const absent = nervousMembers(row[3]);
    const count = Math.min(35, Math.max(0, Math.floor(Number(row[2]) || 0)));
    for (let i = 1; i <= count; i++) seatEntry(cls, nervousSeat(i));
    absent.forEach(seat => { seatEntry(cls, seat).absent = true; });
  });
  nervousRows(ss.getSheetByName(nervousSheetName("作答紀錄"))).forEach(row => {
    const cls = String(row[1]).trim(), seat = nervousSeat(row[2]), name = String(row[3]).trim();
    if (!schoolClass(cls) || !seat || !name) return;
    const entry = seatEntry(cls, seat);
    const score = scoreOf(row[5]);
    entry.submittedAt = Math.max(entry.submittedAt, nervousSubmissionTime(row[0]) || 0);
    const previous = entry.names.get(name);
    if (previous == null || (score != null && score > previous)) entry.names.set(name, score);
  });
  nervousRows(ss.getSheetByName(nervousSheetName("小組作答紀錄"))).forEach(row => {
    const cls = String(row[1]).trim(), group = nervousSeat(row[2]);
    if (!schoolClass(cls) || !group) return;
    const detail = nervousDetail(row[7]);
    const score = detail.complete === false ? null : scoreOf(row[5]);
    nervousMembers(row[3]).forEach(seat => {
      const entry = seatEntry(cls, seat);
      entry.groups.set(group, score);
      entry.submittedAt = Math.max(entry.submittedAt, nervousSubmissionTime(row[0]) || 0);
    });
  });

  const header = ["最近留存繳交時間","班級","座號","姓名","採計平均","個人最高分","小組成績","組別","狀態"];
  const rows = Array.from(seats.values()).sort((a,b) => a.cls.localeCompare(b.cls) || a.seat.localeCompare(b.seat)).map(entry => {
    const names = Array.from(entry.names.keys()), groups = Array.from(entry.groups.keys()).sort();
    const individual = names.length === 1 ? entry.names.get(names[0]) : null;
    const group = groups.length === 1 && names.length <= 1 ? entry.groups.get(groups[0]) : null;
    const issues = [];
    if (names.length > 1) issues.push("同座號多個姓名");
    if (groups.length > 1) issues.push("組別重複");
    if (entry.absent && (names.length || groups.length)) issues.push("請假／缺號有交卷");
    const average = !issues.length && !entry.absent && individual != null && group != null ? (individual + group) / 2 : "";
    const status = issues.length ? "待核對：" + issues.join("、") : entry.absent ? "請假／缺號" :
      average !== "" ? "已完成" : individual == null && group == null ? "待繳" : individual == null ? "待個人作答" : "待小組完成";
    const submittedAt = entry.submittedAt
      ? Utilities.formatDate(new Date(entry.submittedAt), "Asia/Taipei", "yyyy/MM/dd HH:mm") : "";
    return [submittedAt, entry.cls, entry.seat, names.join("／"), average, individual ?? "", group ?? "", groups.join("／"), status];
  });

  const cohort = nervousCohort();
  const summaryName = "4-1 成績總覽" + (cohort ? "｜" + cohort : "");
  let summary = ss.getSheetByName(summaryName);
  if (!summary) summary = ss.insertSheet(summaryName, 0);
  if (summary.getRange(1, 1).getValue() !== header[0]) {
    const oldFilter = summary.getFilter();
    const oldCriteria = [];
    if (oldFilter) {
      const range = oldFilter.getRange();
      for (let col = range.getColumn(); col <= range.getLastColumn(); col++) {
        const criteria = oldFilter.getColumnFilterCriteria(col);
        if (criteria) oldCriteria.push([col + 1, criteria]);
      }
      oldFilter.remove();
    }
    summary.setFrozenRows(1);
    summary.getRange(1, 1, 1, header.length).setBackground("#1E3A8A").setFontColor("#FFFFFF").setFontWeight("bold");
    summary.setColumnWidth(1, 155);
    summary.setColumnWidth(3, 75);
    summary.setColumnWidth(4, 150);
    summary.setColumnWidth(8, 90);
    summary.setColumnWidth(9, 250);
    summary.getRange("A:A").setNumberFormat("@");
    summary.getRange("B:B").setNumberFormat("0");
    summary.getRange("C:C").setNumberFormat("@");
    summary.getRange("E:E").setNumberFormat("0.##");
    const filter = summary.getRange(1, 1, summary.getMaxRows(), header.length).createFilter();
    oldCriteria.forEach(([col, criteria]) => filter.setColumnFilterCriteria(col, criteria));
  }
  if (rows.length + 1 > summary.getMaxRows()) summary.insertRowsAfter(summary.getMaxRows(), rows.length + 1 - summary.getMaxRows());
  const previousRows = summary.getLastRow();
  summary.getRange(1, 1, rows.length + 1, header.length).setValues([header].concat(rows));
  if (previousRows > rows.length + 1) {
    summary.getRange(rows.length + 2, 1, previousRows - rows.length - 1, header.length).clearContent();
  }
}

function scoreNervousGroup(detail) {
  // 小組計分 (滿分 100 分)
  let score = 0;
  const breakdownList = [];

  // 【任務一：中樞解剖座標認領 (共 32 分)】
  const correctCenters = {
    A: { name: "大腦", func: "意識與感覺思考運動", case: "中風半身不遂或失語" },
    B: { name: "小腦", func: "協調骨骼肌維持平衡", case: "酒醉走路搖晃步伐不穩" },
    C: { name: "腦幹", func: "心跳呼吸生命中樞", case: "昏迷呼吸停止腦死判定" },
    D: { name: "脊髓", func: "軀幹四肢反射中樞", case: "小兒麻痺或下半身癱瘓" }
  };

  ["A", "B", "C", "D"].forEach(c => {
    if (!detail.centers[c]) return;
    const n = detail.centers[c].name;
    const f = detail.centers[c].func;
    const cs = detail.centers[c].case;
    const cor = correctCenters[c];

    if (n === cor.name && f === cor.func && cs === cor.case) {
      score += 8;
      breakdownList.push(`任務一中樞${c}(${cor.name})全對 (+8)`);
    } else if (n === cor.name && (f === cor.func || cs === cor.case)) {
      score += 5;
      breakdownList.push(`任務一中樞${c}(${cor.name})部分正確 (+5)`);
    }
  });

  // 【任務二：意識行為 vs 反射雙軌模型 (共 32 分)】
  // 表一 (16分)
  let t1Hits = 0;
  if (detail.compare1.con_center === "大腦") t1Hits++;
  if (detail.compare1.ref_center === "脊髓或腦幹") t1Hits++;
  if (detail.compare1.con_path === "較長需經大腦分析") t1Hits++;
  if (detail.compare1.ref_path === "極短不經大腦思考") t1Hits++;
  if (detail.compare1.con_time === "時間長易受分心干擾") t1Hits++;
  if (detail.compare1.ref_time === "極迅速且固定不變") t1Hits++;
  if (detail.compare1.con_sign === "彈性學習因應複雜環境") t1Hits++;
  if (detail.compare1.ref_sign === "緊急防禦爭取生機") t1Hits++;

  score += t1Hits * 2;
  if (t1Hits >= 6) breakdownList.push(`任務二比較表一機制大對決精準 (+${t1Hits*2})`);

  // 表二 (16分)
  if (detail.compare2.pull_center === "脊髓" && detail.compare2.pull_order === "先發生") {
    score += 8; breakdownList.push("縮手反射先發生正確 (+8)");
  }
  if (detail.compare2.pain_center === "大腦" && detail.compare2.pain_order === "後發生") {
    score += 8; breakdownList.push("大腦感到劇痛後發生正確 (+8)");
  }

  // 【任務三：交通安全實況危機模擬與宣言 (共 36 分)】
  if (detail.traffic.t1_dist_calc === "約33公尺") {
    score += 8; breakdownList.push("情境一安全車距計算精準 (+8)");
  }
  const t1Reason = String(detail.traffic.t1_dist_reason || "").trim();
  if (t1Reason.length >= 8) {
    score += 6; breakdownList.push("情境一車距意涵分析完整 (+6)");
  }

  const t2Alc = detail.traffic.t2_alcohol || [];
  const t2Traps = ["增強視力夜視功能", "骨骼鈣質快速結晶硬化"];
  const hasAlcTraps = t2Alc.some(item => t2Traps.includes(item));
  if (t2Alc.includes("麻痺大腦判斷遲鈍") && t2Alc.includes("麻痺小腦步伐不穩") && t2Alc.includes("神經傳導延緩反應時間拉長") && !hasAlcTraps) {
    score += 10; breakdownList.push("情境二酒駕神經毒性機制全對 (+10)");
  } else if (!hasAlcTraps && t2Alc.length >= 2) {
    score += 6; breakdownList.push("情境二酒駕分析部分正確 (+6)");
  }

  // 宣言 (12分)
  const groupTrafficEssay = String(detail.traffic.group_traffic_essay || "").trim();
  const essayWords = ["安全", "車距", "專注", "手機", "觀察", "防禦", "行人", "轉頭", "遵守", "提醒", "減速"];
  const hasTrafficKeywords = essayWords.some(w => groupTrafficEssay.includes(w));
  if (groupTrafficEssay.length >= 25 && hasTrafficKeywords) {
    score += 12; breakdownList.push("情境三防禦性駕駛行動承諾深刻 (+12)");
  } else if (groupTrafficEssay.length >= 8) {
    score += 6; breakdownList.push("情境三行動承諾基本填寫 (+6)");
  }

  score = Math.min(100, score);

  return { score: score, breakdown: breakdownList };
}
