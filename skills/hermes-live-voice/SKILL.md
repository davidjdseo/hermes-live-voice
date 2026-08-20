---
name: live-voice-agent
description: Use Live Voice Agent for gated Korean/English voice. Wake is 헤이 자비스.
---
# Live Voice Agent

Use the existing local voice loop. 모든 답변은 글로는 그대로 완성하고
마지막에 말할 내용만 담은 정확히 하나의 닫힌
`<<<VOICE ... VOICE>>>` 블록으로 끝낸다. 블록은 한국어로 자연스럽게,
개인 이름은 사용자가 원할 때만 쓰고, 보통 5개 이하의 짧은 문장으로
결과와 다음 행동을 말한다. 목록·코드·로그·경로·회고를 넣지 않으며,
행동이나 결정이 필요하면 정확히 질문 하나만 하고 선택지는 최대 세 개
(`A/B/C`)까지 제시한 뒤 기다린다. 닫히지 않은 블록이나 블록이 없는 답변은
말하지 않는다.

음성 명령은 수동 Start, 웨이크 문구, 또는 `헤이 자비스` / `hey jarvis`로
시작할 때만 받으며 방 소음과 TTS 메아리는 무시한다. `헤이 자스비`도
같은 웨이크다. 답변 뒤에는 `진행해 자비스`/`진행해` 또는 마지막 음성
질문의 A/B/C 중 하나만 이어서 받는다.
