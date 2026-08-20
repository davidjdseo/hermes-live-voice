# Always-On 음성 계층 설계 v2 (최종) — hermes-live-voice v0.2 제안

**결정 요약**

| 질문 | 결정 |
|---|---|
| 계층 위치 | 같은 패키지, subpath export `hermes-live-voice/always-on` (v1 유지) |
| 모델 실행 위치 | Python 사이드카 (extras, 선택 설치), JSONL/stdio (v1 유지) |
| 인터페이스 | **5개**: `AudioSource`(신규) + `WakewordEngine` / `VadEngine`(신규) / `STTEngine` / `TTSEngine` |
| 캡처 소유권 | **런타임이 `AudioSource` 1개를 소유, 엔진은 스트림만 받는다** (수정 #2) |
| VAD/barge-in 경로 | **`VadEngine`을 4번째 엔진으로 분리** (수정 #1) |
| wake/barge-in 핸드오프 | 런타임 ring buffer(`preRollMs`, 기본 1500ms)를 STT 입력 앞에 prepend (수정 #3) |
| core 재사용 | **합성**(bridge 경유). core.js 변경은 **echo gate helper의 named export 추가에 한정** (수정 #4) |
| backend 모드 | VoiceCore를 **항상** 합성 사용. 얇은 자체 상태 모드는 기각 |
| 런타임 요구 | Node >= 20 (`engines` 필드 명시) (수정 #8) |
| py-engine | **ONNX 런타임 전용 고정, torch 미사용** (수정 #8) |

v1 대비 정직한 수정 사항: "core 변경 없음" 주장은 폐기합니다. 실제 core.js에서 wake gate·echo gate·rearm timer·choice gate는 전부 `VoiceCore` 내부 private이므로, 런타임이 echo gate를 직접 쓰려면 export 추가가 필요합니다. v0.2의 core.js 변경은 **named export 추가에 한정**하며, 기존 export·동작·PHASES는 불변입니다. `bridge.js`·`adapters/`·`desktop/plugin.js`는 변경 없음을 유지합니다.

---

## 1. 구조

질문 A(루프의 위치: JS, 같은 패키지)와 질문 B(모델 실행: Python 사이드카)의 분리 결정은 v1과 동일합니다. 근거도 동일(core 의미론 재사용, 프로세스 경계로 무거운 의존성 격리, `child_process`만 사용하므로 npm 기준 dependency-free 유지). 여기서는 수정 #1·#2·#3에 해당하는 세 결정만 다룹니다.

### 1-1. 캡처 소유권: 런타임이 `AudioSource`를 소유 (수정 #2)

v1은 `transcribe(audio: AsyncIterable)`(캡처가 외부라는 뜻)와 "listening: STTEngine이 마이크 소유"가 양립 불가였습니다. v2는 **소유자를 런타임 하나로 통일**합니다.

- "소유권"의 정의: 캡처 세션의 **시작/중지/분배를 결정하는 주체**. Node에 내장 마이크 API가 없으므로 물리 캡처는 사이드카(sounddevice)가 열지만, 세션 제어와 스트림 분배는 런타임이 소유합니다.
- 엔진은 마이크를 직접 열지 않습니다. 모든 오디오 소비 엔진은 `(AsyncIterable<AudioChunk>, opts) => AsyncIterable<Event>` 시그니처 하나로 통일됩니다.

Trade-off:

- 장점: 마이크 경합·이중 오픈이 원천 불가. wake→STT 핸드오프가 스트림 tee로 해결. 엔진 조합이 자유로움(브라우저 wake + 사이드카 STT 등).
- 단점 1: 캡처 내장 엔진(하드웨어 키워드 스포터, 일체형 디바이스)은 `AudioSource`+엔진 쌍으로 래핑해야 합니다.
- 단점 2: wake와 STT가 같은 사이드카 프로세스여도 오디오가 경계를 왕복합니다(사이드카→JS→사이드카). 16kHz mono base64 ≈ 43KB/s라 v0.2에서는 허용하고, 왕복 제거는 프로토콜에 `direct` capability를 예약해 v0.3에서 검토합니다.
- 반대안(엔진이 캡처 소유) 기각 이유: v1의 모순이 재발하고, 커스텀 조합 시 두 엔진이 같은 마이크를 여는 문제가 해결되지 않습니다.

### 1-2. VAD는 4번째 인터페이스로 분리 (수정 #1)

`WakewordEngine` 확장이 아니라 `VadEngine`을 별도로 둡니다. 이유: (a) 키워드 스포팅과 발화 구간 판정은 수명주기와 튜닝 파라미터가 다르고, (b) wake 전용 엔진(Porcupine 등)과 조합할 때 교체 단위가 달라지며, (c) IDLE에서는 wake만, SPEAKING에서는 VAD만 구동하는 상태별 배선이 인터페이스 분리에서 자연스럽습니다.

### 1-3. post-wake / post-barge-in 핸드오프 (수정 #3)

- 런타임의 분배기가 최근 `preRollMs`(기본 1500ms, 16kHz mono 기준 48KB)를 메모리 ring buffer에 항상 유지합니다. 덮어쓰기 ring이며 디스크 기록 없음.
- `WakeEvent` 수신 시, 그리고 SPEAKING 중 barge-in `speech_start` 시, 새 STT 스트림을 열 때 **snapshot을 먼저 yield(`preroll: true`, 원래 `ts` 유지)하고 이어서 live chunk**를 흘립니다.
- 엔진 관점에서는 하나의 연속 스트림입니다. 과거 chunk를 무시하고 싶은 엔진은 `ts`로 판단합니다.
- 프라이버시: ring buffer 내용이 로컬 프로세스 밖으로 나가는 시점은 wake/barge-in으로 세션이 열릴 때뿐입니다.

---

## 2. 인터페이스 시그니처

```js
// src/alwayson/engines.js — typedef + 검증만, 구현 없음

/**
 * @typedef {object} AudioChunk
 * @property {Int16Array} pcm      mono 16-bit PCM
 * @property {number} sampleRate   Hz (기본 16000)
 * @property {number} ts           캡처 시각 (ms epoch)
 * @property {boolean} [preroll]   ring buffer 출처면 true
 */

/**
 * AudioSource — 유일한 캡처 소유자. 인스턴스는 런타임이 소유하고
 * 엔진에는 이 객체가 아니라 스트림만 전달된다.
 * @typedef {object} AudioSource
 * @property {(opts?: {signal?: AbortSignal}) => Promise<void>} start
 *   권한 거부 시 {code:'MIC_DENIED'}로 reject. 영구 오류 — 재시도 금지.
 * @property {() => Promise<void>} stop
 * @property {() => AsyncIterable<AudioChunk>} stream
 *   디바이스 이탈 시 {code:'DEVICE_LOST'}로 throw.
 */

/**
 * @typedef {object} WakeEvent
 * @property {string} keyword
 * @property {number} score   0..1
 * @property {number} ts
 */

/**
 * WakewordEngine — 키워드 스포팅. 캡처를 열지 않는다.
 * @typedef {object} WakewordEngine
 * @property {(audio: AsyncIterable<AudioChunk>,
 *            opts?: {signal?: AbortSignal}
 *           ) => AsyncIterable<WakeEvent>} detect
 */

/**
 * @typedef {object} VadEvent
 * @property {'speech_start'|'speech_end'} type
 * @property {number} ts
 * @property {number} [confidence]
 */

/**
 * VadEngine — barge-in 감지용 발화 구간 판정.
 * @typedef {object} VadEngine
 * @property {(audio: AsyncIterable<AudioChunk>,
 *            opts?: {signal?: AbortSignal, minSpeechMs?: number}
 *           ) => AsyncIterable<VadEvent>} detect
 */

/**
 * @typedef {object} STTEvent
 * @property {'partial'|'final'} type
 * @property {string} text
 * @property {number} [confidence]
 */

/**
 * STTEngine — 입력 iterable 종료 또는 signal abort 시 final을 flush하고 종료한다.
 * (maxUtterance 타임아웃 시 런타임이 abort → 엔진은 flush 규약을 따른다)
 * @typedef {object} STTEngine
 * @property {(audio: AsyncIterable<AudioChunk>,
 *            opts?: {signal?: AbortSignal, language?: string}
 *           ) => AsyncIterable<STTEvent>} transcribe
 */

/**
 * @typedef {object} TTSEvent
 * @property {'started'|'chunk'|'done'|'interrupted'} type
 * @property {AudioChunk} [audio]   'chunk'일 때. opts.meter:true일 때만 방출(기본 off)
 */

/**
 * TTSEngine — 재생 소유권은 엔진에 둔다(barge-in 즉시 정지를 위해).
 * @typedef {object} TTSEngine
 * @property {(text: string | AsyncIterable<string>,
 *            opts?: {signal?: AbortSignal, meter?: boolean}
 *           ) => AsyncIterable<TTSEvent>} speak
 * @property {() => Promise<void>} interrupt   fire-and-forget. 정지 목표 < 50ms
 */
```

비동기 경계 규칙 (v1에서 유지·보강):

- 모든 비동기 경계는 `AbortSignal`. 런타임은 세션마다 `AbortController`를 만들고 전이 시 abort.
- 엔진 오류 채널: 엔진의 event iterable이 throw하면 런타임이 `error` 이벤트(`code: 'ENGINE_*'`)로 변환합니다. `onWake` 콜백 외에 에러 경로가 없던 v1의 구멍을 이 규칙으로 닫습니다.
- backpressure: 실시간 오디오는 무한 버퍼링하지 않습니다. 런타임 분배기는 소비자당 bounded queue(기본 2초 분량)를 두고, 초과 시 가장 오래된 chunk를 drop한 뒤 `error`(`code: 'AUDIO_OVERFLOW'`) 진단을 올립니다.
- `interrupt()`만 fire-and-forget. await 없이 상태 전이가 먼저입니다.
- `assertEngines()`는 시작 시 5개 역할의 메서드 존재만 검사(duck typing).
- harness 응답 타임아웃은 **런타임 옵션이 아니라 backend 어댑터(6메서드 계약 구현체) 책임**으로 이동합니다. 런타임이 harness를 직접 호출하지 않기 때문입니다(합성 원칙, §3 참조). v1의 `responseTimeoutMs` 런타임 옵션은 제거합니다.

절 단위 chunker는 v1 그대로입니다(순수 함수, dependency-free).

---

## 3. 상태 머신: 런타임은 core PHASES를 따른다 (수정 #4)

원칙을 v1보다 좁혀 정직하게 씁니다: **세션 상태는 core가 소유하고, 런타임은 I/O 배선과 I/O 타임아웃만 소유합니다.** 런타임은 자체 상태 enum을 두지 않고, `VoiceCore`의 PHASES(OFF/IDLE/LISTENING/THINKING/SPEAKING) 전이 이벤트를 subscribe해 따라갑니다. 세션 타이머(rearm/continue window)는 core 소유, 런타임 소유 타이머는 I/O 타임아웃(`maxUtteranceMs`, 사이드카 hello/응답)뿐입니다.

```
             WakeEvent → core.toggle()   (wake gate: 중복 억제는 core 판단)
  IDLE ─────────────────────────────▶ LISTENING ──final → core.submit()──▶ THINKING
   ▲                                  │                                     │
   │                                  │ maxUtteranceMs 도달                 │ 응답 스트림
   │                                  │ → transcribe abort                  │ (adapter 경로)
   │                                  │   (엔진 flush 규약)                  ▼
   │                                  │                                  SPEAKING
   │                                  │                                     │
   │                                  │   VAD speech_start                  │
   │                                  │   → ring buffer + live로 후보 전사    │
   │                                  │   → echo gate (core export helper)  │
   │                                  │     ├ echo 판정: 폐기, 재생 계속      │
   │                                  │     └ 실발화: tts.interrupt() 즉시    │
   │                                  │       + core 기존 barge-in 경로       │
   │                                  ◀─────────────────────────────────────┘
   └──────────────── core rearm timer (continue window) 만료 ──────────────┘
```

THINKING 중 조기 barge-in은 v1과 동일하게 기본 불허(옵션으로 VAD 구동 가능).

### core 재사용 계약 표 (실제 코드 기준)

| 게이트/의미론 | core.js 위치 | 런타임의 사용 방법 | core 변경 |
|---|---|---|---|
| PHASES (OFF/IDLE/LISTENING/THINKING/SPEAKING) | export됨 | import해 phase 이벤트 매핑에 사용. 런타임 자체 상태 enum 없음 | 없음 |
| wake gate | `VoiceCore` 내부 | `WakeEvent` 시 `core.toggle()` 호출. 중복 억제 판단은 core가 내림 | 없음 |
| echo gate (`ttsEchoSimilarity` + substring 매칭) | `VoiceCore` 내부 | SPEAKING 중 후보 전사(partial)에 **런타임이 직접 적용**해 barge-in 확정/폐기 결정. 비교 대상 텍스트는 core의 speak 이벤트로 알고 있음 | **pure helper 2개 named export 추가** (동작 변경 없음) |
| rearm timer (`scheduleRearm`/`cancelRearm`/`ensureIdleRearm`) | `VoiceCore` 내부, scheduler 주입 가능 | continue window는 core가 소유. 런타임은 phase 전이만 수신. 테스트는 fake scheduler 주입으로 결정론 확보 | 없음 |
| choice gate | `VoiceCore` 내부 | SPEAKING→LISTENING 전이 이벤트로 표면화. 새 상태 불필요 | 없음 |
| barge-in 의미론 (응답 abort + harness `interrupted`) | `VoiceCore` 내부 | echo gate를 통과한 발화를 기존 사용자 입력 경로로 전달하면 core의 기존 동작이 수행됨 | 없음 |

메서드 매핑 (6메서드 계약):

| 런타임 이벤트 | VoiceCore 호출 |
|---|---|
| `WakeEvent` | `toggle()` |
| STT `final` | `submit(text)` |
| backend 응답 | adapter → bridge 기존 경로 (런타임 개입 없음). core의 speak 이벤트를 subscribe해 `chunkClauses` → `tts.speak()` 수행 |

### backend 모드: VoiceCore를 항상 합성 사용

`createAlwaysOn`은 내부에서 `bridge.js`를 생성해 사용자의 backend(6메서드 계약 구현체)와 `VoiceCore`를 연결하고, 런타임은 이 인스턴스를 **합성**(상속 아님)으로 사용합니다. harness 없는 standalone 경우에도 VoiceCore 없는 얇은 자체 상태로 가는 안은 **기각**합니다. 그 순간 게이트 재사용 가치가 사라지고 상태머신이 두 개가 되어 §3 원칙 자체가 붕괴하기 때문입니다. 비용: backend가 없는 순수 로컬 데모도 6메서드 stub이 필요합니다(예시로 stub 제공 가능).

---

## 4. 디렉토리 구조

```
hermes-live-voice/
├─ src/
│  ├─ core.js                 # named export 2개 추가(echo gate helper) 외 변경 없음
│  ├─ bridge.js               # 변경 없음
│  ├─ adapters/               # 변경 없음
│  └─ alwayson/
│     ├─ runtime.js           # createAlwaysOn(): PHASES 추종 루프 + 이벤트 디스패치
│     ├─ engines.js           # 5개 인터페이스 typedef + assertEngines()
│     ├─ audio.js             # 스트림 tee/분배기 + ring buffer (순수, dependency-free)
│     ├─ chunker.js           # 절 단위 chunker (순수 함수)
│     └─ sidecar/
│        ├─ protocol.js       # JSONL 인코드/디코드 + 생애주기 규정 검증
│        ├─ client.js         # child_process stdio 클라이언트
│        └─ engine.js         # 사이드카 1개 프로세스로 5개 역할 구현
├─ extras/
│  └─ py-engine/              # reference 사이드카 (별도 pip 설치, ONNX 전용)
│     ├─ pyproject.toml       # torch 의존성 없음
│     ├─ README.md            # 모델 다운로드 시점·라이선스·"torch 미설치" 명시
│     └─ hermes_voice_engine/
│        ├─ __main__.py       # stdio JSONL 서버
│        ├─ capture.py  wakeword.py  vad.py  stt.py  tts.py
├─ examples/
│  ├─ always-on-python.js
│  └─ always-on-custom.js
├─ desktop/plugin.js          # 변경 없음
└─ package.json
```

```json
{
  "engines": { "node": ">=20" },
  "exports": {
    ".": "./src/bridge.js",
    "./always-on": "./src/alwayson/runtime.js",
    "./always-on/sidecar": "./src/alwayson/sidecar/engine.js"
  }
}
```

### 사이드카 프로토콜 v1 — 생애주기 규정 (수정 #5)

메시지 형식은 v1과 동일(JSONL, `hello` capability 협상, base64 PCM). 여기에 생애주기 규정을 추가합니다.

- **stdout은 JSONL 전용.** 로그·warning·모델 다운로드 진행률은 전부 stderr. reference 구현은 logging 설정으로 이를 강제합니다.
- **비JSON 라인은 스킵.** JS 클라이언트는 throw하지 않고 스킵+카운트만 하고, 연속 10라인 초과 시 `error`(`code: 'PROTOCOL'`).
- **라인 크기 상한 1MB.** 초과 라인은 스킵 + `code: 'PROTOCOL'`. PCM chunk는 20–100ms 단위 권장.
- **stdin EOF = 자동 종료.** 사이드카는 stdin EOF 감지 후 2초 이내 종료해야 합니다(JS 사망 시 좀비 프로세스 방지). conformance 테스트의 필수 항목입니다.
- **interrupt 우선처리.** `tts.interrupt`는 id 없는 notification(fire-and-forget)입니다. 사이드카는 수신 즉시 진행 중 합성/재생을 취소하며 요청 큐를 거치지 않습니다. JS 클라이언트도 pending 응답을 기다리지 않고 즉시 전송합니다.
- **hello 타임아웃 5초.** capabilities/version 협상 실패 시 spawn 실패로 간주.
- **크래시 진단.** 비정상 exit 시 exit code + stderr 마지막 20라인을 `error`(`code: 'ENGINE_CRASH'`)에 첨부. 백오프 1·2·4초 최대 3회 재시작, 이후 `code: 'ENGINE_DEAD'`와 함께 런타임 정지(무한 crash loop 금지).

---

## 5. 최소 사용 예시

Python 엔진 버전 (13줄):

```js
import { createAlwaysOn } from 'hermes-live-voice/always-on';
import { pythonEngine } from 'hermes-live-voice/always-on/sidecar';
import { createBackend } from 'hermes-live-voice/adapters/hermes';

const assistant = createAlwaysOn({
  engines: pythonEngine({ wakeModel: 'hey_jarvis', sttModel: 'base', voice: 'af_heart' }),
  backend: createBackend({ url: 'ws://localhost:8787' }),  // 인증·모델은 harness 측 소유
});
assistant.on('wake',        () => console.log('[wake]'));
assistant.on('utterance',   (t) => console.log('you:', t));
assistant.on('interrupted', () => console.log('[interrupted]'));
assistant.on('error',       (e) => console.error(e.code, e.message));
await assistant.start();   // Ctrl+C까지 idle 루프
```

커스텀 엔진 주입 버전 (16줄):

```js
import { createAlwaysOn } from 'hermes-live-voice/always-on';

const assistant = createAlwaysOn({
  engines: {
    source:   myAudioSource,  // { start, stop, stream() }
    wakeword: myWakeEngine,   // { detect(audio, opts) }
    vad:      myVadEngine,    // { detect(audio, opts) }
    stt:      mySttEngine,    // { transcribe(audio, opts) }
    tts:      myTtsEngine,    // { speak(text, opts), interrupt() }
  },
  backend: myHarness,         // 기존 6메서드 계약 구현체
  preRollMs: 1500,            // wake/barge-in 핸드오프 ring buffer
  maxUtteranceMs: 30000,      // STT final 없음 타임아웃
});
assistant.on('interrupted', () => myHarness.cancelCurrent());
await assistant.start();
```

이벤트 표면은 작게 유지합니다: 사용자 이벤트 4개(`wake`, `utterance`, `response_chunk`, `interrupted`) + 진단용 `error` 1개(`code`로 분기: `MIC_DENIED`, `DEVICE_LOST`, `ENGINE_CRASH`, `ENGINE_DEAD`, `PROTOCOL`, `UTTERANCE_TIMEOUT`, `AUDIO_OVERFLOW`).

---

## 6. extras 구성표

| capability | extra | 권장 기본 | 대안 | 비고 |
|---|---|---|---|---|
| 오디오 캡처 | `extras/py-engine` | sounddevice | 브라우저 getUserMedia | `AudioSource` 구현 |
| wake word | `extras/py-engine` | openWakeWord (**ONNX**) | Porcupine (키는 사용자 소유) | 저전력 상시 대기 |
| VAD | `extras/py-engine` | silero-vad (**ONNX export**) | webrtcvad | barge-in 판정용 |
| STT | `extras/py-engine` | faster-whisper **int8** (CTranslate2) | whisper.cpp 사이드카 | base 모델 기준 |
| TTS | `extras/py-engine` | kokoro-onnx | edge-tts (네트워크, 키 불필요) | 절 단위 스트리밍 |
| AEC | v0.3 후보 | — | speexdsp | 스피커 재생 중 barge-in 보조 |

py-engine은 **ONNX 런타임 전용으로 고정**합니다(수정 #8). silero-vad는 ONNX export를 onnxruntime으로 실행하고, faster-whisper는 CTranslate2 기반이라 torch가 필요 없으며, kokoro-onnx·openWakeWord도 ONNX로 동작합니다. `pyproject.toml`에 torch 의존성은 없고, README에 "torch를 설치하지 않는다"와 모델 다운로드 시점(최초 실행 시)·라이선스를 표기합니다. 이것이 RSS 목표(§7)의 전제입니다.

프레이밍도 README에 명시합니다: **core는 dependency-free, reference engine은 heavy**(onnxruntime + 모델 파일로 수백 MB급). "dependency-free"는 npm 패키지 기준의 주장입니다.

---

## 7. 비기능 요구사항 (전제 조건 표기)

| 항목 | 목표 | 전제 조건 |
|---|---|---|
| wake → listening 피드백 | < 100ms | 이벤트 타임스탬프 차이 |
| 발화 종료 → final 전사 | < 300ms | faster-whisper int8, beam size 1, 발화 5초 이하, CPU 4코어. 그 외 환경은 측정 도구로 확인 |
| harness 첫 토큰 → 첫 TTS 오디오 | < 500ms | harness 스트리밍 응답, 첫 절 20자 이내 도착 |
| barge-in 발화 시작 → 재생 정지 | < 150ms | **헤드폰 사용**. 스피커 재생은 AEC(v0.3) 전까지 오탐/미탐을 보장하지 않음 — echo gate 확인 단계에서 확정이 늦어질 수 있음 |
| idle CPU | < 5% (1코어) | 16kHz wake+VAD만 동작, ONNX int8 |
| 사이드카 RSS | < 500MB | ONNX 런타임 전용 + int8 모델. **torch 설치 시 이 목표는 무효** |
| JS 런타임 RSS | < 50MB | — |

위 수치는 측정 가능한 환경에서의 목표이며, 검증은 지연 측정 스크립트(로드맵 항목)로 제공합니다. 환경별 보장으로 읽히지 않도록 문서에도 이 문구를 유지합니다.

프라이버시 (v1 유지·보강):

- ring buffer는 메모리 상주·덮어쓰기이며, 내용이 로컬 프로세스 밖으로 나가는 것은 wake/barge-in으로 세션이 열릴 때뿐입니다.
- 기본 구성에서 로컬을 떠나는 것은 전사된 텍스트뿐이며 행선지는 사용자 harness가 결정합니다.
- 라이브러리 공개 API에 API 키/토큰 파라미터를 두지 않습니다.
- 네트워크 엔진(edge-tts 등) 선택은 사용자의 명시적 선택이며 해당 extra README에 표기합니다.

---

## 8. 실패 매트릭스 (수정 #6)

| 실패 | 감지 경로 | 동작 | 상태 전이 | 표면 이벤트 |
|---|---|---|---|---|
| 마이크 권한 거부 | `source.start()` reject (`MIC_DENIED`) | 재시도 없음(영구 오류 분류, crash-loop 방지) | 시작 실패, OFF 유지 | `start()` reject + `error` |
| harness 타임아웃 | adapter/core 기존 계약 | core의 기존 오류 처리에 따름. 런타임은 THINKING의 엔진 스트림만 정리 | **core PHASE를 따름**(독자 전이 없음). 안내 TTS는 사용자 콜백 몫 | `error` |
| 세션 중 사이드카 크래시 | 프로세스 exit / stdout EOF | in-flight 스트림 abort. STT는 flush 규약 시도, TTS는 재생 정지(사용자 발화가 아니므로 `interrupted`가 아니라 `error`). 백오프 재시작 3회 | core PHASE를 따름. **진행 중 발화·응답은 복구하지 않음(유실 명시)** | `error`(`ENGINE_CRASH`) → 3회 실패 시 `ENGINE_DEAD` 후 정지 |
| SPEAKING 중 wake 감지 | wakeword 이벤트 | core wake gate가 억제(무시). 단 오디오는 VAD→후보 전사→echo gate 경로로 계속 평가되므로 실제 barge-in 의도는 그쪽에서 잡힘 | 변화 없음 | 없음 |
| STT final 없음 | `maxUtteranceMs`(기본 30s) | `transcribe` abort → 엔진 flush 규약. 그래도 final이 없으면 폐기 | core PHASE를 따름 | `error`(`UTTERANCE_TIMEOUT`) |
| 오디오 디바이스 이탈 | source stream이 `DEVICE_LOST`로 throw | 캡처 재오픈을 백오프로 시도(일시 이탈로 분류, 복귀 대기). 세션 중이면 세션은 core 규칙대로 정리 | 복구 시 IDLE 루프 재개 | `error`(`DEVICE_LOST`) → 복구 시 `wake` 루프부터 재개 |
| 사이드카 stdout 오염 | JSONL 파싱 실패 | 비JSON 라인 스킵+카운트. 연속 10라인 초과 시 진단 | 없음 | `error`(`PROTOCOL`) |
| 다중 runtime 마이크 경합 | `source.start()` 실패(`DEVICE_BUSY`) | 재시도 없음. 프로세스 내 싱글턴은 강제하지 않고 플랫폼 동작에 맡김 | 시작 실패 | `error` |

---

## 9. v0.2 로드맵 (수정 #7·#8 반영)

**v0.2 — Always-on layer**

- [ ] `createAlwaysOn()` 런타임: core PHASES 추종 루프, 이벤트 5개(`wake`, `utterance`, `response_chunk`, `interrupted`, `error`)
- [ ] 5개 인터페이스(`AudioSource`/`WakewordEngine`/`VadEngine`/`STTEngine`/`TTSEngine`) typedef + `assertEngines()`
- [ ] `audio.js`: 스트림 tee/분배기(bounded queue) + ring buffer(`preRollMs`)
- [ ] 절 단위 chunker와 스트리밍 TTS 연결
- [ ] barge-in: VAD `speech_start` → ring buffer+live 후보 전사 → echo gate(core export helper) → `tts.interrupt()` + core 기존 barge-in 경로
- [ ] core.js: echo gate pure helper 2개 named export 추가(기존 동작·export 불변)
- [ ] 사이드카 프로토콜 v1(JSONL/stdio, §4 생애주기 규정 포함) + JS 클라이언트
- [ ] `extras/py-engine`: ONNX 전용 reference 구현(capture + openwakeword + silero-vad-onnx + faster-whisper int8 + kokoro-onnx), torch 미사용
- [ ] **테스트: 프로토콜 conformance 스위트** — JSONL fixture 기반, hello/비JSON 스킵/1MB 상한/interrupt 우선처리/stdin EOF 종료/stderr 격리를 검증. 사이드카는 언어 구현과 무관하게 이 스위트를 통과해야 함
- [ ] **테스트: fake-engine 상태머신 테스트** — in-memory fake 5역할로 wake→발화→응답, barge-in, echo 오탐 억제, continue window 만료 시나리오를 검증. core rearm은 scheduler 주입 지점에 fake scheduler를 넣어 결정론적으로 제어
- [ ] `package.json`에 `"engines": { "node": ">=20" }` 명시
- [ ] 예시 2개(각 20줄 이하) + desktop plugin 연동 메모
- [ ] 지연 측정 스크립트 — 목표 수치가 아니라 측정 도구로 제공

범위 메모: py-engine의 크로스플랫폼 리스크(macOS TCC, Windows PortAudio, 모델 배포)가 가장 큽니다. JS 런타임+프로토콜+테스트와 py-engine full은 별도 태그(v0.2 / v0.2.1)로 나눌 수 있게 로드맵을 유지합니다.

**Non-goals (v0.2)**: **speech-to-speech 리얼타임 모델(GPT-realtime/Gemini Live류) — STT/TTS를 우회해 오디오를 백엔드와 직접 주고받는 경로는 v0.2 계약에 없음**, WebRTC/서버 컴포넌트, 내장 LLM, 클라우드 키 관리, 모바일, AEC.

**v0.3 후보 (약속 아님)**: AEC, backend audio passthrough(S2S 대응 경로), partial 전사 → speculative LLM 호출 옵션, binary audio framing(`transport` 협상 필드), 사이드카 `direct` routing(경계 왕복 제거), 멀티 wake word, 사이드카 재시작 정책 외부화.

---

수정 필수 8개 항목의 대응 위치: #1·#2·#3 → §1·§2, #4 → §3 계약 표, #5 → §4 생애주기, #6 → §8, #7·#8 → §9. 필요하면 이 문서를 `docs/always-on-design.md`로 정리하거나, §2를 실제 `engines.js` 스켈레톤으로 내리는 작업을 이어서 하겠습니다.