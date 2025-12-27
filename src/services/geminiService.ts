// src/services/geminiService.ts

export const speakText = (text: string): Promise<void> => {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    utterance.onend = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
};

export const generateNewSentences = async (topicTitle: string) => {
  try {
    const ai = (window as any).ai;
    if (ai && ai.languageModel) {
      const capabilities = await ai.languageModel.capabilities();
      if (capabilities.available !== 'no') {
        const session = await ai.languageModel.create();
        const prompt = `Generate 5 short sentences about ${topicTitle} for English learners. Format: English | Russian. No numbers.`;
        const result = await session.prompt(prompt);
        session.destroy();
        const parsed = result.split('\n').filter((l: any) => l.includes('|')).map((l: any, i: number) => {
          const [text, translation] = l.split('|').map((s: any) => s.trim());
          return { id: `ai-${Date.now()}-${i}`, text, translation };
        });
        if (parsed.length >= 3) return parsed;
      }
    }
    throw new Error("Local Fallback");
  } catch (err) {
    // Огромный список вариантов, чтобы при каждом нажатии было что-то новое
    const allVariants = [
      { text: `I love ${topicTitle} because it is fun.`, translation: `Я люблю тему "${topicTitle}", потому что это весело.` },
      { text: `Can you explain ${topicTitle} to me?`, translation: `Можешь объяснить мне тему "${topicTitle}"?` },
      { text: `This is my first time studying ${topicTitle}.`, translation: `Я впервые изучаю тему "${topicTitle}".` },
      { text: `Where can I find more about ${topicTitle}?`, translation: `Где я могу найти больше информации о ${topicTitle}?` },
      { text: `Is ${topicTitle} very popular here?`, translation: `Тема "${topicTitle}" здесь популярна?` },
      { text: `I need a specialist in ${topicTitle}.`, translation: `Мне нужен специалист по ${topicTitle}.` },
      { text: `What is the most important part of ${topicTitle}?`, translation: `Что самое важное в теме ${topicTitle}?` },
      { text: `I have many questions about ${topicTitle}.`, translation: `У меня много вопросов про ${topicTitle}.` }
    ];
    // Каждый раз выбираем случайные 5
    return allVariants.sort(() => 0.5 - Math.random()).slice(0, 5).map((v, i) => ({
      id: `fallback-${Date.now()}-${i}`, ...v
    }));
  }
};