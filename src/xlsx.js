/**
 * 本地 XLSX 写出器：将行数据编码为 XML 和 ZIP，暴露 ROLEMI_XLSX 接口。
 * 供岗位导出使用，不依赖远端服务或构建工具。
 */
(function () {
  // 这个文件实现一个极小的 xlsx 写出器，避免为了导出 Excel 引入 npm 构建流程。
  // xlsx 本质是一个 zip 包，里面包含若干 XML 文件；这里生成的是最小可被 Excel 打开的结构。
  const encoder = new TextEncoder();

  function escapeXml(value) {
    // 单元格文本会进入 XML，必须转义，否则 &、<、> 等字符会破坏 sheet XML。
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function columnName(index) {
    // Excel 列名从 A 到 Z，再到 AA、AB。这里把 0-based 数字转成列名。
    let name = "";
    let value = index + 1;

    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }

    return name;
  }

  function sheetXml(rows, sheetName) {
    // 以第一行对象的 key 作为表头，后续每个对象按同一表头顺序输出。
    // 使用 inlineStr 可以省掉 sharedStrings.xml，让文件结构更简单。
    const headers = Object.keys(rows[0] || { "提示": "" });
    const allRows = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
    const xmlRows = allRows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, cellIndex) => {
            const ref = `${columnName(cellIndex)}${rowIndex + 1}`;
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
          })
          .join("");
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData>${xmlRows}</sheetData>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
  }

  function workbookXml(sheetName) {
    // workbook.xml 只声明一个工作表。sheetName 会显示为 Excel 底部标签名。
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
  }

  function crc32(bytes) {
    // ZIP 本地文件头和中央目录都需要 CRC32。
    // 这里使用标准多项式 0xedb88320，避免依赖外部 zip 库。
    let crc = -1;

    for (const byte of bytes) {
      crc ^= byte;
      for (let i = 0; i < 8; i += 1) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }

    return (crc ^ -1) >>> 0;
  }

  function uint16(value) {
    // ZIP 文件格式使用 little-endian，这两个函数把数字拆成低位在前的字节。
    return [value & 0xff, (value >>> 8) & 0xff];
  }

  function uint32(value) {
    return [
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff
    ];
  }

  function concat(chunks) {
    // Uint8Array 不能直接 push 字节块，所以先计算总长度再逐段拷贝。
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  function zip(files) {
    // 生成无压缩 zip：
    // 1. 每个文件写 local file header + 文件名 + 内容
    // 2. 末尾写 central directory
    // 3. 最后写 end of central directory
    // xlsx 文件不要求必须压缩，无压缩 zip 更容易手写和调试。
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const file of files) {
      // 当前实现只支持 UTF-8 文本文件，足够覆盖 xlsx 需要的 XML 部件。
      const nameBytes = encoder.encode(file.name);
      const dataBytes = encoder.encode(file.content);
      const crc = crc32(dataBytes);
      const localHeader = new Uint8Array([
        // Local file header signature: 0x04034b50
        ...uint32(0x04034b50),
        ...uint16(20),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint32(crc),
        ...uint32(dataBytes.length),
        ...uint32(dataBytes.length),
        ...uint16(nameBytes.length),
        ...uint16(0)
      ]);
      const centralHeader = new Uint8Array([
        // Central directory file header signature: 0x02014b50
        ...uint32(0x02014b50),
        ...uint16(20),
        ...uint16(20),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint32(crc),
        ...uint32(dataBytes.length),
        ...uint32(dataBytes.length),
        ...uint16(nameBytes.length),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint32(0),
        ...uint32(offset)
      ]);

      localChunks.push(localHeader, nameBytes, dataBytes);
      centralChunks.push(centralHeader, nameBytes);
      offset += localHeader.length + nameBytes.length + dataBytes.length;
    }

    const centralDirectory = concat(centralChunks);
    const end = new Uint8Array([
      // End of central directory signature: 0x06054b50
      ...uint32(0x06054b50),
      ...uint16(0),
      ...uint16(0),
      ...uint16(files.length),
      ...uint16(files.length),
      ...uint32(centralDirectory.length),
      ...uint32(offset),
      ...uint16(0)
    ]);

    return concat([...localChunks, centralDirectory, end]);
  }

  function createWorkbookBlob(rows, sheetName) {
    // xlsx 最小包结构：
    // - [Content_Types].xml 声明文件类型
    // - _rels/.rels 指向 xl/workbook.xml
    // - xl/workbook.xml 声明工作表
    // - xl/_rels/workbook.xml.rels 指向 sheet1.xml
    // - xl/worksheets/sheet1.xml 保存真实表格数据
    const safeRows = rows.length ? rows : [{ "提示": "暂无岗位数据" }];
    const files = [
      {
        name: "[Content_Types].xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
      },
      {
        name: "_rels/.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
      },
      {
        name: "xl/workbook.xml",
        content: workbookXml(sheetName || "岗位")
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
      },
      {
        name: "xl/worksheets/sheet1.xml",
        content: sheetXml(safeRows, sheetName || "岗位")
      }
    ];

    return new Blob([zip(files)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  window.ROLEMI_XLSX = {
    // 暴露给侧边栏面板使用。content script 不需要加载这个文件。
    createWorkbookBlob
  };
})();
