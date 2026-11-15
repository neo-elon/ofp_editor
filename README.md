# OFP Editor

CFP/ATS Route 비교, 목적지 뒤 `(Checked)`, 불일치 구간 빨간 밑줄, DISC, ETD/ETA, 북마크와 파일명을 적용합니다. PDF는 브라우저 메모리에서만 처리합니다. 서버에 PDF나 진단 정보를 업로드하지 않습니다.

**실제 오류 OFP PDF와 iPad Chrome 검증은 아직 미완료입니다.** 합성 PDF에서 PDF.js 61페이지 / pdf-lib 7페이지 차이를 재현하고 정상화 경로를 검증했습니다. 실제 파일 제공 전에는 동일 원인이나 해결 성공을 확정할 수 없습니다. 자세한 근거와 제한은 [조사 기록](docs/pdf-investigation.md)을 참고하세요.

## 실행

이 폴더 전체를 HTTPS 정적 호스팅으로 제공합니다. `index.html`만 복사하면 새 안전 검사와 WASM worker가 동작하지 않습니다. `pdf-safety.js`, `qpdf-worker.js`, `vendor/qpdf/`가 같은 경로에 있어야 합니다. `file://` 실행은 지원하지 않습니다. PDF.js/pdf-lib, CMap과 표준 글꼴은 CDN에서 읽으며, QPDF JS/WASM은 이 사이트에 함께 포함되어 있습니다.

PDF를 선택하면 기존 북마크와 실제 본문을 분석합니다. pdf-lib에서 페이지를 모두 읽을 수 없으면 같은 기기의 QPDF WASM worker에서 활성 객체 구조를 정상화합니다. 모든 원본 페이지와 정상화 결과를 대조한 뒤 기존 표시를 추가합니다. 저장 결과도 다시 열어 전 페이지와 표시 위치, 북마크 목적지를 확인한 뒤에만 다운로드합니다.

페이지 구조 차이, QPDF 경고, 페이지 누락/순서 변경, 기존 내용 변경, 표시 위치 불일치, 기존 내용과의 겹침, 지원하지 않는 표시 대상 페이지의 회전/CropBox, 렌더링 실패 또는 메모리 부족이 감지되면 다운로드하지 않습니다. 검사 때문에 파일 처리에 시간이 더 걸릴 수 있습니다. 구조 진단은 화면의 **PDF 페이지 구조 진단**에 표시됩니다.

## 테스트

Node.js 22 이상에서 실행합니다. canvas의 플랫폼별 바이너리가 필요하므로 optional dependency를 포함합니다. 테스트용 PDF.js의 오래된 선택 의존성 canvas는 `@napi-rs/canvas`로 대체합니다.

```sh
npm ci --ignore-scripts --include=optional
npm test
```

테스트는 배포 HTML과 실제 PDF.js/pdf-lib/QPDF WASM으로 합성 PDF를 생성·처리·저장·재열기합니다. 61/7 재현, 전 페이지 비교, 기존 OFP 기능과 다운로드 차단을 검증합니다. 테스트용 canvas는 Node 환경에만 사용됩니다. 앱의 PDF를 이미지로 변환하여 저장하지는 않으며, 래스터는 메모리 안에서 검증에만 사용합니다.

실제 운항 PDF는 저장소에 커밋하지 않습니다 (`*.pdf` 제외). 실제 검증에는 오류 PDF 및 기대 CFP/ATS 페이지, DISC·ETD/ETA 위치와 파일명 확인이 필요합니다. iPad에서 실제 처리 시간/메모리/다운로드도 확인해야 합니다.

PDF.js는 기존 브라우저 버전과 동일한 3.11.174로 고정하고 `isEvalSupported: false`를 적용했습니다. 구버전 관련 `npm audit` 경고는 남습니다. 최신 PDF.js 모듈/worker로의 전환은 별도 검증이 필요합니다.

This software is based in part on the work of the Independent JPEG Group. [QPDF 배포 및 라이선스 고지](vendor/qpdf/NOTICE.md).
