import React, { useState, useRef, useEffect } from 'react';
import { VoiceName } from '../types';
import { Mic, Play, Square, Loader2, Volume2 } from 'lucide-react';
import { generateVoiceover } from '../services/geminiService';
import { getAudioContext, decodeAudioData } from '../services/audioUtils';

interface VoiceSelectorProps {
  selected: VoiceName;
  onSelect: (voice: VoiceName) => void;
}

const VOICE_META: Record<VoiceName, { label: string; desc: string; sample: string }> = {
  [VoiceName.Puck]: { label: "活泼调皮", desc: "像个淘气的小伙伴", sample: "嘿！我是Puck，我们去冒险吧！" },
  [VoiceName.Aoede]: { label: "甜美姐姐", desc: "温柔亲切的故事姐姐", sample: "小朋友你好，我是Aoede姐姐。" },
  [VoiceName.Kore]: { label: "知心阿姨", desc: "温暖治愈的声音", sample: "你好呀，让我给你讲个故事吧。" },
  [VoiceName.Fenrir]: { label: "沉稳爷爷", desc: "像老爷爷一样讲古", sample: "咳咳，很久很久以前..." },
  [VoiceName.Charon]: { label: "严肃老师", desc: "认真科普的历史老师", sample: "大家好，今天是历史课时间。" },
};

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({ selected, onSelect }) => {
  const [previewing, setPreviewing] = useState<VoiceName | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<VoiceName | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioSourceRef.current) {
        try { audioSourceRef.current.stop(); } catch (e) {}
      }
    };
  }, []);

  const handlePlayPreview = async (e: React.MouseEvent, voice: VoiceName) => {
    e.stopPropagation(); // Don't select when clicking play

    // If currently playing this voice, stop it
    if (previewing === voice) {
      if (audioSourceRef.current) {
        try { audioSourceRef.current.stop(); } catch (e) {}
        audioSourceRef.current = null;
      }
      setPreviewing(null);
      return;
    }

    // Stop any other playing voice
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch (e) {}
      audioSourceRef.current = null;
      setPreviewing(null);
    }

    setLoadingVoice(voice);

    try {
      const text = VOICE_META[voice].sample;
      // Generate short sample
      const audioData = await generateVoiceover(text, voice);
      
      const ctx = getAudioContext();
      // Resume if suspended (browser autoplay policy)
      if (ctx.state === 'suspended') await ctx.resume();

      const buffer = await decodeAudioData(new Uint8Array(audioData), ctx);
      
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      
      source.onended = () => {
        setPreviewing(null);
        audioSourceRef.current = null;
      };
      
      source.start();
      audioSourceRef.current = source;
      setPreviewing(voice);

    } catch (error) {
      console.error("Failed to play preview", error);
    } finally {
      setLoadingVoice(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
        <Mic size={16} />
        选择讲解员
      </label>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.values(VoiceName).map((voice) => {
          const meta = VOICE_META[voice];
          const isSelected = selected === voice;
          const isPlaying = previewing === voice;
          const isLoading = loadingVoice === voice;

          return (
            <div
              key={voice}
              onClick={() => onSelect(voice)}
              className={`
                relative flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200
                ${isSelected 
                  ? 'bg-indigo-50 border-indigo-500 shadow-md' 
                  : 'bg-white border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/50'
                }
              `}
            >
              {/* Radio Indicator */}
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
                ${isSelected ? 'border-indigo-500' : 'border-slate-300'}
              `}>
                {isSelected && <div className="w-2 h-2 rounded-full bg-indigo-500" />}
              </div>

              {/* Info */}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                    <span className={`font-bold text-sm ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>
                        {meta.label}
                    </span>
                    {isSelected && <span className="text-[10px] px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded-full font-medium">当前选择</span>}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{meta.desc}</div>
              </div>

              {/* Preview Button */}
              <button
                onClick={(e) => handlePlayPreview(e, voice)}
                disabled={isLoading || (previewing !== null && !isPlaying)}
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center transition-all
                  ${isPlaying 
                    ? 'bg-rose-500 text-white animate-pulse' 
                    : 'bg-slate-100 text-slate-500 hover:bg-indigo-100 hover:text-indigo-600'
                  }
                  ${isLoading ? 'opacity-70 cursor-wait' : ''}
                `}
                title="试听声音"
              >
                {isLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : isPlaying ? (
                  <Square size={12} fill="currentColor" />
                ) : (
                  <Volume2 size={14} />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
