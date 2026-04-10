import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SOUNDS = {
  shuffle: "https://assets.mixkit.co/sfx/preview/mixkit-card-shuffle-617.mp3",
  deal: "https://assets.mixkit.co/sfx/preview/mixkit-playing-card-flick-1594.mp3",
  play: "https://assets.mixkit.co/sfx/preview/mixkit-card-flick-607.mp3",
  winTrick: "https://assets.mixkit.co/sfx/preview/mixkit-winning-chime-2064.mp3",
  gameEnd: "https://assets.mixkit.co/sfx/preview/mixkit-magical-win-chime-2019.mp3",
  roundEnd: "https://assets.mixkit.co/sfx/preview/mixkit-fantasy-game-success-notification-270.mp3",
};

const ttsCache: Record<string, string> = {};

const THEMATIC_PHRASES = {
  highTrump: [
    "Que trunfo pesado!",
    "Isso é que é jogar!",
    "Sete de trunfo na mesa!",
    "Ás de trunfo, ninguém passa!",
    "Bela jogada, mestre!"
  ],
  highPoints: [
    "Vaza gorda! Muitos pontos aqui!",
    "Essa vaza vai doer!",
    "Equipa está a carregar o saco!",
    "Que vaza valiosa, sim senhor!",
    "Pontos a entrar, assim é que é!"
  ],
  general: [
    "Vamos ver quem manda aqui!",
    "Intrufo é para quem sabe!",
    "Cuidado com o parceiro!",
    "Baralho novo, vida nova!"
  ]
};

function getRandomPhrase(category: keyof typeof THEMATIC_PHRASES): string {
  const phrases = THEMATIC_PHRASES[category];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

let geminiCooldownUntil = 0;

async function generateTTS(text: string): Promise<string | null> {
  if (ttsCache[text]) return ttsCache[text];

  // If we hit a quota error recently, skip Gemini and go straight to fallback
  if (Date.now() < geminiCooldownUntil) {
    return useWebSpeechFallback(text);
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Diga com entusiasmo em português de Moçambique: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      const audioUrl = `data:audio/wav;base64,${base64Audio}`;
      ttsCache[text] = audioUrl;
      return audioUrl;
    }
  } catch (error: any) {
    const isQuotaError = error?.message?.includes("429") || error?.message?.includes("RESOURCE_EXHAUSTED");
    
    if (isQuotaError) {
      console.warn("Gemini TTS Quota exceeded, using Web Speech API fallback for 5 minutes.");
      geminiCooldownUntil = Date.now() + 5 * 60 * 1000; // 5 minute cooldown
    } else {
      console.error("Error generating TTS (Gemini):", error);
    }
    
    return useWebSpeechFallback(text);
  }
  return null;
}

function useWebSpeechFallback(text: string): Promise<string | null> {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-PT'; 
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = phraseVolume;
      
      window.speechSynthesis.speak(utterance);
      resolve("fallback-used");
    });
  }
  return Promise.resolve(null);
}

let sfxVolume = 0.5;
let phraseVolume = 0.8;

export const setSfxVolume = (volume: number) => {
  sfxVolume = volume;
};

export const setPhraseVolume = (volume: number) => {
  phraseVolume = volume;
};

export const playSound = (soundName: keyof typeof SOUNDS) => {
  const audio = new Audio(SOUNDS[soundName]);
  audio.volume = sfxVolume;
  audio.play().catch(e => console.log("Audio play blocked:", e));
};

export const playPhrase = async (phrase: string) => {
  const audioUrl = await generateTTS(phrase);
  if (audioUrl && audioUrl !== "fallback-used") {
    const audio = new Audio(audioUrl);
    audio.volume = phraseVolume;
    audio.play().catch(e => console.log("Audio play blocked:", e));
  }
};

export const playThematicPhrase = (category: keyof typeof THEMATIC_PHRASES) => {
  const phrase = getRandomPhrase(category);
  playPhrase(phrase);
};
