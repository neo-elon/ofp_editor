# ofp_editor

브라우저에서 OFP PDF를 읽고 CFP/ATS Route 비교, 목적지 뒤 `(Checked)`, 불일치 구간 빨간 밑줄, DISC, ETD/ETA, 북마크와 파일명을 적용합니다. PDF 데이터는 `File.arrayBuffer()`에서 메모리로 읽어 PDF.js와 pdf-lib에 전달하며 서버에 업로드하지 않습니다. 라이브러리, worker, CMap 및 표준 글꼴 파일만 CDN에서 다운로드합니다.

## 페이지 오류 수정

- 앱 내부 인덱스, PDF.js `getPageIndex()` 및 정수 북마크 목적지는 0부터 시작합니다. PDF.js `getPage()`를 호출할 때만 1을 더합니다. 정수 목적지 `0`도 유효하게 처리합니다.
- 기존 북마크의 목적지가 범위 밖이거나 해석되지 않으면 무시합니다. `FlightPlan` 목적지가 본문과 맞지 않거나 북마크가 없어도 모든 페이지에서 완전한 CFP를 검색합니다.
- PDF.js의 인덱스를 pdf-lib에 그대로 넘기지 않고 페이지의 PDF 객체 번호와 generation으로 매핑합니다. Route, DISC, ETD/ETA, 생성 북마크에 같은 매핑을 적용합니다.
- `index must be at least 0 and at most 6 but was actually 58`은 pdf-lib의 `getPage(58)`에 실제 페이지 배열이 7개일 때 발생하는 범위 오류입니다. 두 파서의 페이지 수/참조가 다르면 편집 및 다운로드 전에 구체적인 오류를 표시합니다. 페이지를 임의로 잘라내거나 다른 페이지로 강제 보정하지 않습니다. 이 경우 원본 생성 프로그램에서 PDF를 다시 내보내야 합니다.
- 실제 오류 PDF가 제공되지 않아 그 파일의 손상 유형과 수정 후 성공 여부는 확인하지 못했습니다. 파서가 서로 다른 페이지 구조를 인식하는 PDF 자체를 복구하는 기능은 포함하지 않습니다.

## Invalid cMap data

PDF.js 3.11.174의 CMap 파서는 잘못된 매핑 항목을 만나면 `Invalid cMap data`를 경고하고 파싱을 계속합니다. 페이지 인덱스 오류와 별개이며, 경고가 있어도 폰트 인코딩으로 텍스트를 복원할 수 있습니다. 버전에 맞는 외부 CMap/표준 글꼴 경로를 설정했지만, 이는 PDF 내부의 손상된 ToUnicode/CMap 데이터를 고치는 기능은 아닙니다. 경고는 숨기지 않으며 CFP 필수 필드/완전한 Route 또는 ATS 목적지를 읽을 수 없으면 다운로드하지 않습니다. 실제 파일의 글자별 정확성과 시각적 결과는 별도 확인이 필요합니다.

참고: [PDF.js CMap 파서](https://github.com/mozilla/pdf.js/blob/v3.11.174/src/core/cmap.js), [PDF.js 페이지 API](https://github.com/mozilla/pdf.js/blob/v3.11.174/src/display/api.js), [pdf-lib 페이지 API](https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/api/PDFDocument.ts).

## 자동 테스트

Node.js 22 이상에서 실행합니다.

```sh
npm ci --ignore-scripts --omit=optional
npm test
```

배포 HTML의 실제 코드를 최소 DOM 환경에서 실행하며, 브라우저와 동일한 버전의 PDF.js/pdf-lib로 테스트 PDF를 생성·처리·저장·다시 읽습니다. 잘못된 북마크 58을 가진 7페이지 PDF, 첫 페이지 CFP, 정수/이름/참조 목적지, 두 파서의 순서/개수 불일치, 마지막 페이지 ATS, Route 일치/불일치, Checked 위치/빨간 선 그리기, DISC/ETD/ETA, 북마크 목적지, 파일명, 손상된 내장 CMap의 복구 가능한 경우 및 중복 실행 차단을 검증합니다.

실제 운항 OFP PDF와 브라우저 화면에서의 시각적 검증은 수행하지 못했습니다. 테스트 PDF는 기본 글꼴을 사용하는 합성 문서로 실제 PDF의 모든 글꼴·페이지 트리 변형을 대변하지 않습니다.

의존성은 기존 브라우저 배포 버전에 맞춰 고정했습니다. PDF.js 3.x의 알려진 eval 관련 취약점 완화를 위해 `isEvalSupported: false`를 적용했습니다. `npm audit`의 구버전 경고 자체는 남으며, 최신 PDF.js로의 모듈/worker 전환은 별도의 호환성 검증이 필요합니다.
