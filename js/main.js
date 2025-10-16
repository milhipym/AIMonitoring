// main.js

// UI
var fileInput;
var fileName;
var searchWordEl;
var prog;
var statusEl;
var previewEl;
var resultviewEl;
var chartEl;

// logfile
var logfile;

// worker
var worker = null;
var blobUrlForWorker = null;

var timeRangeSize = 24;

const timeRangeObj = {
  timeRangeCountArray: null, // 각 시간범위의 카운트값 어레이 
  timeRangeEndByteArray: null, //  각 시간범위의 엔드 바이트 어레이
  xRangeArray: null, // 차트에 보여줄 x 값 어레이 .  어레이 카운트는 (timeRangeSize * 2 + 1) 이다.
  xRangeSizeArray: null,  // 차트에 보여줄 x 값의 사이즈 어레이. 차트에보여주기위해 리스케일을 한다. 어레이 카운트는 (timeRangeSize * 2 + 1) 이다.
};

const searchObj = {
  searchLineStartByteArray: null,
  searchLineEndByteArray: null,
};

// 전역으로 노출
window.searchObj = searchObj;

var selectTimeRangeStartIndex = 0;
var selectTimeRangeEndIndex = 0;

// 

// 컨텐츠 로드
document.addEventListener("DOMContentLoaded", function () {

  fileInput = document.getElementById('file');
  fileName = document.getElementById('file-name');
  searchWordEl = document.getElementById('searchWord');
  prog = document.getElementById('prog');
  statusEl = document.getElementById('status');
  previewEl = document.getElementById('preview');
  resultviewEl = document.getElementById('resultview');
  chartEl = document.getElementById('chart');

  // --- 이벤트 바인딩 ---
  fileInput.addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) {
      logfile = f;
      fileName.textContent = f.name;
      e.target.value = "";

      chartDragClear();

      timeRangeSize = 24;
      
      // 검색 버튼 깜빡임 추가
      var searchBtn = document.getElementById('btnSearch');
      if (searchBtn) {
        searchBtn.classList.add('btn-blink');
      }
    }
  });

  searchWordEl.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      doSearch();
    }
  });

  // 첫 로드 시 Blob 워커 준비
  startWorker();

  // 차트 초기화
  initChart();
  
  // 로그 뷰어 초기화
  addLogLine("SYSTEM INITIALIZED");
  
  // 메모리 모니터링 초기화 (500ms 후)
  setTimeout(initMemoryMonitoring, 500);
});

// 해커 스타일 로그 라인 관리
const MAX_LOG_LINES = 20;

function clearLogLines() {
  previewEl.innerHTML = '';
}

function addLogLine(text) {
  const logLine = document.createElement('div');
  logLine.className = 'log-line';
  logLine.textContent = text;
  
  previewEl.appendChild(logLine);
  
  // 20줄 초과 시 가장 오래된 줄 제거
  while (previewEl.children.length > MAX_LOG_LINES) {
    previewEl.removeChild(previewEl.firstChild);
  }
  
  // 자동 스크롤 (가장 최신 로그가 보이도록)
  previewEl.scrollTop = previewEl.scrollHeight;
}

// --- Blob 워커 생성 ---
function createBlobWorker() {
  var blob = new Blob([workerSource], { type: "text/javascript" });
  blobUrlForWorker = URL.createObjectURL(blob);
  return new Worker(blobUrlForWorker); // classic worker
}

// --- 외부 파일 워커 생성 (HTTP 서버에서만 동작; file://에선 보안 때문에 실패) ---
function createFileWorker() {
  return new Worker("logWorker.js"); // classic worker
}

// --- 워커 시작/정리 ---
function startWorker() {
  cleanupWorker();

  // 로컬용
  worker = createBlobWorker();
  // 서버용
  //worker = createFileWorker();

  worker.onmessage = function (e) {
    var d = e.data || {};
    if (d.type === "progress" || d.type === "done") {
      if (typeof d.loaded === "number")
        prog.value = d.loaded;
      const icon = d.type === "progress" ? "🔄" : "✅";
      const statusText = document.querySelector('#status .status-text');
      if (statusText) {
        statusText.textContent =
          icon + " " + (d.type.toUpperCase()) + " | BYTES: " + (d.loaded || 0).toLocaleString() +
          " | LINES: " + (d.lineIndex || 0).toLocaleString() +
          " | MATCHES: " + (d.searchLineSize || 0);
      }
      
      if (d.type === "progress") {
        statusEl.classList.add('processing');
      } else {
        statusEl.classList.remove('processing');
      }
      
      if (d.preview != null) {
        addLogLine(">>> " + d.preview);
      }

      if (d.type === "done") {

        console.log("d.timeStart =", d.timeStart);
        console.log("d.timeLast =", d.timeLast);

        var timeStartMs = hhmmssmsToMs(d.timeStart);
        var timeLastMs = hhmmssmsToMs(d.timeLast);

        console.log("timeStartMs =", timeStartMs);
        console.log("timeLastMs =", timeLastMs);

        // xRangeArray 에 중복되는 영역이 있는지 체크해서 사이즈를 줄여나간다.
        var timeRangeMsArray = null;
        var xRangeArray = null;

        for (var i = timeRangeSize; i > 0; i--) {
          timeRangeSize = i;
          //console.log("timeRangeSize =",timeRangeSize);
          timeRangeMsArray = Array(timeRangeSize).fill(0);
          xRangeArray = new Array();

          makeXrangeArray(timeStartMs, timeLastMs, timeRangeMsArray, xRangeArray);

          //console.log("timeRangeMsArray =",timeRangeMsArray);
          //console.log("xRangeArray =",xRangeArray);
          var prevRange = "";
          var duplicate = false;
          for (var n = 0; n < xRangeArray.length; n++) {
            if (prevRange == xRangeArray[n]) {
              duplicate = true;
              break;
            }
            prevRange = xRangeArray[n];
          }
          if (!duplicate)
            break;
        }

        var timeRangeCountArray = Array(timeRangeSize).fill(0);
        var timeRangeCountMax_ = [0];
        var timeRangeEndByteArray = Array(timeRangeSize).fill(0);

        parseTimes(d.searchLineArray
          , d.searchLineSize
          , timeRangeMsArray
          , timeRangeCountArray
          , timeRangeCountMax_
          , d.searchLineEndByteArray
          , timeRangeEndByteArray);
        var timeRangeCountMax = timeRangeCountMax_[0];

        console.log("timeRangeCountArray =", timeRangeCountArray);

        var yRangeArray = xRangeArray.map((v, i) => {
          return 1;
        });

        console.log("yRangeArray =", yRangeArray);
        console.log("timeRangeCountMax = ", timeRangeCountMax);
        console.log("timeRangeCountArray = ", timeRangeCountArray);

        const xRangeSizeArray = xRangeArray.map((v, i) => {
          if (i % 2 == 0)
            return 0;
          else {
            return scaleSizeLog(timeRangeCountArray[parseInt(i / 2)], 0, timeRangeCountMax, 3, 70);
          }
        });

        console.log("xRangeSizeArray = ", xRangeSizeArray);

        const color = xRangeArray.map(v => 20);

        const x_ticktext = xRangeArray.map((v, i) => {
          if (i % 2 != 0)
            return "";
          else
            return v;
        });
        console.log("x_ticktext = ", x_ticktext);

        var ylineArray = new Array();
        xRangeArray.map((v, i) => {
          if (i % 2 == 0) {
            var shape = {
              type: 'line',
              x0: i, x1: i,   // x=2 위치
              y0: 0, y1: 1,   // paper 단위 (0=아래, 1=위)
              xref: 'x',
              yref: 'paper',
              line: { color: 'rgba(0, 217, 255, 0.3)', width: 1, dash: 'dot' }
            }
            ylineArray.push(shape);
          }
        });

        Plotly.update('chart'
          , {
            x: [xRangeArray]
            , y: [yRangeArray]
            , marker: {
              size: xRangeSizeArray,
              color: color,
              colorscale: [
                [0, 'rgb(0, 200, 255)'],
                [0.4, 'rgb(0, 255, 255)'],
                [0.7, 'rgb(179, 102, 255)'],
                [1, 'rgb(255, 0, 255)']
              ],
              showscale: false,
              line: {
                color: 'rgba(0, 255, 255, 0.8)',
                width: 2
              }
            },
          }
          , {
            xaxis: {
              tickvals: xRangeArray
              , ticktext: x_ticktext
              , showgrid: true
              , gridcolor: 'rgba(0, 217, 255, 0.15)'
            }
            , shapes: ylineArray
            , plot_bgcolor: 'rgba(0, 0, 0, 0.5)'
          }
          , [0]);

        timeRangeObj.timeRangeCountArray = timeRangeCountArray;
        timeRangeObj.xRangeArray = xRangeArray;
        timeRangeObj.xRangeSizeArray = xRangeSizeArray;
        timeRangeObj.timeRangeEndByteArray = timeRangeEndByteArray;

        searchObj.searchLineStartByteArray = d.searchLineStartByteArray;
        searchObj.searchLineEndByteArray = d.searchLineEndByteArray;

        console.log("searchObj.searchLineStartByteArray = ", searchObj.searchLineStartByteArray);
        console.log("searchObj.searchLineEndByteArray = ", searchObj.searchLineEndByteArray);
        console.log("timeRangeObj.timeRangeEndByteArray = ", timeRangeObj.timeRangeEndByteArray);
      }
    } else if (d.type === "error") {
      console.error(d.message);
      const statusText = document.querySelector('#status .status-text');
      if (statusText) {
        statusText.textContent = "ERROR: " + d.message;
      }
    }
  };
}

