// --- 워커 소스(클래식) : 외부 파일 없이 Blob으로 생성할 수 있게 문자열로 보관 ---
var workerSource = `

  var decoder = new TextDecoder("utf-8");
  var encoder = new TextEncoder();

  var textBuffer = "";
  var loaded = 0;
  var curByte = 0;
  
  var searchWord = "";
  
  var defaultSearchWord = "▶ INFO";
  //var searchWord = "VERIFICATION_LST_MASTER";
  
  var lineIndex = 0;
  
  var arrayMax = 3000*1000;

  // 검색 라인
  var searchLineIndex = 0;
  var searchLineArray;  // time ms가 들어간다.
  var searchLineStartByteArray; // 시작바이트
  var searchLineEndByteArray; // 종료 바이트

  var timeCur = 0;
  var timeStart = 0;
  var timeLast = 0;

  // 줄 라인 검색 버퍼
  var byteEnds;

  var carryText = '';             // 문자열 경계 보존
  var byteOffset = 0;             // 지금까지 소비한 바이트 수 (파일 기준)
  var lastByteWasCR = false;      // 직전 청크가 '\\r'로 끝났는지
  var currentLineStartByte = 0;   // 현재 라인의 시작 바이트 오프셋
  var reportLineStartByte = 0;
  
  // Exception 멀티라인 파싱을 위한 변수들
  var exceptionBuffer = '';       // Exception 텍스트 버퍼
  var exceptionStartByte = 0;     // Exception 시작 바이트
  var exceptionEndByte = 0;       // Exception 종료 바이트
  var isInException = false;      // Exception 파싱 중인지 여부

  function init() {
    textBuffer = "";
    loaded = 0;
    searchWord = "";
    lineIndex = 0;
    searchLineIndex = 0;
    searchLineStartByteArray = new Int32Array(arrayMax);
    searchLineEndByteArray = new Int32Array(arrayMax);
    searchLineArray = new Int32Array(arrayMax);
    timeStart = 0;
    timeCur = 0;
    timeLast = 0;
    byteEnds = new Int32Array(1000*10); 
    carryText = '';             
    byteOffset = 0;             
    lastByteWasCR = false;      
    currentLineStartByte = 0;
    reportLineStartByte = 0;
    exceptionBuffer = '';
    exceptionStartByte = 0;
    exceptionEndByte = 0;
    isInException = false;
  }

  onmessage = function (e) {
    var d = e.data || {};
    var cmd = d.cmd;
    try {
      if (cmd == "start"){
        init();
        searchWord = d.searchWord;
        console.log("d.searchWord = ",d.searchWord);
          } else if(cmd === "chunk") {
        var u8 = new Uint8Array(d.chunk);
        processChunk(u8);
        //processChunk(d.chunk);
      } else if (cmd === "end") {
        flushAndFinish();
      }
    } catch (err) {
      postMessage({ type: "error", message: String(err && err.message || err) });
    }
  };

  function processChunk(u8) {

    loaded += u8.byteLength; // 읽은 바이트 수

    //console.log("processChunk start");
    //console.log("u8 = ",u8);
    //console.log("u8.length = ",u8.length);
    //console.log("u8.byteLength = ",u8.byteLength);

    // 1) 이번 청크에서 줄 끝 바이트 위치 찾기
    let byteEndsIndex = 0;
    for (let i = 0; i < u8.length; i++) {
      if (u8[i] === 0x0A) { // '\\n'
        // CRLF 처리를 위해 엔드 바이트를 계산:
        // - 이전 바이트가 CR(0x0D)이면 해당 CR을 제외하고 '\\n'도 제외
        // - 직전 청크 말미가 CR이었던 경우도 제외
        const isCRLF = (i > 0 && u8[i - 1] === 0x0D) || lastByteWasCR;
        const lineEndByteExclusive = byteOffset + i - (isCRLF ? 1 : 0);
        byteEnds[byteEndsIndex] = lineEndByteExclusive;
        byteEndsIndex++;
      }
    }

    // 2) 문자열 디코딩 (경계 안전)
    const decoded = decoder.decode(u8, { stream: true });
    const parts = (carryText + decoded).split(/\\r?\\n/);
    carryText = parts.pop() ?? '';

    // 3) 바이트 경계와 문자열 라인 매칭
    //    parts.length === 이번 청크에서 "완성된 라인 수" === byteEnds.length 가 정상
    const completed = Math.min(parts.length, byteEndsIndex);
    for (let i = 0; i < completed; i++) {
      const lineText = parts[i];
      const lineEndByteExclusive = byteEnds[i];
      parseLine(lineText
                ,searchWord
                ,currentLineStartByte
                ,lineEndByteExclusive);

      currentLineStartByte = lineEndByteExclusive + 1 /* 보통 LF 뒤부터 시작 */;
      // CRLF였어도 endByteExclusive는 CR 앞이므로, 다음 라인 시작은 LF 다음 바이트
      // = (실제 줄바꿈 바이트들을 건너뛰는 효과). 정확히 하려면 아래의 lastByteWasCR 처리와 함께 동작.

      // 1000 * 100 라인마다 한 번 보고
      if ((lineIndex % (1000 * 10)) === 0) {
        reportProgress("progress");
      }

      lineIndex++;
    }

    // 4) 청크 경계 상태 업데이트
    lastByteWasCR = u8.length > 0 && u8[u8.length - 1] === 0x0D;
    byteOffset += u8.length;
  }

  function parseLine(line, _searchword,lineStartByte,lineEndByte) {

    if(line.length > 20) {
        var _time = line.slice(8, 20).trim();
        var isTime = /\\d{2}:\\d{2}:\\d{2}\\.\\d{3}/g.test(_time);
        if(isTime) {
            timeCur = parseInt(_time.replace(/[:.]/g, ""));
        
        if(timeStart == 0) {
          timeStart = timeCur;
          console.log("timeStart =",timeStart); 
        }
        if(timeCur > timeLast)
          timeLast = timeCur;
      }

      textBuffer = line;
    }

    // Exception 멀티라인 파싱 로직
    var isExceptionStart = line.indexOf('java.lang.') >= 0 || 
                          line.indexOf('Exception:') >= 0 || 
                          line.indexOf('Error:') >= 0;
    
    var isStackTraceLine = line.trim().startsWith('at ') || 
                          line.trim().startsWith('Caused by:') || 
                          line.trim().startsWith('Suppressed:') ||
                          line.trim().startsWith('... ');

    if (isExceptionStart && !isInException) {
      // Exception 시작
      isInException = true;
      exceptionBuffer = line;
      exceptionStartByte = lineStartByte;
      exceptionEndByte = lineEndByte;
    } else if (isInException && isStackTraceLine) {
      // Stack trace 라인 추가
      exceptionBuffer += '\\n' + line;
      exceptionEndByte = lineEndByte;
    } else if (isInException) {
      // Exception 종료 - 저장
      if (_searchword === 'java.lang.Exception' || _searchword === 'Exception' || exceptionBuffer.indexOf(_searchword) >= 0) {
        searchLineArray[searchLineIndex] = timeCur;
        searchLineStartByteArray[searchLineIndex] = exceptionStartByte;
        searchLineEndByteArray[searchLineIndex] = exceptionEndByte;
        searchLineIndex++;
      }
      
      // 버퍼 초기화
      isInException = false;
      exceptionBuffer = '';
      
      // 현재 라인이 새로운 Exception 시작인지 확인
      if (isExceptionStart) {
        isInException = true;
        exceptionBuffer = line;
        exceptionStartByte = lineStartByte;
        exceptionEndByte = lineEndByte;
      }
    }

    // 일반 검색어 처리 (Exception 검색이 아닌 경우)
    if (!isInException && _searchword !== 'java.lang.Exception' && _searchword !== 'Exception' && line.indexOf(_searchword) >= 0) {
      searchLineArray[searchLineIndex] = timeCur;
      searchLineStartByteArray[searchLineIndex] = lineStartByte;
      searchLineEndByteArray[searchLineIndex] = lineEndByte;
      searchLineIndex++;
    } 
  }

  function reportProgress(kind) {
      postMessage({
        type: kind,
        loaded: loaded,
        lineIndex: lineIndex,
        searchLineSize:searchLineIndex,
        preview: textBuffer.length > 200 ? textBuffer.slice(-100) : textBuffer, 
        // done 용
        searchLineArray: kind == "done" ? searchLineArray : null,
        timeStart: kind == "done" ? timeStart : 0,
        timeLast: kind == "done" ? timeLast : 0,
        searchLineStartByteArray: kind == "done" ? searchLineStartByteArray : null,
        searchLineEndByteArray: kind == "done" ? searchLineEndByteArray : null,
      });
  }

  function flushAndFinish() {

    // 5) 마지막 flush
    const tail = decoder.decode(); // 남은 멀티바이트 flush
    carryText += tail;

    // 파일 끝에 줄바꿈이 없고 carryText가 남아 있으면, 그게 마지막 라인
    if (carryText.length > 0) {
      parseLine(carryText
                ,searchWord
                ,currentLineStartByte
                ,byteOffset);
    }

    // 마지막 Exception이 아직 버퍼에 남아있는 경우 저장
    if (isInException && exceptionBuffer) {
      if (searchWord === 'java.lang.Exception' || searchWord === 'Exception' || exceptionBuffer.indexOf(searchWord) >= 0) {
        searchLineArray[searchLineIndex] = timeCur;
        searchLineStartByteArray[searchLineIndex] = exceptionStartByte;
        searchLineEndByteArray[searchLineIndex] = exceptionEndByte;
        searchLineIndex++;
      }
      isInException = false;
      exceptionBuffer = '';
    }

    // 6) 최종 보고
    //reportProgress("progress");

    console.log("searchLineArray = ",searchLineArray);

    // 7) 최종 완료
    reportProgress("done");

  }
`;