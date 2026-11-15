# PDF.js 61 / pdf-lib 7 조사

## 확인된 사실과 미확인 항목

실제 OFP PDF는 제공되지 않았다. 따라서 실제 파일의 xref 체인, 페이지 트리, 객체 버전, 폰트와 수정 위치는 아직 확인하지 못했다. iPad Chrome에서의 동작도 검증 전이다. 아래 합성 재현은 같은 증상을 만드는 후보 원인이며 실제 파일의 원인을 확정하지 않는다.

## 파서 차이

pdf-lib 1.17.1의 `PDFDocument.computePages()`는 catalog의 `/Pages`에서 `/Kids`를 따라가며 `PDFPageLeaf`를 모은다. `getPageCount()`는 그 배열의 길이다. 따라서 7은 잘못된 `/Count 7`만 읽은 결과라고 단정할 수 없고, 선택한 루트에서 도달 가능한 leaf 배열이 7이라는 뜻이다. `/Count`를 61로 고치거나 검증을 지워서는 나머지 페이지를 복원할 수 없다.

`PDFParser.parseIndirectObject()`는 물리적 파일 순서대로 객체를 파싱하고 `context.assign(ref, object)`를 호출한다. `/ObjStm`은 `PDFObjectStreamParser.parseIntoContext()`에서 내부 객체를 모두 할당한다. 같은 번호/generation의 객체가 나중에 파싱되면 앞의 값이 덮인다. 반면 xref의 활성 엔트리와 `/Prev`로 연결된 업데이트에서는 물리적 순서상 마지막 객체가 반드시 활성 버전은 아니다. 이 버전의 pdf-lib는 xref 엔트리를 이용해 그 할당을 제한하지 않는다. PDF.js는 xref로 객체를 해석하므로 결과가 달라질 수 있다.

회귀 테스트는 61페이지의 활성 xref를 남긴 채, 비활성 객체 스트림에 같은 `/Pages` 참조의 과거 7페이지 버전을 넣고 `/Prev`를 가진 업데이트를 추가한다.

| 단계 | PDF.js | pdf-lib |
| --- | ---: | ---: |
| 합성 입력 | 61 | 7 |
| QPDF 정상화 후 | 61 | 61 |
| OFP 표시 추가 및 재열기 | 61 | 61 |

입력의 pdf-lib context에는 `/Page` 객체 61개가 남지만 선택된 트리에서는 7개만 도달한다. PDF.js 참조 54개가 pdf-lib 페이지 배열에서 빠지는 것을 실제 라이브러리로 재현한다. 실제 OFP가 다른 `/Root`, 잘못된 `/Kids`, 누락/중복 참조나 다른 업데이트 형태를 사용하는지는 파일 조사 전에는 알 수 없다.

로컬 진단에는 두 페이지 수, 페이지 참조 배열, 누락 참조, 모든 `/Pages`의 `/Kids`와 `/Count`, 전체 leaf 객체 수 및 구문 단서를 표시한다. `startxref`, `/Prev`, `/ObjStm` 문자열 개수는 스트림 내부나 북마크에서도 일치할 수 있으므로 유효 xref 체인 분석 결과로 취급하지 않는다. 원본 문장이나 PDF 바이트를 외부로 전송하지 않는다.

## 해결 방식 검토

| 방식 | 검토 결과 |
| --- | --- |
| pdf-lib 설정, `/Count` 수정, `copyPages` | 이미 7페이지로 읽힌 문서에서 복사하면 54페이지를 잃을 수 있다. `useObjectStreams:false`는 출력 옵션이므로 잘못 선택된 입력 객체를 고치지 못한다. 채택하지 않음. |
| pdf-lib parser 패치 | xref table/stream, `/Prev`, hybrid xref, free entry, generation, 객체 스트림 버전을 모두 처리해야 한다. 페이지 트리만 조립하면 폰트·이미지의 오래된 버전이 남을 위험이 있다. 실제 파일 없는 제한적 패치는 채택하지 않음. |
| QPDF WASM 전처리 + pdf-lib 표시 | 활성 객체를 해석하고 객체 스트림을 해제해 기존 편집 코드를 유지한다. 합성 61/7 문제에서 전 페이지 비교를 통과해 채택. 경고나 원본과의 차이가 있으면 차단. |
| MuPDF.js 편집 엔진 | 공식 WASM API는 브라우저 편집/저장을 지원한다. 그리기·북마크 재검증과 AGPL/상용 라이선스 검토가 필요하다. 이번에 통합/실기기 검증하지 않은 후속 후보. |