function makeXrangeArray(timeStartMs, timeLastMs, timeRangeMsArray, xRangeArray) {

  let arr = Array.from({ length: timeRangeSize }, (_, i) => parseInt((timeLastMs - timeStartMs) / timeRangeSize * (i + 1)));
  arr[timeRangeSize - 1] = timeLastMs;

  for (let i = 0; i < arr.length; i++) {
    timeRangeMsArray[i] = arr[i];
  }

  const x_mid = timeRangeMsArray.map((v, i) => {
    var time1Ms = i == 0 ? timeStartMs : timeRangeMsArray[i - 1];
    var time2Ms = timeRangeMsArray[i];

    var mid = parseInt((time1Ms + time2Ms) / 2);
    return mid;
  });

  xRangeArray.push(msToHHmmssms(timeStartMs));
  for (var i = 0; i < timeRangeMsArray.length; i++) {
    xRangeArray.push(msToHHmmssms(x_mid[i]));
    xRangeArray.push(msToHHmmssms(timeRangeMsArray[i]));
  }
}

function hhmmssmsToMs(hhmmssms) {
  const str = String(hhmmssms).padStart(9, '0'); // 항상 9자리 확보
  const hours = parseInt(str.slice(0, 2), 10);
  const minutes = parseInt(str.slice(2, 4), 10);
  const seconds = parseInt(str.slice(4, 6), 10);
  const ms = parseInt(str.slice(6, 9), 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000 + ms;
}

function msToHHmmssms(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours + ":" + minutes + ":" + seconds;
}

function parseTimes(searchLineArray
  , timeArrayLength
  , timeRangeMsArray
  , timeRangeCountArray
  , timeRangeCountMax
  , searchLineEndByteArray
  , timeRangeEndByteArray) {

  if (timeArrayLength == 0)
    return;

  var timeRangeIndex = 0;
  var timeRangeCount = 0;

  var curEndByte;
  var prevEndByte;

  for (let i = 0; i < timeArrayLength; i++) {

    var timeMs = hhmmssmsToMs(searchLineArray[i]);
    var timeRangeMs = timeRangeMsArray[timeRangeIndex];

    curEndByte = searchLineEndByteArray[i];
    prevEndByte = i == 0 ? searchLineEndByteArray[i] :  searchLineEndByteArray[i-1];

    /*
    if(i >= 0 && i < 100) {
      console.log("timeMs=",timeMs);
      console.log("timeRangeMs=",timeRangeMs);
      console.log("timeRangeCount=",timeRangeCount);
    }*/

    // 어레이의 최대한계에 도달해서 값이 없는경우.
    if (i > searchLineArray.length) {
      setTimeRangeCountArray(timeRangeCountArray, timeRangeIndex, timeRangeCount, timeRangeCountMax, prevEndByte , timeRangeEndByteArray);
      console.log("searchLineArray need more arrays!!!!! searchLineArray.length = ", searchLineArray.length);
      return;
    }
    // 현재 구간의 시간보다 작으면
    else if (timeMs <= timeRangeMs) {
      timeRangeCount++;
    }
    // 현재 구간의 시간보다 크면
    else {
      console.log("timeMs=", timeMs);
      console.log("timeRangeMs=", timeRangeMs);

      // 이전 구간의 카운트 세팅
      setTimeRangeCountArray(timeRangeCountArray, timeRangeIndex, timeRangeCount, timeRangeCountMax, prevEndByte , timeRangeEndByteArray);

      // 다음 구간 인덱스 설정
      for (let n = timeRangeIndex + 1; n < timeRangeMsArray.length; n++) {
        if (timeMs <= timeRangeMsArray[n]) {
          timeRangeIndex = n;
          break;
        }
      }
      timeRangeCount = 1;
    }
    // 남아있는거 처리~
    setTimeRangeCountArray(timeRangeCountArray,timeRangeIndex,timeRangeCount,timeRangeCountMax , curEndByte , timeRangeEndByteArray);
  }
  // 남아있는거 처리~
  //setTimeRangeCountArray(timeRangeCountArray, timeRangeIndex, timeRangeCount, timeRangeCountMax , curEndByte , timeRangeEndByteArray);

  console.log("timeRangeCountMax = ", timeRangeCountMax[0]);
}

function setTimeRangeCountArray(
  timeRangeCountArray
  , timeRangeIndex
  , timeRangeCount
  , timeRangeCountMax
  , searchLineEndByte
  , timeRangeEndByteArray) {

  timeRangeCountArray[timeRangeIndex] = timeRangeCount;
  if (timeRangeCount > timeRangeCountMax[0]) {
    timeRangeCountMax[0] = timeRangeCount;
  }
  timeRangeEndByteArray[timeRangeIndex] = searchLineEndByte;

}

function cleanupWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (blobUrlForWorker) {
    URL.revokeObjectURL(blobUrlForWorker);
    blobUrlForWorker = null;
  }
}

