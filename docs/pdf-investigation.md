# PDF.js 61 / pdf-lib 7 조사

## 확인된 사실과 미확인 항목

2026-11-15에 사용자가 제공한 실제 OFP를 로컬에서 분석했다. PDF.js, Poppler, pypdf는 61페이지, pdf-lib 1.17.1은 7페이지를 읽었다. 활성 페이지 트리와 비활성 객체 스트림의 참조 충돌을 확인하고, 정상화/수정 후 61페이지 및 수정 위치를 검증했다. iPad Chrome 실기기 동작은 여전히 검증 전이다. 실제 문서, 노선/편명/날짜/연료/시각과 상세 보고서는 저장소에 포함하지 않는다.

## 실제 파일에서 확인한 원인과 결과

- 활성 catalog는 `2 0 R`, 페이지 루트는 `4 0 R`이며 `/Count 61`, `/Kids [5 0 R 6 0 R]`이다. 두 하위 트리는 각각 26, 35페이지다.
- xref는 바이트 오프셋 `3545287`, `3561312`의 두 섹션을 사용하고 최신 trailer의 `/Prev`는 `3545287`이다. 활성 xref에서 `3 0 R`은 오프셋 292의 outline dictionary, `6 0 R`은 오프셋 3388328의 페이지 하위 트리다.
- 하지만 파일의 비활성 `/ObjStm` `493 0 R`(오프셋 3499803)을 pdf-lib가 파싱하면서 `6 0 R`을 페이지 트리가 아닌 dictionary로 덮어쓴다. `/ObjStm` `495 0 R`(3502644)은 `3 0 R`도 오래된 `/Pages`로 덮어쓴다. `PDFContext.assign` 호출을 추적해 실제 대입 순서와 타입 변경을 확인했다. 활성 xref를 사용하는 pypdf/Poppler/PDF.js 결과와 다른 이유다.
- ATS 문장이 CFP 내부, 독립된 제출용 ATS, 뒤쪽 FlightInfo에 반복된다. 기존 코드는 마지막 매치를 골라 인덱스 58(59페이지)을 선택했다. 이 파일에서 올바른 독립 ATS는 9페이지이고, Header는 10페이지다. 이제 동일 편명의 독립 페이지를 우선하며, 후보가 모호하면 중단한다.
- 기존 9페이지에는 파란 Route FreeText 주석이 있었다. 해당 주석을 지우거나 변경하지 않고, 새 Route/Checked를 위쪽 여백에 9pt로 추가했다. 여백이 부족하거나 기존 픽셀과 겹치면 중단한다.
- pdf-lib의 문자열 전체 폭에는 커닝이 포함되지만 `drawText`의 `Tj` 출력은 글자별 advance를 사용한다. 실제 글자 폭이 검사 사각형보다 커지는 문제를 확인하고 줄바꿈, Checked 위치, 밑줄 및 검사 경계 모두 비커닝 폭으로 통일했다.

실제 원본 → 정상화: 61 → 61, 전 페이지 PDF.js 렌더링/텍스트/위치 비교 통과. 실제 원본 → 최종 결과: 61 → 61, 전 페이지 비교와 예상 수정 위치/북마크 검사 통과. 원본 SHA-256은 처리 전후 동일했다.

독립적인 Poppler로 원본과 결과의 61페이지를 각각 72dpi PNG로 렌더링해 비교했다. 변경된 페이지는 9·11뿐이고, 허용된 표시 영역 밖에서 변경된 픽셀은 0개였다. 기존 주석 4개의 종류/내용/사각형/플래그 및 appearance stream 해시도 pypdf로 대조해 모두 보존됨을 확인했다. 최종 9·11페이지 PNG를 직접 확인했다.

실제 비교는 일치하여 목적지 뒤 Checked를 추가했고, 11페이지에 DISC와 ETD/ETA를 추가했다. 북마크 10개의 목적지와 CFP 기반 파일명도 확인했다. 실제 불일치 문서는 없으므로 빨간 밑줄은 합성 테스트로 검증했다. 자동 회귀 테스트는 17개 모두 통과했다.

## 파서 차이

pdf-lib 1.17.1의 `PDFDocument.computePages()`는 catalog의 `/Pages`에서 `/Kids`를 따라가며 `PDFPageLeaf`를 모은다. `getPageCount()`는 그 배열의 길이다. 따라서 7은 잘못된 `/Count 7`만 읽은 결과라고 단정할 수 없고, 선택한 루트에서 도달 가능한 leaf 배열이 7이라는 뜻이다. `/Count`를 61로 고치거나 검증을 지워서는 나머지 페이지를 복원할 수 없다.

