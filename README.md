# OFP Editor

CFP/ATS Route 비교, 목적지 뒤 `(Checked)`, 불일치 구간 빨간 밑줄, DISC, ETD/ETA, 북마크와 파일명을 적용합니다. PDF는 브라우저 메모리에서만 처리합니다. 서버에 PDF나 진단 정보를 업로드하지 않습니다.

**제공된 실제 OFP PDF의 61페이지 보존과 수정 위치를 로컬에서 검증했습니다. iPad Chrome 실기기 검증은 미완료입니다.** 실제 파일에서도 비활성 객체 스트림이 pdf-lib의 활성 참조를 덮어쓰는 원인을 확인했습니다. PDF.js와 독립적인 Poppler로 원본/결과 61페이지를 대조했고, 변경은 허용한 9·11페이지의 표시 영역에만 있었습니다. 자세한 근거와 제한은 [조사 기록](docs/pdf-investigation.md)을 참고하세요.

## 실행

페이지 상단에 현재 버전과 최종 수정 날짜를 표시합니다. 버전은 `vYYYY.MM.DD.수정번호` 형식으로 관리하며, 배포할 때 `index.html`의 `release-info`에서 버전과 날짜를 함께 갱신합니다. 날짜는 한국 시간 기준이며 접속 날짜가 아닌 코드 수정 날짜입니다.

이 폴더 전체를 HTTPS 정적 호스팅으로 제공합니다. `index.html`만 복사하면 새 안전 검사와 WASM worker가 동작하지 않습니다. `pdf-safety.js`, `qpdf-worker.js`, `vendor/qpdf/`가 같은 경로에 있어야 합니다. `file://` 실행은 지원하지 않습니다. PDF.js/pdf-lib, CMap과 표준 글꼴은 CDN에서 읽으며, QPDF JS/WASM은 이 사이트에 함께 포함되어 있습니다.

PDF를 선택하면 기존 북마크와 실제 본문을 분석합니다. pdf-lib에서 페이지를 모두 읽을 수 없으면 같은 기기의 QPDF WASM worker에서 활성 객체 구조를 정상화합니다. 모든 원본 페이지와 정상화 결과를 대조한 뒤 기존 표시를 추가합니다. 저장 결과도 다시 열어 전 페이지와 표시 위치, 북마크 목적지를 확인한 뒤에만 다운로드합니다.

기상 책갈피는 **Weather Briefing → WindTemp / SIGWX / ASC(TURB) / Cross Chart** 구조입니다. 각 하위 항목은 해당 제목이 처음 나오는 차트로 연결되며, 파일에서 찾지 못한 차트는 추가하지 않습니다. 저장 후 목적지와 하위 항목 순서를 검증합니다.

**FlightPlan → 3% Contingency / EDTO / Refile** 하위 책갈피는 기본 CFP 구간에서 해당 제목이 처음 나오는 페이지로 연결됩니다. EDTO는 `EDTO EQUAL TIME POINT`, Refile은 `REFILE FLT PLAN` 문구가 들어간 줄을 기준으로 찾습니다. `3 PCT CONT`, `REFILE RES` 같은 연료 요약 행이나 뒤쪽 FlightInfo 사본으로 잘못 연결하지 않으며, 파일에 없는 항목은 추가하지 않습니다.

CFP 본문과 FlightInfo에도 ATS 문장이 반복될 수 있으므로, 편명·목적지가 맞는 후보 중 `COPY OF ATS FPL` 문구가 있는 제출용 페이지를 우선합니다. 출발지 정보가 있으면 CFP 출발지와 대조합니다. 제출용 문구가 없을 때만 기존 독립 페이지 판별을 사용하고, 후보를 하나로 정하지 못하면 후보 페이지 번호를 표시하고 수정하지 않습니다. Route 일치 여부로 ATS 후보를 선택하지 않으므로 불일치 검사가 유지됩니다. Route는 상단 여백에 최대 4줄로 배치하고, 필요하면 글자 크기와 줄 간격을 줄입니다. 기존 텍스트·FreeText 주석과 겹치지 않는 공간이 없으면 차단합니다. DISC 값은 `DISC FUEL DUE TO` 문구가 있는 줄 오른쪽에 표시합니다. 글자 폭은 실제 PDF 출력과 같은 비커닝 방식으로 계산합니다.

반복되는 불일치 토큰은 각 위치에 밑줄을 한 번만 그립니다. 글자 폭은 폰트·크기별로 재사용하고, 픽셀 검증은 수정 영역을 페이지별 마스크로 합쳐 반복 검색을 줄입니다. 검사 대상 픽셀이나 페이지를 생략하지 않습니다. `pdf-safety.js` 수정 시 HTML의 버전값도 LF 기준 SHA-256 앞 16자리로 갱신해야 하며, 자동 테스트가 이를 확인합니다.