// --- 파일 스트리밍 → 워커로 chunk 전송 (Transferable로 복사 없이 이동) ---
async function startByFile(file, searchWord, startByte, endByte) {
  if (!worker) startWorker();

  prog.max = file.size;
  prog.value = 0;
  const statusText = document.querySelector('#status .status-text');
  if (statusText) {
    statusText.textContent = "🚀 처리 시작... 로그 분석 중";
  }
  statusEl.classList.add('processing');
  clearLogLines();
  addLogLine("[로그 스트리밍 시작...]");

  var _file = null;
  if (startByte == 0 && endByte == 0) {
    _file = file;
  } else {
    _file = file.slice(startByte, endByte);
  }

  var reader = _file.stream().getReader();
  worker.postMessage({ cmd: "start", searchWord: searchWord });
  for (; ;) {
    var r = await reader.read();
    if (r.done) break;
    var value = r.value; // Uint8Array
    // ArrayBuffer를 transfer list로 넘겨 복사 방지
    worker.postMessage({ cmd: "chunk", chunk: value.buffer }, [value.buffer]);
  }
  worker.postMessage({ cmd: "end" });
}

function doSearch() {
  var searchWord = searchWordEl.value;
  if (logfile == null)
    alert("파일을 선택해주세요.");
  else if (searchWord.length < 4)
    alert("4자이상 입력해주세요.");
  else {
    // 검색 버튼 깜빡임 제거
    var searchBtn = document.getElementById('btnSearch');
    if (searchBtn) {
      searchBtn.classList.remove('btn-blink');
    }
    startByFile(logfile, searchWord, 0, 0);
  }
}

// 차트에 사이즈로 사용하기 위해 로그 변환 후 범위로 매핑
function scaleSizeLog(v, minVal, maxVal, minSize, maxSize) {

  var size = 0;
  var power = 0.5;
  const powMin = Math.pow(minVal, power);
  const powMax = Math.pow(maxVal, power);

  size = v == 0 ? 0 : ((Math.pow(v, power) - powMin) / (powMax - powMin)) * (maxSize - minSize) + minSize;

  return parseInt(size);
}

//---------------
// --- 차트 -----
//---------------

function initChart() {

  // 프로페셔널 모니터링 차트
  const trace = {
    type: 'scatter',
    mode: 'markers',
    x: [1],
    y: [1],
    marker: {
      size: [],
      color: [],
      colorscale: [
        [0, 'rgb(0, 200, 255)'],
        [0.5, 'rgb(0, 255, 255)'],
        [1, 'rgb(179, 102, 255)']
      ],
      showscale: false,
      line: {
        color: 'rgba(0, 217, 255, 0.5)',
        width: 1
      },
      opacity: 0.85
    },
    name: '로그 데이터',
    hovertemplate: '<b>시간:</b> %{x}<br><b>로그 수:</b> %{marker.size}<extra></extra>'
  };

  // 프로페셔널 대시보드 레이아웃
  const layout = {
    title: {
      text: '시간대별 로그 분포',
      font: {
        family: 'SF Mono, Monaco, Consolas, monospace',
        size: 16,
        color: '#00ffff'
      }
    },
    paper_bgcolor: 'rgba(0, 0, 0, 0)',
    plot_bgcolor: 'rgba(0, 0, 0, 0.5)',
    dragmode: 'select',
    xaxis: {
      type: 'linear',
      autorange: true,
      rangemode: 'normal',
      showticklabels: true,
      zeroline: false,
      tickvals: [0, 1, 2],
      ticktext: ['', '01:00:00', '02:00:00'],
      showgrid: true,
      gridcolor: 'rgba(0, 217, 255, 0.15)',
      gridwidth: 1,
      tickfont: {
        family: 'SF Mono, Monaco, Consolas, monospace',
        color: '#00d9ff',
        size: 11
      }
    },
    yaxis: {
      type: 'linear',
      autorange: true,
      rangemode: 'normal',
      tickvals: [0, 1, 2],
      ticktext: ['', 'LOG EVENTS', ''],
      showgrid: true,
      gridcolor: 'rgba(0, 217, 255, 0.15)',
      gridwidth: 1,
      tickfont: {
        family: 'SF Mono, Monaco, Consolas, monospace',
        color: '#00d9ff',
        size: 11
      }
    },
    shapes: [{
      type: 'line',
      x0: 1, x1: 1,
      y0: 0, y1: 1,
      xref: 'x',
      yref: 'paper',
      line: { 
        color: '#30363d', 
        width: 1, 
        dash: 'dot' 
      }
    }],
    margin: {
      l: 50,
      r: 50,
      t: 50,
      b: 70
    },
    hoverlabel: {
      bgcolor: '#161b22',
      bordercolor: '#58a6ff',
      font: {
        family: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: '#e6edf3',
        size: 12
      }
    }
  };

  const config = {
    displayModeBar: false,
    responsive: true
  };

  Plotly.newPlot(chartEl, [trace], layout, config).then(() => {
    window.addEventListener('resize', () => Plotly.Plots.resize(chartEl));

    chartEl.on('plotly_selected', (ev) => {
      if (!ev || !ev.points || !ev.points.length) return;
      showSearchList(ev);
    });
  });
}