QPDF worker는 사이트에 포함된 `@neslinesli93/qpdf-wasm` 0.3.1 (QPDF 12.2.0)을 실행한다. 입력은 Worker 메시지와 WASM 메모리 파일시스템으로 전달하며 네트워크 요청에 넣지 않는다. `--object-streams=disable --stream-data=preserve`로 활성 구조를 다시 기록하고 종료 코드 0일 때만 검증한다. 코드 3(경고)도 차단한다. 페이지 선택/삭제, 이미지 리샘플링 또는 페이지의 이미지화를 요청하지 않는다. worker는 종료하여 메모리를 해제한다.

## 다운로드 조건

1. 정상화가 필요하면 원본과 정상화 결과의 모든 페이지를 동일 인덱스에서 대조한다. 페이지 수, CropBox/회전/UserUnit, 텍스트/좌표와 72dpi 렌더링이 같아야 한다.
2. 정상화 결과와 pdf-lib 페이지의 객체 번호/generation을 1:1 대조한다. 확인한 매핑만 Route, DISC, ETD/ETA, 북마크에 사용한다.
3. 표시를 기록하며 텍스트/선의 좌표와 좁은 허용 사각형을 수집한다. 회전/CropBox/표시 범위가 지원 범위를 벗어나면 중단한다.
4. 저장 후 PDF.js로 다시 열어 최초 원본과 최종 결과의 모든 페이지를 대조한다. 기존 텍스트/좌표가 보존되고 추가 텍스트가 예상 페이지/좌표에서 추출되어야 한다. 기존 픽셀은 허용 사각형 밖에서 정확히 같아야 한다. 사각형 안의 원본은 흰 여백이어야 하므로 기존 내용 위에 쓰는 것도 차단한다.
5. 최종 북마크 목적지를 논리 페이지 번호와 대조한다. 모두 통과한 뒤에만 Blob URL을 만들고 다운로드한다.

각 합성 페이지에 고유 문구를 넣어 순서 변경을 검출한다. 렌더링은 순차 처리하고 canvas는 매 페이지 비운다. 결과 PDF는 벡터/텍스트 문서이며 검사 이미지를 PDF에 넣지 않는다.

이 검사는 수학적인 문서 동등성 증명이나 모든 해상도 검증은 아니다. 72dpi에서 관측되지 않는 미세 차이, 비시각적 PDF 기능과 PDF.js 자체 오류까지 모두 보장하지 못한다. 폰트 렌더링 차이도 보수적으로 차단할 수 있다. 큰 페이지(300만 픽셀 초과), 기존 내용과 겹치는 표시, 회전된 표시 대상 페이지는 자동 수정하지 않는다. 실제 OFP와 iPad 수동 검증 전까지 PR을 draft로 둔다.

## 실제 파일 검증 대기

- 오류 원본으로 활성 `/Root`, `/Pages`, `/Kids`, xref, `/Prev`와 객체 스트림 버전을 확인한다. 익명화를 위해 재저장하면 구조가 바뀌어 증상이 사라질 수 있다.
- 원본/결과 61페이지 모두와 CFP/ATS, Checked/불일치 밑줄, DISC, ETD/ETA, 북마크 목적지, 파일명을 실제 기대값과 대조한다.
- iPad Chrome의 HTTPS 사이트에서 worker/WASM 로드, 메모리, 처리 시간, 다운로드와 결과 파일 열기를 확인한다.
- 실제 파일을 저장소나 PR에 커밋하지 않는다. 현재 실제 파일 검증 성공을 주장하지 않는다.

## Invalid cMap data

PDF.js의 CMap 파서는 일부 잘못된 매핑 항목에서 경고 후 파싱을 계속한다. 별도의 합성 내장 ToUnicode/CMap 손상 테스트로 경고와 복구 가능한 텍스트 추출을 확인했다. 외부 CMap/표준 글꼴 경로는 내장 손상 데이터를 고치지 않는다. 경고를 숨기지 않으며 필수 CFP/ATS 파싱 또는 전후 검증 실패 시 다운로드하지 않는다.

## 근거

- [pdf-lib PDFDocument v1.17.1](https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/api/PDFDocument.ts)
- [pdf-lib PDFParser](https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/core/parser/PDFParser.ts), [PDFObjectStreamParser](https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/core/parser/PDFObjectStreamParser.ts)
- [PDF.js XRef](https://github.com/mozilla/pdf.js/blob/v3.11.174/src/core/xref.js), [CMap parser](https://github.com/mozilla/pdf.js/blob/v3.11.174/src/core/cmap.js)
- [QPDF CLI와 종료 코드](https://qpdf.readthedocs.io/en/stable/cli.html), [WASM wrapper 및 빌드](https://github.com/neslinesli93/qpdf-wasm)
- [MuPDF.js 브라우저·편집·라이선스](https://mupdfjs.readthedocs.io/en/latest/faq/index.html)