`PDFParser.parseIndirectObject()`는 물리적 파일 순서대로 객체를 파싱하고 `context.assign(ref, object)`를 호출한다. `/ObjStm`은 `PDFObjectStreamParser.parseIntoContext()`에서 내부 객체를 모두 할당한다. 같은 번호/generation의 객체가 나중에 파싱되면 앞의 값이 덮인다. 반면 xref의 활성 엔트리와 `/Prev`로 연결된 업데이트에서는 물리적 순서상 마지막 객체가 반드시 활성 버전은 아니다. 이 버전의 pdf-lib는 xref 엔트리를 이용해 그 할당을 제한하지 않는다. PDF.js는 xref로 객체를 해석하므로 결과가 달라질 수 있다.

회귀 테스트는 61페이지의 활성 xref를 남긴 채, 비활성 객체 스트림에 같은 `/Pages` 참조의 과거 7페이지 버전을 넣고 `/Prev`를 가진 업데이트를 추가한다.

| 단계 | PDF.js | pdf-lib |
| --- | ---: | ---: |
| 합성 입력 | 61 | 7 |
| QPDF 정상화 후 | 61 | 61 |
| OFP 표시 추가 및 재열기 | 61 | 61 |

합성 입력의 pdf-lib context에는 `/Page` 객체 61개가 남지만 선택된 트리에서는 7개만 도달한다. PDF.js 참조 54개가 pdf-lib 페이지 배열에서 빠지는 것을 실제 라이브러리로 재현한다. 실제 파일은 앞 절에서 설명한 참조 충돌을 사용한다. 다른 문서의 원인은 개별 조사해야 한다.

로컬 진단에는 두 페이지 수, 페이지 참조 배열, 누락 참조, 모든 `/Pages`의 `/Kids`와 `/Count`, 전체 leaf 객체 수 및 구문 단서를 표시한다. `startxref`, `/Prev`, `/ObjStm` 문자열 개수는 스트림 내부나 북마크에서도 일치할 수 있으므로 유효 xref 체인 분석 결과로 취급하지 않는다. 원본 문장이나 PDF 바이트를 외부로 전송하지 않는다.

## 해결 방식 검토

| 방식 | 검토 결과 |
| --- | --- |
| pdf-lib 설정, `/Count` 수정, `copyPages` | 이미 7페이지로 읽힌 문서에서 복사하면 54페이지를 잃을 수 있다. `useObjectStreams:false`는 출력 옵션이므로 잘못 선택된 입력 객체를 고치지 못한다. 채택하지 않음. |
| pdf-lib parser 패치 | xref table/stream, `/Prev`, hybrid xref, free entry, generation, 객체 스트림 버전을 모두 처리해야 한다. 페이지 트리만 조립하면 폰트·이미지의 오래된 버전이 남을 위험이 있다. 페이지 트리만 고치는 제한적 패치는 채택하지 않음. |
| QPDF WASM 전처리 + pdf-lib 표시 | 활성 객체를 해석하고 객체 스트림을 해제해 기존 편집 코드를 유지한다. 합성과 실제 61/7 문서에서 전 페이지 비교를 통과해 채택. 경고나 원본과의 차이가 있으면 차단. |
| MuPDF.js 편집 엔진 | 공식 WASM API는 브라우저 편집/저장을 지원한다. 그리기·북마크 재검증과 AGPL/상용 라이선스 검토가 필요하다. 이번에 통합/실기기 검증하지 않은 후속 후보. |

QPDF worker는 사이트에 포함된 `@neslinesli93/qpdf-wasm` 0.3.1 (QPDF 12.2.0)을 실행한다. 입력은 Worker 메시지와 WASM 메모리 파일시스템으로 전달하며 네트워크 요청에 넣지 않는다. `--object-streams=disable --stream-data=preserve`로 활성 구조를 다시 기록하고 종료 코드 0일 때만 검증한다. 코드 3(경고)도 차단한다. 페이지 선택/삭제, 이미지 리샘플링 또는 페이지의 이미지화를 요청하지 않는다. worker는 종료하여 메모리를 해제한다.

## 다운로드 조건