// 1단계: 검색 리스트 - 모든 매칭 로그 ROW 표시
function showSearchList(ev) {
  var title = '검색  >  ' + searchWordEl.value;

  var items = new Array();
  var content = "";

  var _selectTimeRangeStartIndex = -1;
  var _selectTimeRangeEndIndex = -1;

  ev.points.forEach(pt => {
    console.log("pt = ", pt);
    const size = timeRangeObj.xRangeSizeArray[pt.pointIndex];
    if (size > 0) {
      if(_selectTimeRangeStartIndex == -1) {
        _selectTimeRangeStartIndex = pt.pointIndex;
      } 
      _selectTimeRangeEndIndex = pt.pointIndex;

      const start = timeRangeObj.xRangeArray[pt.pointIndex - 1];
      const end = timeRangeObj.xRangeArray[pt.pointIndex + 1];
      
      var item = {
        range: start + " - " + end
        , file: "file" + pt.y
        , count: timeRangeObj.timeRangeCountArray[parseInt(pt.pointIndex / 2)]
      };
      items.push(item);

      // 1,3,5  >>>  0,1,2
      selectTimeRangeStartIndex = parseInt(_selectTimeRangeStartIndex/2);
      selectTimeRangeEndIndex = parseInt(_selectTimeRangeEndIndex/2);
    }
  });

  if (items.length > 0) {
    // 시작 시간과 끝 시간 추출
    const startTime = items[0].range.split(' - ')[0];
    const endTime = items[items.length - 1].range.split(' - ')[1];
    const timeRangeTitle = `${startTime} ~ ${endTime}`;
    
    // 로딩 모달 표시
    const loadingModal = new Modal({
      title: '로그 로딩 중...',
      size: 'sm',
      closeOnEsc: false,
      closeOnOverlay: false
    });
    
    const loadingContainer = document.createElement('div');
    loadingContainer.innerHTML = `
      <div style="text-align: center; padding: 20px;">
        <div class="jarvis-loader" style="margin: 0 auto 20px; width: 50px; height: 50px; border: 3px solid #00d9ff; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <div style="color: #00d9ff;">로그를 불러오는 중...</div>
      </div>
    `;
    loadingModal.setContent(loadingContainer);
    loadingModal.open();
    
    // 페이지 로드 함수
    let currentPage = 1;
    let currentModal = null;
    let currentContainer = null;
    
    function loadPage(page) {
      const pageLoadingModal = new Modal({
        title: '로그 로딩 중...',
        size: 'sm',
        closeOnEsc: false,
        closeOnOverlay: false
      });
      
      const pageLoadingContainer = document.createElement('div');
      pageLoadingContainer.innerHTML = `
        <div style="text-align: center; padding: 20px;">
          <div class="jarvis-loader" style="margin: 0 auto 20px; width: 50px; height: 50px; border: 3px solid #00d9ff; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          <div style="color: #00d9ff;">페이지 ${page} 로딩 중...</div>
        </div>
      `;
      pageLoadingModal.setContent(pageLoadingContainer);
      pageLoadingModal.open();
      
      getLogsInTimeRange(selectTimeRangeStartIndex, selectTimeRangeEndIndex, page).then(logs => {
        pageLoadingModal.close();
        currentPage = page;
        
        const total = logs.total || logs.length;
        const totalPages = logs.totalPages || 1;
        const hasMore = logs.hasMore || false;
        
        const content = `
          <div style="display: flex; justify-content: center; align-items: center; flex-direction: column;">
          ${totalPages > 1 ? `<div style="margin-bottom: 15px; display: justify-content: flex-end; align-items: center; gap: 10px;">
            <button id="btnPrevPage" class="btn secondary" style="padding: 5px 8px; width: 250px; height: 40px" ${page === 1 ? 'disabled' : ''}>◀ 이전 페이지</button>
            <strong><span style="color: #00d9ff; font-size: 6px white-space: nowrap;  padding-left: 15px; padding-right: 15px;">${page} / ${totalPages}</span></strong>
            <button id="btnNextPage" class="btn secondary" style="padding: 5px 8px; width: 250px; height: 40px" ${!hasMore ? 'disabled' : ''}>다음 페이지 ▶</button>
          </div>` : ''}
          <div class="wrap" id="logRowList" style="max-height: 580px; overflow-y: auto;"></div>
        `;

        if (!currentModal) {
          currentModal = new Modal({
            title: title,
            size: 'lg',
            closeOnEsc: true,
            closeOnOverlay: true
          });
          currentContainer = document.createElement('div');
          currentModal.setContent(currentContainer);
          
          // 전역 변수에 저장 (상세정보에서 돌아올 때 사용)
          searchListModal = currentModal;
          
          // 구간건수 버튼 (한 번만 설정)
          currentModal.setHeader([
            {
              label: '구간건수', variant: 'ghost', onClick: m => {
                showRangeCountAnalysis(items);
              }
            }
          ]);
          
          currentModal.setFooter([
            {
              label: '닫기', variant: 'primary', onClick: m => {
                m.close();
                searchListModal = null;
              }
            }
          ]);
        }
        
        currentContainer.innerHTML = content;

        const logRowList = currentContainer.querySelector('#logRowList');
        const btnPrevPage = currentContainer.querySelector('#btnPrevPage');
        const btnNextPage = currentContainer.querySelector('#btnNextPage');
        
        // 페이지 네비게이션 이벤트
        btnPrevPage?.addEventListener('click', () => {
          loadPage(currentPage - 1);
        });
        
        btnNextPage?.addEventListener('click', () => {
          loadPage(currentPage + 1);
        });
      
        // 각 로그 ROW를 카드로 표시
        logs.forEach((log, idx) => {
          const card = document.createElement('div');
          card.className = 'card';
          card.style.position = 'relative';
          
          // 줄바꿈으로 분리
          const lines = log.text.split('\n');
          const isMultiline = lines.length > 3;
          const previewText = isMultiline ? lines.slice(0, 3).join('\n') : log.text;
          
          card.innerHTML = `
            <div class="cardinfo">
              <div style="position: absolute; top: 10px; right: 10px; z-index: 10;">
                <button class="btn-detail" data-index="${log.index}" style="padding: 5px 15px; background: #58a6ff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">상세보기</button>
              </div>
              <div class="row1" style="padding-right: 100px;">
                <div class="log-preview" style="font-family: monospace; font-size: 13px; color: #c9d1d9; white-space: pre-wrap; word-break: break-all;">${escapeHtml(previewText)}</div>
                ${isMultiline ? `
                  <div class="log-full" style="display: none; font-family: monospace; font-size: 13px; color: #c9d1d9; white-space: pre-wrap; word-break: break-all;">${escapeHtml(log.text)}</div>
                  <button class="btn-expand" style="margin-top: 10px; padding: 5px 15px; background: #238636; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">▼ 전체보기</button>
                  <button class="btn-collapse" style="display: none; margin-top: 10px; padding: 5px 15px; background: #238636; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">▲ 접기</button>
                ` : ''}
              </div>
            </div>
          `;
          
          // 상세보기 버튼 클릭 이벤트
          card.querySelector('.btn-detail').addEventListener('click', (e) => {
            e.stopPropagation();
            // 검색 리스트 모달을 닫되 DOM은 유지 (돌아올 때 사용)
            currentModal.close({ destroy: false });
            showDetailInfo(idx, logs, previewText);
          });
          
          // 전체보기/접기 버튼 이벤트
          if (isMultiline) {
            const btnExpand = card.querySelector('.btn-expand');
            const btnCollapse = card.querySelector('.btn-collapse');
            const logPreview = card.querySelector('.log-preview');
            const logFull = card.querySelector('.log-full');
            
            btnExpand.addEventListener('click', (e) => {
              e.stopPropagation();
              logPreview.style.display = 'none';
              logFull.style.display = 'block';
              btnExpand.style.display = 'none';
              btnCollapse.style.display = 'inline-block';
            });
            
            btnCollapse.addEventListener('click', (e) => {
              e.stopPropagation();
              logPreview.style.display = 'block';
              logFull.style.display = 'none';
              btnExpand.style.display = 'inline-block';
              btnCollapse.style.display = 'none';
            });
          }
          
          logRowList.appendChild(card);
        });
        
        // Modal DOM이 없으면 무조건 열기 (닫힌 후 재오픈 대응)
        if (!currentModal.modal || !currentModal.isOpen) {
          currentModal.open();
        }
        
        // 헤더에 시간 범위 추가/업데이트 (항상 실행)
        if (currentModal.modal) {
          const headerEl = currentModal.modal.querySelector('.mm-header');
          if (headerEl) {
            let timeRangeEl = headerEl.querySelector('.mm-time-range');
            if (!timeRangeEl) {
              timeRangeEl = document.createElement('div');
              timeRangeEl.className = 'mm-time-range';
              timeRangeEl.style.cssText = 'position: absolute; left: 50%; transform: translateX(-50%); color: #00d9ff; font-size: 14px; letter-spacing: 0.5px;';
              headerEl.appendChild(timeRangeEl);
            }
            timeRangeEl.textContent = timeRangeTitle;
          }
        }
      });
    }
    
    // 초기 페이지 로드
    loadingModal.close();
    loadPage(1);
  }
}

