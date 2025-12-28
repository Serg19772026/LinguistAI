import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { TOPICS } from './constants';
import { Topic, Sentence, AppState } from './types';
import { speakText, generateNewSentences } from './services/geminiService';

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const globalRecognition = SpeechRecognition ? new SpeechRecognition() : null;

if (globalRecognition) {
  globalRecognition.continuous = true;
  globalRecognition.interimResults = true;
  globalRecognition.lang = 'en-US';
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.SELECTING_TOPIC);
  const [selectedTopicIndex, setSelectedTopicIndex] = useState(0);
  const [selectedSentenceIndex, setSelectedSentenceIndex] = useState(0);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [matchedIndices, setMatchedIndices] = useState(new Set<number>());
  const [showTranslation, setShowTranslation] = useState(true);

  // Инициализация строго по 5 предложений
  const [visibleSentences, setVisibleSentences] = useState<Record<string, Sentence[]>>(() => {
    const initial: Record<string, Sentence[]> = {};
    TOPICS.forEach(t => {
      initial[t.id] = t.sentences.slice(0, 5);
    });
    return initial;
  });

  const [updatingTopicId, setUpdatingTopicId] = useState<string | null>(null);
  const [updateCounts, setUpdateCounts] = useState<Record<string, number>>({});

  const stateRef = useRef({ matchedIndices, isCompleted });
  useEffect(() => { stateRef.current = { matchedIndices, isCompleted }; }, [matchedIndices, isCompleted]);

  const currentTopic = TOPICS[selectedTopicIndex];
  const activeSentences = visibleSentences[currentTopic.id] || [];
  const currentSentence = activeSentences[selectedSentenceIndex] || activeSentences[0];

  // ИСПРАВЛЕННАЯ ЛОГИКА: Создаем оба массива одновременно, чтобы индексы всегда совпадали
  const { displayWords, sentenceWords } = useMemo(() => {
    const rawWords = currentSentence?.text.split(/\s+/).filter(w => w.length > 0) || [];
    const cleaned = rawWords.map(w => w.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, ""));
    return { displayWords: rawWords, sentenceWords: cleaned };
  }, [currentSentence]);

  const playSignal = useCallback(() => {
    try {
      const context = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(600, context.currentTime);
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.05, context.currentTime + 0.02);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.15);
      osc.connect(gain); gain.connect(context.destination);
      osc.start(); osc.stop(context.currentTime + 0.15);
    } catch (e) { }
  }, []);

  const stopMic = useCallback(() => {
    if (globalRecognition) { try { globalRecognition.abort(); } catch (e) { } }
    setIsListening(false);
  }, []);

  useEffect(() => {
    if (!globalRecognition) return;
    globalRecognition.onstart = () => setIsListening(true);
    globalRecognition.onend = () => setIsListening(false);
    globalRecognition.onerror = () => setIsListening(false);
    globalRecognition.onresult = (event: any) => {
      if (stateRef.current.isCompleted) return;

      let transcript = '';
      for (let i = 0; i < event.results.length; ++i) {
        transcript += event.results[i][0].transcript;
      }

      const spokenTranscript = transcript.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, "");
      const newMatches = new Set<number>();
      let lastSearchPos = -1;

      sentenceWords.forEach((word, idx) => {
        // Ищем вхождение слова в сказанном тексте
        const foundPos = spokenTranscript.indexOf(word, lastSearchPos + 1);
        if (foundPos !== -1) {
          newMatches.add(idx);
          lastSearchPos = foundPos;
        }
      });

      // Если нашли больше слов, чем было до этого - обновляем
      if (newMatches.size > stateRef.current.matchedIndices.size) {
        setMatchedIndices(newMatches);
      }
    };
  }, [sentenceWords]);

  // Следим за завершением
  useEffect(() => {
    if (matchedIndices.size > 0 && matchedIndices.size === sentenceWords.length) {
      // Задержка чуть больше, чтобы пользователь увидел последнее слово синим
      const timer = setTimeout(() => {
        setIsCompleted(true);
        stopMic();
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [matchedIndices.size, sentenceWords.length, stopMic]);

  const handlePracticeFullSentence = async () => {
    if (isSpeaking) return;
    stopMic();
    setMatchedIndices(new Set());
    setIsCompleted(false);
    setIsSpeaking(true);
    try {
      await speakText(currentSentence.text);
      setIsSpeaking(false);
      await new Promise(r => setTimeout(r, 1200));
      playSignal();
      await new Promise(r => setTimeout(r, 300));
      if (globalRecognition) {
        try {
          globalRecognition.start();
        } catch (e) {
          globalRecognition.abort();
          setTimeout(() => globalRecognition.start(), 200);
        }
      }
    } catch (err) { setIsSpeaking(false); }
  };

  const handleRefreshSentences = async (e: React.MouseEvent, topic: Topic) => {
    e.preventDefault();
    e.stopPropagation();
    setUpdatingTopicId(topic.id);
    try {
      const newSentences = await generateNewSentences(topic.title);
      setVisibleSentences(prev => ({ ...prev, [topic.id]: newSentences }));
      setUpdateCounts(prev => ({ ...prev, [topic.id]: (prev[topic.id] || 0) + 1 }));
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingTopicId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-6 font-sans text-slate-900 antialiased">
      <nav className="w-full flex justify-between items-center mb-10 max-w-md">
        <h1 className="text-xl font-black text-blue-600 tracking-tighter italic">LINGUIST.AI</h1>
        <button onClick={() => setShowTranslation(!showTranslation)} className="px-4 py-1.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black shadow-sm active:scale-95 transition-all">
          {showTranslation ? 'RU: ON' : 'RU: OFF'}
        </button>
      </nav>

      <main className="w-full max-w-md">
        {appState === AppState.SELECTING_TOPIC && (
          <div className="flex flex-col gap-4">
            {TOPICS.map((topic) => {
              const updates = updateCounts[topic.id] || 0;
              const isUpdating = updatingTopicId === topic.id;

              return (
                <div
                  key={topic.id}
                  onClick={() => {
                    setSelectedTopicIndex(TOPICS.findIndex(t => t.id === topic.id));
                    setAppState(AppState.SELECTING_SENTENCE);
                  }}
                  className="group relative p-6 bg-white rounded-[32px] shadow-sm cursor-pointer border border-slate-100 hover:border-blue-400 transition-all duration-300 active:scale-[0.98]"
                >
                  <button
                    onClick={(e) => handleRefreshSentences(e, topic)}
                    style={{ transform: `rotate(${updates * 360}deg)` }}
                    className={`absolute top-6 right-6 w-11 h-11 rounded-full flex items-center justify-center z-50 transition-all duration-700 shadow-sm border ${isUpdating
                      ? 'bg-blue-600 border-blue-400 text-white animate-spin'
                      : updates > 0
                        ? 'bg-emerald-500 border-emerald-400 text-white shadow-emerald-100'
                        : 'bg-white border-slate-100 text-slate-400 hover:bg-slate-50 hover:text-blue-600'
                      }`}
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>

                  <div className="text-5xl mb-4 group-hover:scale-110 transition-transform duration-300">{topic.icon}</div>
                  <h3 className="font-bold text-xl text-slate-800 tracking-tight mb-1">{topic.title}</h3>
                  <div className={`inline-flex items-center px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${updates > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {isUpdating ? 'Magic...' : updates > 0 ? `AI Content v${updates + 1}` : 'Original Pack'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {appState === AppState.SELECTING_SENTENCE && (
          <div className="flex flex-col gap-3">
            <button onClick={() => setAppState(AppState.SELECTING_TOPIC)} className="text-slate-400 text-[9px] font-black mb-4 self-start uppercase tracking-widest">← Back to topics</button>
            {activeSentences.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => { setSelectedSentenceIndex(idx); setAppState(AppState.PRACTICING); setMatchedIndices(new Set()); setIsCompleted(false); stopMic(); }}
                className="p-6 bg-white rounded-2xl shadow-sm text-left active:scale-[0.98] transition-all border border-slate-100 hover:border-blue-200"
              >
                <p className="font-bold text-lg leading-tight text-slate-800">{s.text}</p>
                {showTranslation && <p className="text-slate-400 font-bold text-xs mt-3">{s.translation}</p>}
              </button>
            ))}
          </div>
        )}

        {appState === AppState.PRACTICING && (
          <div className="flex flex-col items-center w-full mt-4">
            <button onClick={() => { stopMic(); setAppState(AppState.SELECTING_SENTENCE); }} className="self-start text-slate-300 text-[10px] font-black mb-6 uppercase tracking-widest">← Back to list</button>
            <div className="bg-white rounded-[40px] p-8 w-full shadow-xl text-center relative border border-slate-50">
              <div className={`text-base font-black uppercase mb-8 transition-all duration-1000 ${isListening
                  ? 'text-violet-600 tracking-widest scale-110 animate-pulse'
                  : isSpeaking
                    ? 'text-blue-600 tracking-normal'
                    : isCompleted
                      ? 'text-emerald-500 tracking-normal'
                      : 'text-slate-400 tracking-normal'
                }`}>
                {isSpeaking ? 'AI Voice' : isListening ? 'Listening...' : isCompleted ? 'Perfect!' : 'Get Ready'}
              </div>
              <div className="flex flex-wrap justify-center gap-x-2 gap-y-3 mb-10">
                {displayWords.map((word, idx) => (
                  <span key={idx} className={`text-2xl md:text-3xl font-black transition-all duration-300 ${matchedIndices.has(idx) ? 'text-blue-700' : 'text-slate-300'}`}>{word}</span>
                ))}
              </div>
              {showTranslation && <p className="text-slate-600 font-bold italic mb-12 text-base">"{currentSentence.translation}"</p>}

              <div className="flex flex-col items-center justify-center w-full">
                <button onClick={handlePracticeFullSentence} disabled={isSpeaking} className={`w-24 h-24 rounded-3xl flex items-center justify-center transition-all duration-500 ${isSpeaking ? 'bg-slate-50 text-slate-200' : isListening ? 'bg-red-500 text-white shadow-lg' : isCompleted ? 'bg-emerald-500 text-white shadow-md' : 'bg-blue-600 text-white shadow-blue-200 shadow-lg active:scale-95'}`}>
                  {isSpeaking ? (
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-slate-300 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                    </div>
                  ) : (
                    <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" /><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" /></svg>
                  )}
                </button>
                <p className="mt-8 text-[9px] font-black text-slate-600 uppercase tracking-widest">{isListening ? 'Speak now' : isCompleted ? 'Brilliant!' : 'Start'}</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
