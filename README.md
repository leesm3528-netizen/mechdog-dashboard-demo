# MechDog 현장 관제 대시보드 — 데모

MechDog 4대 현장 관제 대시보드(관제 · 현장 트윈 · 지도 편집 · 음성 명령)의 공유용 데모입니다.
화면 코드는 실제 대시보드와 같고, 서버 대신 브라우저 안에서 가짜 로봇 4대와 3 m × 2 m 예시 지도를 돌립니다.
실제 로봇·카메라와는 연결되지 않으며, 그린 지도는 새로고침하면 처음으로 돌아갑니다.

**데모:** https://leesm3528-netizen.github.io/mechdog-dashboard-demo/

- 음성: 마이크 대신 음성 칸 아래 입력창에 문장을 넣어 해석을 시험할 수 있습니다.
  - `잠깐 멈춰`, `작업 시작` — 전체
  - `2호기 멈춰`, `1번 다시 시작`, `1억이 멈춰` — 그 로봇만 (STT 오인식 "1억이" 도 1호기)
  - 아래 ⏱ 줄에 해석·로봇 응답 시간이 나옵니다 (데모는 가짜 로봇이라 40~120 ms).
- 넘어짐 경고: 위쪽 `⚠ 넘어짐 시연` 을 누르면 3호기가 6초 동안 넘어진 상태가 되어 WARNING 표지판이 뜹니다.
- 단축키: Space 정지, 지도 편집에서 Ctrl+S 저장 · Ctrl+Z 되돌리기 · R 회전 · Delete 삭제.
- 데모는 규칙으로만 해석합니다. 실제 대시보드는 규칙에 없는 말을 Gemini LLM 으로 해석합니다.

## 호퍼 적재소

**페이지:** https://leesm3528-netizen.github.io/mechdog-dashboard-demo/hopper/

로봇 등의 버켓으로 쌀을 받는 호퍼입니다. 엎드려 들어와 일어서면 버켓이 막대를 밀어 공 마개가 열리고, 앞으로 지나가면 닫힙니다. 모터와 전기는 쓰지 않습니다.

- [시제품 영상](https://leesm3528-netizen.github.io/mechdog-dashboard-demo/hopper/film-prototype.html): 옆·위·앞에서 본 동작
- [여는 방법 비교](https://leesm3528-netizen.github.io/mechdog-dashboard-demo/hopper/film-open-methods.html), [부착물 구상](https://leesm3528-netizen.github.io/mechdog-dashboard-demo/hopper/film-concepts.html), [설계 초안](https://leesm3528-netizen.github.io/mechdog-dashboard-demo/hopper/design.html)

## 작업 기록

- [2026-11-20](hopper/) — 호퍼 적재소: 방식 비교, A 방식(로봇이 밀어 열기) 확정, 시제품 실측, 영상
- [2026-11-18](docs/2026-11-18-worklog.md) — 음성 지연 측정, 로봇별 음성 명령, STT 오인식 대응, 넘어짐 경고, Gemini LLM