// 시간 범위 내의 로그 추출
async function getLogsInTimeRange(startIdx, endIdx, page = 1) {
  const logs = [];
  const startByte = startIdx === 0 ? 0 : timeRangeObj.timeRangeEndByteArray[startIdx - 1];
  const endByte = timeRangeObj.timeRangeEndByteArray[endIdx];
  
  const MAX_LOGS = 1000;
  let totalCount = 0;
  const skipCount = (page - 1) * MAX_LOGS;
  let skipped = 0;
  
  // 1단계: 범위 내 로그 인덱스만 먼저 수집 (빠른 필터링)
  const rangeIndices = [];
  for (let i = 0; i < searchObj.searchLineStartByteArray.length; i++) {
    const logStart = searchObj.searchLineStartByteArray[i];
    const logEnd = searchObj.searchLineEndByteArray[i];
    
    if (logStart >= startByte && logEnd <= endByte) {
      rangeIndices.push(i);
    }
  }
  
  totalCount = rangeIndices.length;
  
  // 2단계: 페이지에 필요한 로그만 읽기 (성능 최적화)
  const startIndex = skipCount;
  const endIndex = Math.min(startIndex + MAX_LOGS, totalCount);
  
  for (let idx = startIndex; idx < endIndex; idx++) {
    const i = rangeIndices[idx];
    const logStart = searchObj.searchLineStartByteArray[i];
    const logEnd = searchObj.searchLineEndByteArray[i];
    const logText = await readLogSegment(logStart, logEnd);
    
    logs.push({
      index: i,
      startByte: logStart,
      endByte: logEnd,
      text: logText,
      extraInfo: null
    });
  }
  
  console.log('DEBUG: totalCount =', totalCount, ', logs.length =', logs.length, ', page =', page);
  
  // 결과에 메타 정보 추가
  logs.total = totalCount;
  logs.page = page;
  logs.totalPages = Math.ceil(totalCount / MAX_LOGS);
  logs.hasMore = page < logs.totalPages;
  
  return logs;
}

// 라인정보+ 데이터 로드
async function loadExtraInfo(log) {
  if (!log.extraInfo && log.startByte > 50) {
    const beforeText = await readLogSegment(log.startByte - 50, log.startByte);
    const afterText = await readLogSegment(log.endByte, Math.min(log.endByte + 50, logfile.size));
    log.extraInfo = { before: beforeText, after: afterText };
  }
  return log.extraInfo;
}

// 로그 세그먼트 읽기
function readLogSegment(start, end) {
  return new Promise((resolve) => {
    const slice = logfile.slice(start, end);
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve(e.target.result);
    };
    reader.readAsText(slice);
  });
}

