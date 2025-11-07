// 상수 (난이도 파라미터)
const BASE_SCORE = 100;
const BONUS_SEC = 2;     // 정답 시 +2초
const PENALTY_SEC = -3;  // 오답 시 -3초

// DOM 참조
const elTimeProgress = document.getElementById('time-progress');
const elTimeRemaining = document.getElementById('time-remaining');
const elCorrectLive = document.getElementById('correct-live');
const elCombo = document.getElementById('combo');
const elMute = document.getElementById('mute-toggle');
const elCard = document.getElementById('card');
const elHanzi = document.getElementById('hanzi');
const elPinyin = document.getElementById('pinyin');
const elChoices = document.getElementById('choices');
const elFeedback = document.getElementById('feedback');
const elGameover = document.getElementById('gameover');
const elCorrectCount = document.getElementById('correct-count');
const elWrongList = document.getElementById('wrong-list');
const elRestart = document.getElementById('restart');
const elStage = document.querySelector('.stage');
const elToast = document.getElementById('toast');
const elIntro = document.getElementById('intro');
const elStart = document.getElementById('start');

// 오디오
let muted = false;
const sounds = {
  correct: new Audio('./assets/sounds/correct.mp3'),
  boom: new Audio('./assets/sounds/boom.mp3'),
};
function play(name) {
  if (muted) return;
  const a = sounds[name];
  if (!a) return;
  try { a.currentTime = 0; a.play(); } catch (_) {}
}

// 전역 상태
const initialTotalTime = 60; // 초
let totalRemaining = initialTotalTime; // 전역 타이머 남은 초
let totalTimerId = null; // setInterval id
let stateTimeoutId = null; // 피드백 대기 타임아웃 (다음 문제 전환)
let toastTimeoutId = null; // 토스트 숨김 타임아웃
let questionToken = 0; // 상태 경합 방지 토큰
let gameStartedAt = null; // 시작 시각 (ms)

let words = [];
let recentQueue = []; // 최근 출제 회피용
const RECENT_WINDOW = 4;

let current = null; // {hanzi, pinyin, korean}
let score = 0;
let combo = 0;
let maxCombo = 0;
let correctCount = 0;
let wrongQuestions = [];

// 유틸
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function rndInt(n) { return Math.floor(Math.random() * n); }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 데이터 로딩
async function loadWords() {
  const res = await fetch('./data/words_zh_ko.json');
  if (!res.ok) throw new Error('단어 데이터를 불러오지 못했습니다');
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('단어 데이터 형식 오류');
  words = data.filter(w => w && w.hanzi && w.pinyin && w.korean);
}

// HUD 업데이트
function renderHUD() {
  elTimeRemaining.textContent = String(Math.ceil(totalRemaining));
  const pct = clamp((totalRemaining / initialTotalTime) * 100, 0, 100);
  elTimeProgress.style.width = pct + '%';
  if (elCorrectLive) elCorrectLive.textContent = String(correctCount);
  elCombo.textContent = String(combo);
}

// 전역 타이머
function startGlobalTimer() {
  clearInterval(totalTimerId);
  totalTimerId = setInterval(() => {
    totalRemaining = clamp(totalRemaining - 1, 0, 9999);
    renderHUD();
    if (totalRemaining <= 0) {
      stopAllTimers();
      toGameOver();
    }
  }, 1000);
}

function adjustTime(deltaSec) {
  totalRemaining = clamp(totalRemaining + deltaSec, 0, 9999);
  renderHUD();
}

function stopAllTimers() {
  clearInterval(totalTimerId);
  clearTimeout(stateTimeoutId);
}

// 문제 생성
function sampleQuestion() {
  // 최근 출제 회피
  let idx = rndInt(words.length);
  let safeGuard = 0;
  while (recentQueue.includes(idx) && safeGuard++ < 20) idx = rndInt(words.length);
  recentQueue.push(idx);
  if (recentQueue.length > RECENT_WINDOW) recentQueue.shift();

  const correct = words[idx];
  const pool = words.map((w, i) => i).filter(i => i !== idx);
  shuffle(pool);
  const wrongs = pool.slice(0, 3).map(i => words[i]);
  const options = shuffle([correct.korean, ...wrongs.map(w => w.korean)]);
  return { correct, options };
}

// 렌더
function showQuestion(hanzi, pinyin, options, correctKorean) {
  elCard.hidden = false;
  elChoices.hidden = false;
  elFeedback.hidden = true;
  elHanzi.textContent = hanzi;
  elPinyin.textContent = pinyin;
  elChoices.innerHTML = '';
  options.forEach((txt, i) => {
    const btn = document.createElement('button');
    btn.className = 'btn choice';
    btn.type = 'button';
    btn.textContent = `${i + 1}. ${txt}`;
    btn.setAttribute('data-value', txt);
    btn.setAttribute('aria-label', `보기 ${i + 1}`);
    btn.addEventListener('click', () => onChoice(txt, correctKorean));
    elChoices.appendChild(btn);
  });
}

function showFeedback(ok, correctText) {
  // 중앙 토스트로 짧게 표시 (레이아웃 불변)
  if (!elToast) return;
  elToast.hidden = false;
  elToast.textContent = ok ? '정답! +2초' : `오답! (-3초)`;
  elToast.className = 'toast ' + (ok ? 'toast--good' : 'toast--bad');
  // 애니메이션은 CSS에서 처리; 자동 사라짐처럼 보이지만 안전하게 타임아웃에서 숨김
  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    elToast.hidden = true;
  }, 750);
}