1. 정상화가 필요하면 원본과 정상화 결과의 모든 페이지를 동일 인덱스에서 대조한다. 페이지 수, CropBox/회전/UserUnit, 텍스트/좌표와 72dpi 렌더링이 같아야 한다.
2. 정상화 결과와 pdf-lib 페이지의 객체 번호/generation을 1:1 대조한다. 확인한 매핑만 Route, DISC, ETD/ETA, 북마크에 사용한다.
3. 표시를 기록하며 텍스트/선의 좌표와 좁은 허용 사각형을 수집한다. 회전/CropBox/표시 범위가 지원 범위를 벗어나면 중단한다.
4. 저장 후 PDF.js로 다시 열어 최초 원본과 최종 결과의 모든 페이지를 대조한다. 기존 텍스트/좌표가 보존되고 추가 텍스트가 예상 페이지/좌표에서 추출되어야 한다. 기존 픽셀은 허용 사각형 밖에서 정확히 같아야 한다. 사각형 안의 원본은 흰 여백이어야 하므로 기존 내용 위에 쓰는 것도 차단한다.
5. 최종 북마크 목적지를 논리 페이지 번호와 대조한다. 모두 통과한 뒤에만 Blob URL을 만들고 다운로드한다.

각 합성 페이지에 고유 문구를 넣어 순서 변경을 검출한다. 렌더링은 순차 처리하고 canvas는 매 페이지 비운다. 결과 PDF는 벡터/텍스트 문서이며 검사 이미지를 PDF에 넣지 않는다.

이 검사는 수학적인 문서 동등성 증명이나 모든 해상도 검증은 아니다. 72dpi에서 관측되지 않는 미세 차이, 비시각적 PDF 기능과 PDF.js 자체 오류까지 모두 보장하지 못한다. 폰트 렌더링 차이도 보수적으로 차단할 수 있다. 큰 페이지(300만 픽셀 초과), 기존 내용과 겹치는 표시, 회전된 표시 대상 페이지는 자동 수정하지 않는다. 실제 파일의 데스크톱 검증은 완료했지만 iPad 검증 전까지 PR을 draft로 둔다.

## 남은 실기기 검증

- iPad Chrome의 HTTPS 사이트에서 worker/WASM 로드, 메모리, 처리 시간, 다운로드와 결과 파일 열기를 확인해야 한다. 이 PC에서 실행한 실제 엔진 검증이 실기기 검증을 대체하지는 않는다.
- 다른 실제 OFP 형식, 불일치 Route와 큰/회전된 페이지는 추가 사례가 필요하다.
- 실제 파일, 상세 진단 JSON, 렌더링 PNG는 Git에서 제외한다. 민감한 원본은 외부 서비스에 전송하지 않는다.

## Invalid cMap data

PDF.js의 CMap 파서는 일부 잘못된 매핑 항목에서 경고 후 파싱을 계속한다. 합성 테스트에 이어 실제 원본에서도 `Invalid cMap data`를 확인했고, Poppler도 원본/결과 양쪽에서 `Illegal entry in bfchar block in ToUnicode CMap`을 보고했다. 원본의 폰트 매핑 문제이며 페이지 트리 손실과 별개다. 외부 CMap/표준 글꼴 경로로 내장 손상을 고친다고 가정하지 않는다. 실제 문서의 전후 텍스트/픽셀 비교는 통과했으며, 기존 폰트와 주석 appearance를 임의 변경하지 않았다. 경고를 숨기지 않으며 필수 CFP/ATS 파싱 또는 검증 실패 시 다운로드하지 않는다.

## 근거

- [pdf-lib PDFDocument v1.17.1](https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/api/PDFDocument.ts)
- [pdf-lib PDFParser](https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/core/parser/PDFParser.ts), [PDFObjectStreamParser](https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/core/parser/PDFObjectStreamParser.ts)
- [PDF.js XRef](https://github.com/mozilla/pdf.js/blob/v3.11.174/src/core/xref.js), [CMap parser](https://github.com/mozilla/pdf.js/blob/v3.11.174/src/core/cmap.js)
- [QPDF CLI와 종료 코드](https://qpdf.readthedocs.io/en/stable/cli.html), [WASM wrapper 및 빌드](https://github.com/neslinesli93/qpdf-wasm)
- [MuPDF.js 브라우저·편집·라이선스](https://mupdfjs.readthedocs.io/en/latest/faq/index.html)