// HTML 이스케이프
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 구간건수 분석 팝업
function showRangeCountAnalysis(items) {
  const modal = new Modal({
    title: '구간건수 분석',
    size: 'md',
    closeOnEsc: true,
    closeOnOverlay: true
  });

  const container = document.createElement('div');
  container.innerHTML = '<div class="wrap" id="rangeList"></div>';
  modal.setContent(container);

  const rangeList = container.querySelector('#rangeList');
  const total = items.reduce((s, i) => s + i.count, 0);
  const max = Math.max(...items.map(i => i.count)) || 1;

  items.forEach((it, idx) => {
    const pct = Math.round((it.count / max) * 100);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="cardinfo">
        <div class="row1">
          <div class="range">${it.range}</div>
          <div class="count">
            <span>${it.count.toLocaleString()}</span>
          </div>
        </div>
        <div class="barwrap" aria-label="비율 막대">
          <div class="bar" style="width:${pct}%"></div>
        </div>
      </div>
    `;
    rangeList.appendChild(card);
  });

  modal.setFooter([
    {
      label: '닫기', variant: 'primary', onClick: m => {
        m.close();
      }
    }
  ]);
  
  modal.open();
}

// 검색 리스트 모달 전역 변수
let searchListModal = null;

// 2단계: 상세정보 - 선택된 로그 + 주변 로그 + 이전/다음 버튼
let detailModal = null;
let detailContainer = null;
let currentDetailIndex = 0;
let currentDetailLogs = [];
let currentPreviewText = [];

function showDetailInfo(logIndex, allLogs, preViewText) {
  currentDetailIndex = logIndex;
  currentDetailLogs = allLogs;
  currentPreviewText = preViewText;
  
  var title = '상세정보  >  ' + searchWordEl.value;
  
  // 모달이 없으면 생성
  if (!detailModal) {
    detailModal = new Modal({
      title: title,
      size: 'lg',
      closeOnEsc: true,
      closeOnOverlay: true
    });
    
    detailContainer = document.createElement('div');
    detailModal.setContent(detailContainer);
    
    // AI 분석 버튼
    detailModal.setHeader([
      {
        label: 'AI 분석', 
        variant: 'ghost', 
        onClick: m => {
          const logContent = detailContainer.querySelector('#logContent');
          if (logContent) {
            showAIAnalysisModal(logContent.textContent);
          }
        }
      }
    ]);

    detailModal.setFooter([
      {
        label: '닫기', variant: 'primary', onClick: m => {
          m.close();
          detailModal = null;
          detailContainer = null;
          
          // 검색 리스트 모달로 돌아가기
          if (searchListModal) {
            searchListModal.open();
          }
        }
      }
    ]);
    
    detailModal.open();
  }
  
  // 내용 업데이트
  updateDetailContent();
}

function updateDetailContent() {
  const logIndex = currentDetailIndex;
  const allLogs = currentDetailLogs;
  const currentLog = allLogs[logIndex];
  const startByte = Math.max(0, currentLog.startByte - 10240); // 앞 10KB
  const endByte = Math.min(logfile.size, currentLog.endByte + 10240); // 뒤 10KB
  const prieviwText = currentPreviewText;
  
  // readLogSegment 함수를 사용하여 로그 주변 텍스트를 비동기적으로 읽어옵니다.
  readLogSegment(startByte, endByte).then(surroundingText => {
    // surroundingText 변수에 파일에서 읽어온 로그 텍스트가 담겨 있습니다.
    
    // 1. previewText를 정규식 패턴으로 변환
    const escapedPreviewText = escapeRegex(prieviwText);
    const regex = new RegExp(escapedPreviewText, 'g');
    
    // 2. 하이라이트된 부분에 ID를 부여하고, 그 부분을 저장합니다.
    let firstMatchId = null;
    let highlightedText = escapeHtml(surroundingText).replace(regex, (match) => {
        const id = `highlight-1`; // 첫 번째 매치된 부분에만 고정 ID 부여
        if (firstMatchId === null) {
            firstMatchId = id;
            return `<span id="${id}" style="background-color: #ffffff; color: #9b0000; font-weight: bold; padding: 2px 4px;">${match}</span>`;
        }
        return `<span style="background-color: #ffffff; color: #9b0000; font-weight: bold; padding: 2px 4px;">${match}</span>`;
    });
    
    // 3. 로그 내용과 UI를 결합
    const content = `
      <div style="margin-bottom: 15px; display: flex; justify-content: center; align-items: center; gap: 15px;">
        <button id="btnPrev" class="btn secondary" style="padding: 5px;" ${logIndex === 0 ? 'disabled' : ''}>◀ 이전</button>
        <div style="color: #00d9ff; font-size: 16px; font-weight: bold; white-space: nowrap;">
          ${logIndex + 1} / ${allLogs.length}
        </div>
        <button id="btnNext" class="btn secondary" style="padding: 5px;" ${logIndex === allLogs.length - 1 ? 'disabled' : ''}>다음 ▶</button>
      </div>
      <div id="logContent" style="background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 15px; max-height: 500px; overflow-y: auto; font-family: monospace; font-size: 13px; color: #c9d1d9; white-space: pre-wrap; word-break: break-all; line-height: 1.5;">
        ${highlightedText}
      </div>
    `;
    
    detailContainer.innerHTML = content;
    
    // 4. DOM 업데이트가 완료된 후 스크롤 이동
    if (firstMatchId) {
      requestAnimationFrame(() => {
        const highlightedEl = document.getElementById(firstMatchId);
        if (highlightedEl) {
          highlightedEl.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }
      });
    }
    
    // 이전/다음 버튼 이벤트
    const btnPrev = detailContainer.querySelector('#btnPrev');
    const btnNext = detailContainer.querySelector('#btnNext');
    
    btnPrev?.addEventListener('click', () => {
      currentDetailIndex = logIndex - 1;
      updateDetailContent();
    });
    
    btnNext?.addEventListener('click', () => {
      currentDetailIndex = logIndex + 1;
      updateDetailContent();
    });
  });
}

// 정규식 이스케이프
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 3단계: AI 분석 모달
function showAIAnalysisModal(logText) {
  const content = `
    <div class="ai-settings" style="margin-bottom: 20px;">
      <div class="ai-setting-group" style="margin-bottom: 15px;">
        <label for="aiModel" style="display: block; margin-bottom: 8px; color: #00d9ff;">AI MODEL</label>
        <select id="aiModel" class="ai-select" style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9;">
          <option value="llama" selected>라마70B</option>
          <option value="llama8b">라마8b</option>
          <option value="qwen">큐원코드</option>
        </select>
      </div>
      <div class="ai-setting-group">
        <label for="aiLength" style="display: block; margin-bottom: 8px; color: #00d9ff;">응답길이</label>
        <input type="number" id="aiLength" class="ai-input" min="256" max="8192" value="4096" style="width: 100%; padding: 8px; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #c9d1d9;">
      </div>
    </div>
  `;
  
  const modal = new Modal({
    title: 'AI 분석 설정',
    size: 'md',
    closeOnEsc: true,
    closeOnOverlay: true
  });

  const container = document.createElement('div');
  container.innerHTML = content;
  modal.setContent(container);

  modal.setFooter([
    {
      label: '분석 실행', 
      variant: 'primary', 
      onClick: m => {
        const aiModel = container.querySelector('#aiModel').value;
        const aiLength = parseInt(container.querySelector('#aiLength').value);
        m.close();
        doDetailAIAnalyze(logText, aiModel, aiLength);
        //callLlmApi(logText, aiModel, aiLength);
        console.log("logText :: " + logText + ",aiModel:: " + aiModel + " ,aiLength:: " +aiLength);
      }
    },
    {
      label: '취소', 
      variant: 'ghost', 
      onClick: m => {
        m.close();
      }
    }
  ]);
  
  modal.open();
}

// AI 분석 실행
async function doDetailAIAnalyze(logText, aiModel, aiLength) {
  // Jarvis 스타일 로딩 모달
  const loadingModal = new Modal({
    title: 'AI 분석 중...',
    size: 'sm',
    closeOnEsc: false,
    closeOnOverlay: false
  });

  const loadingContainer = document.createElement('div');
  loadingContainer.innerHTML = `
    <div style="text-align: center; padding: 30px;">
      <div class="jarvis-loader"></div>
      <p style="margin-top: 20px; color: #00d9ff;">분석 중입니다...</p>
    </div>
  `;
  loadingModal.setContent(loadingContainer);
  loadingModal.open();

  try {
    const response = await fetch('http://10.10.22.81:8080/vllm_chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: aiModel,
        text: `다음 로그를 심도있게 분석해주고 답변은 한글로 해줘 만약 로그에 Exception 있는 경우 Exception을 중심을 아주 자세하게 분석해줘 해결 방법까지 안내해줘 :\n\n${logText}`,
        limit: aiLength
      })
    });

    const result = await response.json();
    console.log("Response Data:", result);
    loadingModal.close();

    // 결과 모달
    const resultModal = new Modal({
      title: 'AI 분석 결과',
      size: 'lg',
      closeOnEsc: true,
      closeOnOverlay: true
    });

    let resultContent;
    if (typeof result.content === 'string') {
      resultContent = escapeHtml(result.content || '분석 결과가 없습니다.');
    } else {
      resultContent = '분석 결과가 없습니다.';
    }

    const resultContainer = document.createElement('div');
    resultContainer.innerHTML = `
      <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 20px; max-height: 500px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; color: #c9d1d9;">
        ${resultContent}
      </div>
    `;
    resultModal.setContent(resultContainer);

    resultModal.setFooter([
      {
        label: '닫기', 
        variant: 'primary', 
        onClick: m => {
          m.close();
        }
      }
    ]);

    resultModal.open();
  } catch (error) {
    loadingModal.close();
    
    const errorModal = new Modal({
      title: 'AI 분석 오류',
      size: 'md',
      closeOnEsc: true,
      closeOnOverlay: true
    });

    const errorContainer = document.createElement('div');
    errorContainer.innerHTML = `
      <div style="background: #0d1117; border: 1px solid #ff0000; border-radius: 6px; padding: 20px; color: #ff6b6b;">
        AI 분석 중 오류가 발생했습니다.<br><br>
        ${escapeHtml(error.message)}
      </div>
    `;
    errorModal.setContent(errorContainer);

    errorModal.setFooter([
      {
        label: '닫기', 
        variant: 'primary', 
        onClick: m => {
          m.close();
        }
      }
    ]);

    errorModal.open();
  }
}

// 기존 showDetailModal (삭제 예정, 호환성 유지)
function showDetailModal_OLD() {
  var title = '검색  >  ' + searchWordEl.value;
  
  // AI 설정 + 로그 컨텐츠를 함께 구성
  const content = `
    <div class="ai-settings">
      <div class="ai-setting-group">
        <label for="aiModel">AI MODEL</label>
        <select id="aiModel" class="ai-select">
          <option value="llama" selected>라마70B</option>
          <option value="llama8b">라마8b</option>
          <option value="qwen">큐원코드</option>
        </select>
      </div>
      <div class="ai-setting-group">
        <label for="aiLength">응답길이</label>
        <input type="number" id="aiLength" class="ai-input" min="256" max="8192" value="4096">
      </div>
    </div>
    <div class="wrap" id="list"></div>
  `;
  
  const modal = new Modal({
    title: title
    , size: 'lg'
    , closeOnEsc: true
    , closeOnOverlay: true
  });

  const container = document.createElement('div');
  container.innerHTML = content;
  modal.setContent(container);

  modal.setHeader([
    {
      label: 'AI 분석', 
      variant: 'ghost', 
      onClick: m => {
        doAIAnalyzeFromModal(modal);
      }
    }
  ]);

  modal.setFooter([
    {
      label: '닫기', variant: 'primary', onClick: m => {
        m.close();
      }
    }
  ]);
  modal.open();

  // 데이타 조회. 구간별로~ 일단 하나만 가져와보자.
  var searchWord = searchWordEl.value;
  console.log("searchObj.searchLineStartByteArray.length = ", searchObj.searchLineStartByteArray.length);

  console.log("selectTimeRangeStartIndex = ", selectTimeRangeStartIndex);
  console.log("selectTimeRangeEndIndex = ", selectTimeRangeEndIndex);

  var startTimeRangeStartByte = selectTimeRangeStartIndex == 0 ? 0 : timeRangeObj.timeRangeEndByteArray[selectTimeRangeStartIndex-1]+1;
  var endTimeRangeEndByte = timeRangeObj.timeRangeEndByteArray[selectTimeRangeEndIndex];

  console.log("startTimeRangeStartByte = ", startTimeRangeStartByte);
  console.log("endTimeRangeEndByte = ", endTimeRangeEndByte);

  var count = 0; 
  for (var i = 0; i < searchObj.searchLineStartByteArray.length; i++) {
    var startByte = searchObj.searchLineStartByteArray[i];
    var endByte = searchObj.searchLineEndByteArray[i];
    if (endByte == 0) {
      break;
    }

    if(startByte >= startTimeRangeStartByte && startByte <= endTimeRangeEndByte){
      getLine(container, startByte, endByte);
      count++;

      // 천라인까지만
      if (count > 1000)
        break;
    }

  }
}

async function getLine(container, startByte, endByte) {
  const reader = logfile.slice(startByte, endByte).stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode(); // flush
  var replaceSearch = '<span class="textred">'+ searchWordEl.value +'</span>';
  text = text.replaceAll(searchWordEl.value,replaceSearch);
  
  const list = container.querySelector('#list');
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
        <div class="cardinfo">
                <div class="row1">
                        <div class="range wordwrap">${text}</div>
                </div>
        </div>
  <div class="actions">
    <button type="button">AI분석</button>
        <button type="button">주변로그보기</button>
  </div>
        `;
  list.appendChild(card);
}

// 차트 선택 해제
function chartDragClear() {

  // 2번 호출해야 완전 해제된다.
  for (var n = 0; n <= 1; n++) {
    setTimeout(() => {
      // 선택 표시 해제
      Plotly.restyle(chartEl, { selectedpoints: [null] });
      // selections 레이아웃도 초기화
      Plotly.relayout(chartEl, { selections: [] });
    }, 0);
  }
}

// AI 분석 (모달에서 호출)
async function doAIAnalyzeFromModal(parentModal) {
  const aiModel = document.getElementById('aiModel')?.value || 'llama';
  const aiLength = parseInt(document.getElementById('aiLength')?.value || '4096');
  
  // 모든 range wordwrap 요소에서 텍스트 추출
  const rangeElements = parentModal.body.querySelectorAll('.range.wordwrap');
  if (rangeElements.length === 0) {
    alert('분석할 로그 데이터가 없습니다.');
    return;
  }
  
  let promptText = '';
  rangeElements.forEach(el => {
    promptText += el.textContent + '\n';
  });
  
  if (!promptText.trim()) {
    alert('분석할 내용이 비어있습니다.');
    return;
  }
  
  // AI 결과 팝업 생성
  const resultModal = new Modal({
    title: '◆ AI 로그 분석 결과',
    size: 'lg',
    closeOnEsc: true,
    closeOnOverlay: true
  });
  
  // 로딩 화면
  const loadingHtml = `
    <div class="jarvis-loading">
      <div class="jarvis-scanner"></div>
      <div class="jarvis-data-stream"></div>
      <div class="jarvis-rings">
        <div class="ring"></div>
        <div class="ring"></div>
        <div class="ring"></div>
      </div>
      <div class="jarvis-text">AI 분석 중...</div>
    </div>
  `;
  
  const resultContainer = document.createElement('div');
  resultContainer.innerHTML = loadingHtml;
  resultModal.setContent(resultContainer);
  
  resultModal.setFooter([
    {
      label: '닫기',
      variant: 'primary',
      onClick: m => m.close()
    }
  ]);
  
  resultModal.open();
  
  // API 호출
  try {
    const response = await callLlmApi(promptText, aiModel, aiLength);
    
    // 결과 표시
    resultContainer.innerHTML = `
      <div class="ai-result-content">${response}</div>
    `;
  } catch (error) {
    resultContainer.innerHTML = `
      <div class="ai-result-content" style="color: #ff6464;">
        ❌ AI 분석 실패
        
        ${error}
      </div>
    `;
  }
}

// AI API 호출 함수
async function callLlmApi(text, model, limit) {
  const apiUrl = 'http://10.10.22.81:8080/vllm_chat';
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        model: model,
        limit: limit
      })
    });
    
    if (!response.ok) {
      throw new Error(`API 오류: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.content || '응답 내용이 없습니다.';
  } catch (error) {
    throw `네트워크 오류: ${error.message}\n\nAPI URL: ${apiUrl}\n모델: ${model}\n응답길이: ${limit}`;
  }
}

// AI 분석 (기본 - ANALYSIS OPTIONS 패널에서 호출)
function doAIAnalyze() {
  if (logfile == null) {
    alert("파일을 먼저 선택해주세요.");
  } else {
    alert("먼저 로그를 검색하고 차트에서 시간대를 드래그한 후\n'상세정보' 팝업에서 AI 분석 기능을 사용할 수 있습니다.");
  }
}

// 파일 분할 기능
function doSplit() {
  if (logfile == null) {
    alert("파일을 먼저 선택해주세요.");
    return;
  }

  const fileSizeMB = (logfile.size / (1024 * 1024)).toFixed(2);
  
  const modal = new Modal({
    title: '▣ FILE SPLITTER - 파일 분할',
    size: 'md',
    closeOnEsc: true,
    closeOnOverlay: true
  });

  const container = document.createElement('div');
  container.innerHTML = `
    <div style="padding: 20px; font-family: 'SF Mono', Monaco, monospace; color: #00ffff;">
      <div style="margin-bottom: 20px;">
        <div style="color: #00d9ff; margin-bottom: 8px;">▸ 파일 정보</div>
        <div style="background: rgba(0, 255, 255, 0.1); padding: 12px; border: 1px solid rgba(0, 255, 255, 0.3); border-radius: 4px;">
          <div>파일명: <span style="color: #ff69b4;">${logfile.name}</span></div>
          <div>용량: <span style="color: #ff69b4;">${fileSizeMB} MB</span></div>
        </div>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="color: #00d9ff; display: block; margin-bottom: 8px;">▸ 분할 단위 (MB)</label>
        <input 
          type="number" 
          id="splitSizeMB" 
          value="100" 
          min="1" 
          max="2000"
          style="width: 100%; padding: 10px; background: rgba(0, 0, 0, 0.5); border: 1px solid #00ffff; color: #00ffff; font-family: 'SF Mono', Monaco, monospace; font-size: 16px; border-radius: 4px;"
        />
        <div style="color: #888; font-size: 12px; margin-top: 4px;">* 1MB ~ 2000MB 사이 값을 입력하세요</div>
      </div>

      <div id="splitProgress" style="display: none; margin-top: 20px;">
        <div style="color: #00d9ff; margin-bottom: 8px;">▸ 분할 진행 중...</div>
        <div style="background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(0, 255, 255, 0.3); border-radius: 4px; padding: 15px; text-align: center;">
          <div class="split-animation" style="margin-bottom: 10px;">
            <div style="font-size: 48px; animation: pulse 1s infinite;">🚀</div>
          </div>
          <div id="splitStatus" style="color: #00ffff; margin-bottom: 8px;">준비 중...</div>
          <progress id="splitProgressBar" max="100" value="0" style="width: 100%; height: 20px;"></progress>
        </div>
      </div>
    </div>
  `;

  modal.setContent(container);
  modal.setFooter([
    {
      label: '분할 시작',
      variant: 'primary',
      onClick: async (m) => {
        const splitSizeMB = parseInt(document.getElementById('splitSizeMB').value);
        if (!splitSizeMB || splitSizeMB < 1 || splitSizeMB > 2000) {
          alert('1MB ~ 2000MB 사이의 값을 입력해주세요.');
          return;
        }
        
        // 시작 버튼 숨기기
        m.footer.style.display = 'none';
        
        // 진행 상태 표시
        document.getElementById('splitProgress').style.display = 'block';
        
        // 파일 분할 실행
        await splitFile(logfile, splitSizeMB);
        
        // 완료 후 모달 닫기
        setTimeout(() => {
          m.close();
        }, 1500);
      }
    },
    {
      label: '취소',
      variant: 'secondary',
      onClick: (m) => m.close()
    }
  ]);

  modal.open();
}

// 파일 분할 실행 함수
async function splitFile(file, chunkSizeMB) {
  const chunkSize = chunkSizeMB * 1024 * 1024; // MB to bytes
  const totalChunks = Math.ceil(file.size / chunkSize);
  
  const statusEl = document.getElementById('splitStatus');
  const progressBar = document.getElementById('splitProgressBar');
  progressBar.max = 100; // 퍼센트 기준
  
  // ZIP 파일 생성
  const zip = new JSZip();
  
  // 파일명 준비 (확장자 유지)
  const nameParts = file.name.split('.');
  const extension = nameParts.length > 1 ? '.' + nameParts.pop() : '';
  const baseName = nameParts.join('.');
  
  // 시간 측정 시작
  const startTime = Date.now();
  
  // 모든 분할 파일을 ZIP에 추가
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    
    const chunkName = `${baseName}_part${String(i + 1).padStart(3, '0')}${extension}`;
    
    // 진행률 계산
    const percent = Math.floor(((i + 1) / totalChunks) * 90); // ZIP 생성 단계를 위해 90%까지만
    progressBar.value = percent;
    
    // 예상 시간 계산
    const elapsed = Date.now() - startTime;
    const avgTimePerChunk = elapsed / (i + 1);
    const remainingChunks = totalChunks - (i + 1);
    const estimatedRemaining = avgTimePerChunk * remainingChunks;
    
    // 시간 포맷 (초/분)
    let timeStr = '';
    if (estimatedRemaining > 60000) {
      const mins = Math.ceil(estimatedRemaining / 60000);
      timeStr = `약 ${mins}분 남음`;
    } else if (estimatedRemaining > 1000) {
      const secs = Math.ceil(estimatedRemaining / 1000);
      timeStr = `약 ${secs}초 남음`;
    } else {
      timeStr = '거의 완료';
    }
    
    // 상태 업데이트
    statusEl.textContent = `압축 중... ${percent}% (${i + 1}/${totalChunks}) - ${timeStr}`;
    
    // ZIP에 파일 추가
    zip.file(chunkName, chunk);
    
    // UI 업데이트를 위한 짧은 딜레이
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // ZIP 파일 생성
  statusEl.textContent = 'ZIP 파일 생성 중... 95%';
  progressBar.value = 95;
  
  const zipBlob = await zip.generateAsync({ 
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  
  // ZIP 파일 다운로드
  statusEl.textContent = '다운로드 준비 중... 100%';
  progressBar.value = 100;
  
  const zipName = `${baseName}_split.zip`;
  await downloadBlob(zipBlob, zipName);
  
  statusEl.textContent = `✅ 완료! ${totalChunks}개 파일이 ZIP으로 압축되었습니다.`;
}

// Blob 다운로드 함수 (File System Access API 미지원 브라우저용)
function downloadBlob(blob, filename) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // URL 해제 (메모리 정리)
    setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve();
    }, 100);
  });
}

// ==================== 실시간 메모리 모니터링 ====================

class MemoryMonitor {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    
    this.ctx = this.canvas.getContext('2d');
    this.dataPoints = [];
    this.maxDataPoints = 60; // 60초 데이터
    this.colors = options.colors || {
      primary: 'rgba(0, 217, 255, 1)',
      secondary: 'rgba(138, 43, 226, 1)',
      gradient1: 'rgba(0, 217, 255, 0.5)',
      gradient2: 'rgba(0, 217, 255, 0)',
      grid: 'rgba(0, 217, 255, 0.2)'
    };
    
    this.initCanvas();
  }
  
  initCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }
  
  addDataPoint(value) {
    this.dataPoints.push(value);
    if (this.dataPoints.length > this.maxDataPoints) {
      this.dataPoints.shift();
    }
  }
  
  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    
    // 배경 클리어
    ctx.clearRect(0, 0, w, h);
    
    // 그리드 그리기
    ctx.strokeStyle = this.colors.grid;
    ctx.lineWidth = 0.5;
    
    // 수평 그리드
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    
    // 수직 그리드
    for (let i = 0; i <= 10; i++) {
      const x = (w / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    
    if (this.dataPoints.length < 2) return;
    
    // 그라디언트 영역 그리기
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, this.colors.gradient1);
    gradient.addColorStop(1, this.colors.gradient2);
    
    ctx.beginPath();
    ctx.moveTo(0, h);
    
    this.dataPoints.forEach((point, i) => {
      const x = (w / (this.maxDataPoints - 1)) * i;
      const y = h - (point / 100) * h;
      if (i === 0) {
        ctx.lineTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // 라인 그리기
    ctx.beginPath();
    ctx.strokeStyle = this.colors.primary;
    ctx.lineWidth = 2;
    ctx.shadowColor = this.colors.primary;
    ctx.shadowBlur = 10;
    
    this.dataPoints.forEach((point, i) => {
      const x = (w / (this.maxDataPoints - 1)) * i;
      const y = h - (point / 100) * h;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
    ctx.shadowBlur = 0;
    
    // 현재 포인트 강조
    if (this.dataPoints.length > 0) {
      const lastPoint = this.dataPoints[this.dataPoints.length - 1];
      const x = w;
      const y = h - (lastPoint / 100) * h;
      
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = this.colors.primary;
      ctx.fill();
      ctx.strokeStyle = this.colors.secondary;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

// 메모리 모니터 인스턴스
let heapMonitor;

// 메모리 모니터링 시작
function initMemoryMonitoring() {
  // Canvas 초기화
  heapMonitor = new MemoryMonitor('heapCanvas', {
    colors: {
      primary: 'rgba(0, 217, 255, 1)',
      secondary: 'rgba(138, 43, 226, 1)',
      gradient1: 'rgba(0, 217, 255, 0.4)',
      gradient2: 'rgba(0, 217, 255, 0)',
      grid: 'rgba(0, 217, 255, 0.15)'
    }
  });
  
  // 1초마다 메모리 정보 업데이트
  setInterval(updateMemoryInfo, 1000);
}

function updateMemoryInfo() {
  // Performance Memory API 지원 확인
  if (performance.memory) {
    const mem = performance.memory;
    const usedJSHeap = (mem.usedJSHeapSize / 1048576).toFixed(1); // MB
    const totalJSHeap = (mem.totalJSHeapSize / 1048576).toFixed(1);
    const limitJSHeap = (mem.jsHeapSizeLimit / 1048576).toFixed(1);
    const usagePercent = ((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100).toFixed(1);
    
    // Heap Memory 업데이트
    document.getElementById('heapUsed').textContent = `${usedJSHeap} MB`;
    document.getElementById('heapTotal').textContent = `${totalJSHeap} MB`;
    document.getElementById('heapLimit').textContent = `${limitJSHeap} MB`;
    
    const heapPercentEl = document.getElementById('heapPercent');
    heapPercentEl.textContent = `${usagePercent}%`;
    updatePercentColor(heapPercentEl, parseFloat(usagePercent));
    
    // 차트 업데이트
    if (heapMonitor) {
      heapMonitor.addDataPoint(parseFloat(usagePercent));
      heapMonitor.draw();
    }
  } else {
    // Performance Memory API 미지원 브라우저
    const heapStatusEl = document.getElementById('heapStatus');
    if (heapStatusEl) {
      heapStatusEl.textContent = 'NOT SUPPORTED';
    }
  }
}

function updatePercentColor(element, percent) {
  element.classList.remove('warning', 'danger');
  if (percent >= 80) {
    element.classList.add('danger');
  } else if (percent >= 60) {
    element.classList.add('warning');
  }
}