// 상태 전이
function nextQuestion() {
  const { correct, options } = sampleQuestion();
  current = { ...correct, options };
  const token = ++questionToken;
  showQuestion(correct.hanzi, correct.pinyin, options, correct.korean);
}

function toFeedback(ok) {
  showFeedback(ok, current.korean);
  // 짧은 피드백 후 다음 문제
  const token = ++questionToken;
  clearTimeout(stateTimeoutId);
  stateTimeoutId = setTimeout(() => {
    if (token !== questionToken) return;
    nextQuestion();
  }, 800);
}

function toGameOver() {
  stopAllTimers();
  // 화면 토글
  document.getElementById('overlay').hidden = false;
  elGameover.hidden = false;
  // 통계
  elCorrectCount.textContent = String(correctCount);
  // 틀린 문제 렌더링
  if (elWrongList) {
    elWrongList.innerHTML = '';
    if (wrongQuestions.length === 0) {
      const li = document.createElement('li');
      li.textContent = '모든 문제를 맞혔어요! 🎉';
      elWrongList.appendChild(li);
    } else {
      wrongQuestions.forEach(item => {
        const li = document.createElement('li');
        const left = document.createElement('div');
        left.className = 'w-left';
        const hz = document.createElement('div'); hz.className = 'w-hanzi'; hz.textContent = item.hanzi;
        const py = document.createElement('div'); py.className = 'w-pinyin'; py.textContent = item.pinyin;
        left.appendChild(hz); left.appendChild(py);
        const right = document.createElement('div');
        right.className = 'w-right';
        const correct = document.createElement('div'); correct.className = 'w-correct'; correct.textContent = item.correctKorean;
        right.appendChild(correct);
        if (item.chosen && item.chosen !== item.correctKorean) {
          const chosen = document.createElement('div'); chosen.className = 'w-chosen'; chosen.textContent = item.chosen;
          right.appendChild(chosen);
        }
        li.appendChild(left); li.appendChild(right);
        elWrongList.appendChild(li);
      });
    }
  }
}

// 입력 처리
function onChoice(chosen, correctKorean) {
  // 퀴즈 타이머 정지
  clearTimeout(stateTimeoutId);
  const isCorrect = chosen === correctKorean;

  // 버튼 스타일 피드백
  const buttons = Array.from(elChoices.querySelectorAll('button'));
  buttons.forEach(b => {
    const v = b.getAttribute('data-value');
    if (v === correctKorean) b.classList.add('choice--correct');
    if (v === chosen && v !== correctKorean) b.classList.add('choice--wrong');
    b.disabled = true;
  });

  if (isCorrect) {
    combo += 1;
    maxCombo = Math.max(maxCombo, combo);
    const gained = BASE_SCORE * combo;
    score += gained;
    correctCount += 1;
    adjustTime(BONUS_SEC);
    renderHUD();
    play('correct');
    toFeedback(true);
  } else {
    combo = 0;
    adjustTime(PENALTY_SEC);
    renderHUD();
    play('boom');
    // 화면 흔들림 효과
    if (elStage) {
      elStage.classList.remove('shake'); // 연속 오답 시 재생을 위해 리플로우
      void elStage.offsetWidth;
      elStage.classList.add('shake');
    }
    // 오답 기록
    wrongQuestions.push({
      hanzi: current.hanzi,
      pinyin: current.pinyin,
      correctKorean: current.korean,
      chosen
    });
    toFeedback(false);
  }
}

// per-question 타이머 제거(단일 화면 진행)

// 시작/재시작
async function startGame() {
  // UI 초기화
  document.getElementById('overlay').hidden = true;
  elGameover.hidden = true;
  elChoices.innerHTML = '';
  elFeedback.textContent = '';
  elFeedback.hidden = true;

  // 상태 초기화
  totalRemaining = initialTotalTime;
  score = 0;
  combo = 0;
  maxCombo = 0;
  correctCount = 0;
  questionToken++;
  stopAllTimers();
  renderHUD();
  startGlobalTimer();
  gameStartedAt = Date.now();
  wrongQuestions = [];
  nextQuestion();
}

// 이벤트 바인딩
elMute.addEventListener('click', () => {
  muted = !muted;
  elMute.setAttribute('aria-pressed', String(muted));
  elMute.textContent = muted ? '🔇' : '🔊';
});

document.addEventListener('keydown', (e) => {
  if (elChoices.hidden) return;
  const map = { '1': 0, '2': 1, '3': 2, '4': 3 };
  if (e.key in map) {
    const idx = map[e.key];
    const btn = elChoices.querySelectorAll('button')[idx];
    if (btn) btn.click();
  }
});

elRestart.addEventListener('click', () => startGame());
if (elStart) {
  elStart.addEventListener('click', () => {
    if (elIntro) elIntro.hidden = true;
    document.getElementById('overlay').hidden = true;
    startGame();
  });
}

// 초기 진입
(async function init() {
  try {
    await loadWords();
  } catch (err) {
    console.error(err);
    alert('단어 데이터를 불러오지 못했습니다. 콘솔을 확인하세요.');
    return;
  }
  // 오프닝 노출, 게임은 시작 버튼으로 진행
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.hidden = false;
  if (elIntro) elIntro.hidden = false;
})();