같은 원본을 다시 대조할 때에는 문서별 텍스트 정보와 RGBA 픽셀의 SHA-256 지문을 재사용하여 원본 전체를 다시 렌더링하지 않습니다. 결과 페이지는 매번 렌더링하며, 표시를 추가한 페이지는 원본 픽셀과 직접 비교합니다. 지문이 다르거나 Web Crypto를 사용할 수 없으면 픽셀 직접 비교로 처리합니다. 캐시는 페이지 이미지 전체를 보관하지 않으며 원본 문서가 해제되면 함께 회수됩니다.

페이지 구조 차이, QPDF 경고, 페이지 누락/순서 변경, 기존 내용 변경, 표시 위치 불일치, 기존 내용과의 겹침, 지원하지 않는 표시 대상 페이지의 회전/CropBox, 렌더링 실패 또는 메모리 부족이 감지되면 다운로드하지 않습니다. 검사 때문에 파일 처리에 시간이 더 걸릴 수 있습니다. 구조 진단은 화면의 **PDF 페이지 구조 진단**에 표시됩니다.

## 홈 화면에 추가

배포한 페이지를 새로고침한 다음 브라우저 공유 메뉴의 **홈 화면에 추가**를 선택합니다. 아이콘과 이름은 **OFP Editor**로 표시되며, 지원되는 브라우저에서는 독립된 앱 화면으로 실행됩니다. 기존에 추가한 바로가기에 이전 이미지가 남으면 해당 바로가기를 삭제한 뒤 다시 추가합니다. iPad Chrome 실기기 설치는 별도 확인이 필요합니다.

`manifest.webmanifest`와 `icons/`도 함께 배포해야 합니다. 아이콘 원본은 `icons/ofp-editor.svg`이며 개발 환경에서 `npm run icons`로 PNG를 다시 생성합니다. 홈 화면 실행에도 PDF 라이브러리 다운로드를 위한 인터넷 연결이 필요합니다.

## 테스트

Node.js 22 이상에서 실행합니다. canvas의 플랫폼별 바이너리가 필요하므로 optional dependency를 포함합니다. 테스트용 PDF.js의 오래된 선택 의존성 canvas는 `@napi-rs/canvas`로 대체합니다.

```sh
npm ci --ignore-scripts --include=optional
npm test
```

테스트는 배포 HTML과 실제 PDF.js/pdf-lib/QPDF WASM으로 합성 PDF를 생성·처리·저장·재열기합니다. 61/7 재현, 전 페이지 비교, 기존 OFP 기능과 다운로드 차단을 검증합니다. 테스트용 canvas는 Node 환경에만 사용됩니다. 앱의 PDF를 이미지로 변환하여 저장하지는 않으며, 래스터는 메모리 안에서 검증에만 사용합니다.

실제 파일은 다음 명령으로 로컬에서 검사할 수 있습니다. 기본값은 분석만 하며 `--process`를 붙여야 검증을 통과한 결과를 `output/pdf/`에 씁니다. 기존 결과를 덮어쓰지 않습니다. `tmp/pdfs/`의 상세 진단과 결과 PDF는 Git에서 제외됩니다. `--debug`는 개발용 후보를 임시 폴더에 기록하므로 전달용 결과와 구분해야 합니다.

```sh
node scripts/verify-local-pdf.cjs "C:\path\input.pdf"
node scripts/verify-local-pdf.cjs "C:\path\input.pdf" --process
```

실제 운항 PDF는 저장소에 커밋하지 않습니다 (`*.pdf` 제외). 제공된 파일은 원본 해시 불변, 61페이지, CFP/ATS 일치, Checked, DISC/ETD/ETA, 북마크 10개와 파일명을 확인했습니다. 불일치 빨간 선은 합성 회귀 테스트에서 확인했습니다. iPad에서 실제 처리 시간/메모리/다운로드를 추가 확인해야 합니다.

PDF.js는 기존 브라우저 버전과 동일한 3.11.174로 고정하고 `isEvalSupported: false`를 적용했습니다. 구버전 관련 `npm audit` 경고는 남습니다. 최신 PDF.js 모듈/worker로의 전환은 별도 검증이 필요합니다.

This software is based in part on the work of the Independent JPEG Group. [QPDF 배포 및 라이선스 고지](vendor/qpdf/NOTICE.md).
