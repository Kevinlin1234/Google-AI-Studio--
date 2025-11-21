import React, { useState, useEffect, useRef } from 'react';
import { Story, Scene } from '../types';
import { getAudioContext, decodeAudioData } from '../services/audioUtils';
import { generateStoryVideo } from '../services/videoRecorder';
import { generateVeoScene, generateVeoSequence, generateCoverImage, checkVeoSetup } from '../services/geminiService';
import { addTitleToCover } from '../services/imageProcessor';
import { ChevronLeft, ChevronRight, Play, Pause, RefreshCw, Volume2, Expand, Shrink, Download, Video, Share2, CheckCircle, Sparkles, Loader2, Film, X, Image as ImageIcon, Wand2, Eye, PlayCircle, Layers, Clock } from 'lucide-react';
import { Button } from './Button';
import { motion, AnimatePresence } from 'framer-motion';

interface StoryPlayerProps {
  story: Story;
  onBack: () => void;
  isImmersive: boolean;
  toggleImmersive: () => void;
}

export const StoryPlayer: React.FC<StoryPlayerProps> = ({ story, onBack, isImmersive, toggleImmersive }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Export States
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatus, setExportStatus] = useState('');
  
  // Veo Generation States
  const [isVeoLoading, setIsVeoLoading] = useState(false);
  const [isTransitionLoading, setIsTransitionLoading] = useState(false);
  const [veoError, setVeoError] = useState<string | null>(null);
  
  // Batch Generation State
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');

  // Menus
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showMagicMenu, setShowMagicMenu] = useState(false);
  const [publishedPlatform, setPublishedPlatform] = useState<string | null>(null);

  // Cover Selection States
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<string[]>([]);
  const [selectedCover, setSelectedCover] = useState<string | null>(null);
  const [isGeneratingCovers, setIsGeneratingCovers] = useState(false);
  const [pendingExportPlatform, setPendingExportPlatform] = useState<string | undefined>(undefined);

  // Transition & Full Video Preview
  const [showTransitionPreview, setShowTransitionPreview] = useState(false);
  const [fullVideoUrl, setFullVideoUrl] = useState<string | null>(null);

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const transitionVideoRef = useRef<HTMLVideoElement | null>(null);

  // Safeguard against empty stories
  if (!story || !story.scenes || story.scenes.length === 0) {
      return <div className="text-white">故事加载错误</div>;
  }

  const currentScene = story.scenes[currentIndex];
  const nextScene = story.scenes[currentIndex + 1];
  const isVertical = story.aspectRatio === '9:16';

  // Initialize Audio Context & Cover
  useEffect(() => {
    audioContextRef.current = getAudioContext();
    
    // Initialize cover candidates with the story's default cover if available
    if (story.coverImage) {
        setCoverCandidates([story.coverImage]);
        setSelectedCover(story.coverImage);
    }

    return () => {
      stopAudio();
    };
  }, [story.coverImage]);

  // Handle Scene Change
  useEffect(() => {
    stopAudio();
    setIsPlaying(false);
    setVeoError(null);
    setShowTransitionPreview(false);
  }, [currentIndex]);

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {
        // ignore if already stopped
      }
      sourceNodeRef.current = null;
    }
  };

  const playAudio = async () => {
    if (!currentScene.audioData || !audioContextRef.current) return;

    // Ensure context is running (browser policy)
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    stopAudio();

    try {
      const audioDataCopy = currentScene.audioData.slice(0);
      
      const audioBuffer = await decodeAudioData(
        new Uint8Array(audioDataCopy),
        audioContextRef.current
      );

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      
      source.onended = () => setIsPlaying(false);
      
      sourceNodeRef.current = source;
      source.start();
      setIsPlaying(true);
      
      // Also play video if available
      if (videoRef.current) {
          videoRef.current.currentTime = 0;
          videoRef.current.play().catch(() => {});
      }

    } catch (error) {
      console.error("Error playing audio", error);
      setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    if (isPlaying) {
      stopAudio();
      if (videoRef.current) videoRef.current.pause();
      setIsPlaying(false);
    } else {
      playAudio();
    }
  };

  const handleNext = () => {
    if (currentIndex < story.scenes.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleGenerateVeo = async () => {
      if (isVeoLoading || currentScene.videoUrl) return;

      setIsVeoLoading(true);
      setVeoError(null);

      try {
          const videoUrl = await generateVeoScene(
              currentScene.visual_prompt, 
              story.aspectRatio,
              currentScene.imageData
          );

          if (videoUrl) {
              currentScene.videoUrl = videoUrl;
          } else {
              setVeoError("视频生成失败，请重试");
          }
      } catch (e) {
          console.error(e);
          setVeoError("连接失败");
      } finally {
          setIsVeoLoading(false);
      }
  };

  const handleGenerateTransition = async () => {
      if (isTransitionLoading || currentScene.transitionVideoUrl || !nextScene || !currentScene.imageData || !nextScene.imageData) return;
      
      setIsTransitionLoading(true);
      setVeoError(null);
      
      try {
          // Try to use 3 images for context if available
          const nextNextScene = story.scenes[currentIndex + 2];
          const images = [currentScene.imageData, nextScene.imageData];
          if (nextNextScene && nextNextScene.imageData) {
              images.push(nextNextScene.imageData);
          }

          const transitionUrl = await generateVeoSequence(
              images,
              story.aspectRatio
          );
          
          if (transitionUrl) {
              currentScene.transitionVideoUrl = transitionUrl;
          } else {
              setVeoError("转场生成失败");
          }
      } catch (e) {
          console.error(e);
          setVeoError("转场生成出错");
      } finally {
          setIsTransitionLoading(false);
      }
  };

  // --- Batch Generation ---
  const handleBatchGenerateTransitions = async () => {
      setShowMagicMenu(false);
      
      // Check/Prompt for API key once before starting
      const ready = await checkVeoSetup();
      if (!ready) return;

      setIsBatchGenerating(true);
      let successCount = 0;
      const totalTransitions = story.scenes.length - 1;

      // Iterate through all scenes
      for (let i = 0; i < totalTransitions; i++) {
          const scene = story.scenes[i];
          
          // Skip if already exists
          if (scene.transitionVideoUrl) {
              successCount++;
              continue;
          }

          setBatchProgress(`正在生成转场 ${i+1} / ${totalTransitions} (Veo)...`);

          // Collect images: [Current, Next] + (NextNext if available for context)
          // This utilizes the 3-image capability of Veo 3.1 if possible
          const images: string[] = [];
          if (scene.imageData) images.push(scene.imageData);
          if (story.scenes[i+1]?.imageData) images.push(story.scenes[i+1].imageData!);
          if (story.scenes[i+2]?.imageData) images.push(story.scenes[i+2].imageData!);
          
          if (images.length < 2) continue; // Need at least 2

          // Generate
          try {
              const url = await generateVeoSequence(images, story.aspectRatio);
              if (url) {
                  scene.transitionVideoUrl = url;
                  successCount++;
              }
          } catch (e) {
              console.error(`Failed to generate transition for scene ${i}`, e);
          }

          // Handle Rate Limit (RPM 2)
          // If we are not at the end, wait for ~35 seconds
          if (i < totalTransitions - 1) {
              for (let s = 35; s > 0; s--) {
                  setBatchProgress(`冷却中 (RPM限制): 剩余 ${s} 秒...`);
                  await new Promise(r => setTimeout(r, 1000));
              }
          }
      }
      
      setIsBatchGenerating(false);
      if (successCount === totalTransitions) {
          alert("所有转场生成完毕！您可以预览拼接全片了。");
      } else {
          alert(`转场生成结束，成功 ${successCount}/${totalTransitions}`);
      }
  };

  const handlePreviewFullVideo = async () => {
      setShowMagicMenu(false);
      if (isExporting) return;

      setIsExporting(true);
      setExportProgress(0);
      setExportStatus("正在拼接全片预览...");
      
      try {
          // Reuse the recorder logic but resolve directly to blob
          const blob = await generateStoryVideo(story, (prog, status) => {
              setExportProgress(prog);
              setExportStatus(status);
          }, selectedCover || story.coverImage);

          const url = URL.createObjectURL(blob);
          setFullVideoUrl(url);

      } catch (e) {
          console.error("Preview generation failed", e);
          alert("预览生成失败");
      } finally {
          setIsExporting(false);
      }
  };

  const handleOpenExport = (targetPlatform?: string) => {
      setPendingExportPlatform(targetPlatform);
      setShowShareMenu(false);
      stopAudio();
      if (!selectedCover && coverCandidates.length > 0) {
          setSelectedCover(coverCandidates[0]);
      }
      setShowCoverModal(true);
  };

  const handleRegenerateCovers = async () => {
      setIsGeneratingCovers(true);
      try {
        const rawImages = await generateCoverImage(story.title, story.aspectRatio, 4);
        const processed = await Promise.all(rawImages.map(img => 
            addTitleToCover(img, story.title, story.aspectRatio)
        ));
        
        setCoverCandidates(processed);
        if (processed.length > 0) {
            setSelectedCover(processed[0]);
        }
      } catch (e) {
          console.error(e);
          alert("封面生成失败，请检查网络设置");
      } finally {
          setIsGeneratingCovers(false);
      }
  };

  const handleConfirmExport = async () => {
      setShowCoverModal(false);
      await handleExportVideo(pendingExportPlatform, selectedCover || undefined);
  };

  const handleExportVideo = async (targetPlatform?: string, customCover?: string) => {
    if (isExporting) return;
    
    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('准备生成视频 (MP4)...');
    setPublishedPlatform(null);

    try {
      const blob = await generateStoryVideo(story, (prog, status) => {
        setExportProgress(prog);
        setExportStatus(status);
      }, customCover);

      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${story.title}-${story.aspectRatio === '9:16' ? 'mobile' : 'desktop'}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (targetPlatform) {
          setPublishedPlatform(targetPlatform);
      }

    } catch (error) {
      console.error("Export failed", error);
      alert("导出视频失败，请重试");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={`relative w-full h-full min-h-screen flex flex-col items-center justify-center overflow-hidden transition-colors duration-500 ${isImmersive ? 'text-white bg-black' : 'text-slate-800 bg-slate-100'}`}>
      
      {/* Immersive Background */}
      {isImmersive && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
          className="fixed inset-0 z-0"
        >
           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-10" />
           {currentScene.videoUrl ? (
              <img 
                src={`data:image/png;base64,${currentScene.imageData}`} 
                alt="bg" 
                className="w-full h-full object-cover filter blur-2xl scale-110 opacity-60"
              />
           ) : currentScene.imageData ? (
             <img 
              src={`data:image/png;base64,${currentScene.imageData}`} 
              alt="bg" 
              className="w-full h-full object-cover filter blur-2xl scale-110 opacity-60"
             />
           ) : null}
        </motion.div>
      )}

      {/* Header Controls */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-20">
        <Button onClick={onBack} variant={isImmersive ? "secondary" : "ghost"} size="sm">
          <ChevronLeft size={16} />
          返回
        </Button>
        <h2 className={`text-xl font-bold drop-shadow-md hidden md:block ${isImmersive ? 'text-white' : 'text-slate-700'}`}>{story.title}</h2>
        <div className="flex gap-2 relative">
          
          {/* Magic Tools Menu */}
          <div className="relative">
              <Button
                onClick={() => setShowMagicMenu(!showMagicMenu)}
                disabled={isBatchGenerating || isExporting}
                variant={isImmersive ? "secondary" : "ghost"}
                size="sm"
                className="text-indigo-500"
              >
                  <Wand2 size={18} /> <span className="hidden sm:inline">魔法工具</span>
              </Button>

              <AnimatePresence>
                {showMagicMenu && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute right-0 top-12 bg-white text-slate-800 rounded-xl shadow-xl border border-slate-100 p-2 min-w-[220px] z-50 overflow-hidden"
                    >
                        <div className="text-xs font-bold text-slate-400 px-3 py-2">AI 增强功能</div>
                        
                        <button 
                            onClick={handleBatchGenerateTransitions}
                            className="w-full text-left px-3 py-2 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-sm font-medium text-indigo-600"
                        >
                            <Layers size={16} />
                            一键生成所有转场 (Veo)
                        </button>

                        <button 
                            onClick={handlePreviewFullVideo}
                            className="w-full text-left px-3 py-2 hover:bg-amber-50 rounded-lg flex items-center gap-2 text-sm font-medium text-amber-600 mt-1"
                        >
                            <PlayCircle size={16} />
                            拼接预览全片
                        </button>
                    </motion.div>
                )}
              </AnimatePresence>
          </div>

          {/* Share / Export */}
          <div className="relative">
            <Button 
                onClick={() => setShowShareMenu(!showShareMenu)} 
                disabled={isExporting || isBatchGenerating}
                variant={isImmersive ? "secondary" : "ghost"}
                size="sm"
            >
                <Share2 size={18} /> 发布
            </Button>

            <AnimatePresence>
                {showShareMenu && (
                    <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute right-0 top-12 bg-white text-slate-800 rounded-xl shadow-xl border border-slate-100 p-2 min-w-[200px] z-50 overflow-hidden"
                    >
                         <div className="text-xs font-bold text-slate-400 px-3 py-2">一键发布 (MP4)</div>
                         <button 
                            onClick={() => handleOpenExport('抖音')}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg flex items-center gap-2 text-sm font-medium"
                         >
                            <span className="w-5 h-5 bg-black text-white rounded-full flex items-center justify-center text-[10px]">🎵</span>
                            发布到抖音
                         </button>
                         <button 
                            onClick={() => handleOpenExport('小红书')}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg flex items-center gap-2 text-sm font-medium"
                         >
                            <span className="w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-[10px]">📕</span>
                            发布到小红书
                         </button>
                         <div className="h-px bg-slate-100 my-1"></div>
                         <button 
                            onClick={() => handleOpenExport()}
                            className="w-full text-left px-3 py-2 hover:bg-slate-50 rounded-lg flex items-center gap-2 text-sm text-slate-600"
                         >
                            <Download size={14} />
                            仅下载视频
                         </button>
                    </motion.div>
                )}
            </AnimatePresence>
          </div>

          <button 
            onClick={toggleImmersive}
            className={`p-2 rounded-full transition-colors ${isImmersive ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}
            title="沉浸模式"
          >
            {isImmersive ? <Shrink size={20} /> : <Expand size={20} />}
          </button>
        </div>
      </div>

      {/* Cover Selection Modal */}
      <AnimatePresence>
        {showCoverModal && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            >
                <motion.div 
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 20 }}
                    className="bg-white rounded-3xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl"
                >
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <div>
                            <h3 className="text-2xl font-bold text-slate-800">选择视频封面</h3>
                            <p className="text-slate-500 text-sm mt-1">封面将作为视频的第一帧展示</p>
                        </div>
                        <button onClick={() => setShowCoverModal(false)} className="p-2 hover:bg-slate-100 rounded-full">
                            <X size={24} className="text-slate-500" />
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                        {isGeneratingCovers ? (
                             <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-4">
                                 <Loader2 size={48} className="animate-spin text-indigo-500" />
                                 <p className="font-medium text-slate-600">正在设计新的封面...</p>
                             </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {coverCandidates.length === 0 && (
                                    <div className="col-span-full text-center py-8 text-slate-400">
                                        暂无封面，请点击下方按钮生成
                                    </div>
                                )}
                                {coverCandidates.map((img, idx) => (
                                    <div 
                                        key={idx} 
                                        onClick={() => setSelectedCover(img)}
                                        className={`relative rounded-xl overflow-hidden cursor-pointer aspect-[9/16] group border-4 transition-all ${selectedCover === img ? 'border-indigo-500 shadow-xl scale-[1.02]' : 'border-transparent hover:border-indigo-200'}`}
                                    >
                                        <img 
                                            src={`data:image/jpeg;base64,${img}`} 
                                            className="w-full h-full object-cover"
                                        />
                                        {selectedCover === img && (
                                            <div className="absolute inset-0 bg-indigo-500/20 flex items-center justify-center">
                                                <div className="bg-indigo-500 text-white p-2 rounded-full shadow-lg">
                                                    <CheckCircle size={24} />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    <div className="p-6 border-t border-slate-100 flex justify-between items-center bg-white">
                        <button 
                            onClick={handleRegenerateCovers}
                            disabled={isGeneratingCovers}
                            className="flex items-center gap-2 text-slate-600 font-bold hover:text-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-50 transition-colors"
                        >
                            <RefreshCw size={20} className={isGeneratingCovers ? "animate-spin" : ""} />
                            换一组封面
                        </button>
                        <div className="flex gap-3">
                            <Button variant="ghost" onClick={() => setShowCoverModal(false)}>取消</Button>
                            <Button 
                                onClick={handleConfirmExport} 
                                disabled={!selectedCover || isGeneratingCovers}
                            >
                                确认导出
                            </Button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Full Video Preview Modal */}
      <AnimatePresence>
          {fullVideoUrl && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            >
                <div className="w-full max-w-6xl flex flex-col items-center gap-4">
                    <div className="flex w-full justify-between text-white items-center">
                        <h3 className="text-xl font-bold flex items-center gap-2">
                            <PlayCircle className="text-amber-400" /> 全片拼接预览
                        </h3>
                        <button onClick={() => setFullVideoUrl(null)} className="p-2 hover:bg-white/20 rounded-full">
                            <X size={24} />
                        </button>
                    </div>
                    
                    <div className={`relative rounded-2xl overflow-hidden bg-black border-2 border-slate-700 shadow-2xl
                         ${story.aspectRatio === '9:16' ? 'h-[80vh] aspect-[9/16]' : 'w-full aspect-video'}
                    `}>
                         <video 
                            src={fullVideoUrl}
                            controls
                            autoPlay
                            className="w-full h-full object-contain"
                         />
                    </div>
                    
                    <Button onClick={() => handleOpenExport()} className="mt-2 shadow-amber-500/50">
                        <Download size={18} /> 导出视频
                    </Button>
                </div>
            </motion.div>
          )}
      </AnimatePresence>

      {/* Published Success Modal */}
      <AnimatePresence>
        {publishedPlatform && (
            <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none"
            >
                <div className="bg-white p-6 rounded-2xl shadow-2xl border-2 border-green-500 flex flex-col items-center gap-4 pointer-events-auto">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600">
                        <CheckCircle size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800">视频已生成!</h3>
                    <p className="text-slate-500 text-center max-w-xs">
                        视频已保存到你的设备。你可以直接打开 
                        <strong className="text-slate-800 mx-1">{publishedPlatform}</strong> 
                        上传刚刚下载的视频。
                    </p>
                    <Button onClick={() => setPublishedPlatform(null)} size="sm">我知道了</Button>
                </div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Main Stage */}
      <div className={`flex flex-col items-center gap-6 p-4 z-10 w-full transition-all duration-500 ${isVertical ? 'max-w-md h-[85vh]' : 'max-w-5xl'}`}>
        
        {/* Image/Video Container */}
        <div 
            className={`relative w-full bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border-4 border-white/50 flex-shrink-0 transition-all
                ${isVertical ? 'aspect-[9/16] h-full max-h-[65vh]' : 'aspect-video'}
            `}
        >
          <AnimatePresence mode="wait">
             {/* Normal Scene View */}
             {!showTransitionPreview && (
                <motion.div
                key={`scene-${currentIndex}`}
                initial={{ opacity: 0, scale: 1.1 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full h-full bg-black absolute inset-0"
                >
                    {currentScene.videoUrl ? (
                        <video 
                            ref={videoRef}
                            src={currentScene.videoUrl} 
                            className="w-full h-full object-cover"
                            loop
                            muted
                            playsInline
                        />
                    ) : currentScene.imageData ? (
                        <img 
                        src={`data:image/png;base64,${currentScene.imageData}`} 
                        alt={`Scene ${currentIndex + 1}`} 
                        className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-400 flex-col gap-2">
                            <Loader2 className="animate-spin" />
                            <div>正在绘制历史画面...</div>
                        </div>
                    )}
                </motion.div>
             )}

             {/* Transition Preview Overlay */}
             {showTransitionPreview && currentScene.transitionVideoUrl && (
                 <motion.div
                    key="transition-preview"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-30 bg-black"
                 >
                     <video 
                        ref={transitionVideoRef}
                        src={currentScene.transitionVideoUrl}
                        className="w-full h-full object-cover"
                        autoPlay
                        playsInline
                        onEnded={() => setShowTransitionPreview(false)} // Auto close on end
                        controls
                     />
                     <button 
                        onClick={() => setShowTransitionPreview(false)}
                        className="absolute top-4 right-4 p-2 bg-black/50 text-white rounded-full hover:bg-black/70"
                     >
                         <X size={20} />
                     </button>
                 </motion.div>
             )}
          </AnimatePresence>
          
          {/* Veo Controls Overlay - Bottom Right */}
          {!isExporting && !showTransitionPreview && !isBatchGenerating && (
             <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
                
                {/* 1. Magic Animate Current Scene */}
                {!currentScene.videoUrl && currentScene.imageData && (
                    <button
                        onClick={handleGenerateVeo}
                        disabled={isVeoLoading}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg backdrop-blur-md transition-all
                            ${isVeoLoading 
                            ? 'bg-slate-800/80 text-slate-400 cursor-wait' 
                            : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:scale-105 hover:shadow-purple-500/30'
                            }
                        `}
                    >
                        {isVeoLoading ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>生成动画中...</span>
                            </>
                        ) : (
                            <>
                                <Film size={16} />
                                <span>变身动态视频 (Veo)</span>
                            </>
                        )}
                    </button>
                )}

                {/* 2. Magic Transition to Next Scene */}
                {nextScene && (
                    <div className="flex items-center gap-2">
                        {currentScene.transitionVideoUrl ? (
                             <button
                                onClick={() => setShowTransitionPreview(true)}
                                className="flex items-center gap-2 px-4 py-2 rounded-full shadow-lg backdrop-blur-md bg-white/20 text-white hover:bg-white/30 border border-white/30"
                             >
                                 <Eye size={16} />
                                 <span>预览转场</span>
                             </button>
                        ) : (
                            <button
                                onClick={handleGenerateTransition}
                                disabled={isTransitionLoading}
                                className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg backdrop-blur-md transition-all
                                    ${isTransitionLoading
                                    ? 'bg-slate-800/80 text-slate-400 cursor-wait' 
                                    : 'bg-gradient-to-r from-pink-500 to-rose-600 text-white hover:scale-105 hover:shadow-pink-500/30'
                                    }
                                `}
                            >
                                {isTransitionLoading ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        <span>制作转场中...</span>
                                    </>
                                ) : (
                                    <>
                                        <Wand2 size={16} />
                                        <span>生成场景转场 (Veo)</span>
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                )}

                {veoError && (
                    <div className="bg-red-500 text-white text-xs px-2 py-1 rounded shadow-md whitespace-nowrap">
                        {veoError}
                    </div>
                )}
             </div>
          )}

          {/* Scene Indicator */}
          <div className="absolute top-4 right-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm font-bold backdrop-blur-md z-20">
            场景 {currentIndex + 1} / {story.scenes.length}
          </div>

          {/* Loading Overlay (Export / Batch) */}
          {(isExporting || isBatchGenerating) && (
             <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-white p-6 text-center">
                <Wand2 size={48} className="mb-4 text-purple-400 animate-pulse" />
                <div className="text-xl font-bold mb-2">
                    {isBatchGenerating ? '正在施展魔法...' : '正在制作大片'}
                </div>
                <div className="text-sm text-slate-300 mb-6 font-mono">
                    {isBatchGenerating ? batchProgress : exportStatus}
                </div>
                <div className="w-full max-w-[200px] h-2 bg-slate-700 rounded-full overflow-hidden">
                  {isExporting && (
                    <div 
                        className="h-full bg-amber-400 transition-all duration-300" 
                        style={{ width: `${exportProgress}%` }}
                    />
                  )}
                  {isBatchGenerating && (
                      <div className="h-full bg-purple-500 animate-indeterminate-bar w-1/2 mx-auto rounded-full" />
                  )}
                </div>
                <p className="mt-4 text-xs text-slate-400 max-w-xs">
                    {isBatchGenerating ? 'Veo模型每分钟限制生成2次，我们将自动为您排队处理，请耐心等待...' : 'AI 导演正在剪辑视频...'}
                </p>
             </div>
          )}
        </div>

        {/* Text & Audio Controls */}
        <motion.div 
          key={`text-${currentIndex}`}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={`w-full p-4 md:p-6 rounded-3xl shadow-xl border border-white/20 backdrop-blur-md transition-colors duration-500
            ${isImmersive ? 'bg-black/40 text-white' : 'bg-white/80 text-slate-800'}
            flex flex-col gap-4
          `}
        >
          <div className="flex items-start gap-4">
            <button 
              onClick={togglePlay}
              className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95
                ${isPlaying ? 'bg-rose-500 text-white' : 'bg-amber-400 text-white hover:bg-amber-500'}`}
            >
              {isPlaying ? <Pause size={24} /> : <Volume2 size={24} />}
            </button>
            
            <div className="flex-1 overflow-y-auto max-h-[100px] md:max-h-none pr-2 scrollbar-thin">
               <p className="text-base md:text-xl leading-relaxed font-medium font-serif">
                 {currentScene.narration}
               </p>
            </div>
          </div>
          
          {/* Navigation */}
          <div className="flex gap-4 w-full justify-between pt-2 border-t border-slate-200/20">
            <Button 
                onClick={handlePrev} 
                disabled={currentIndex === 0}
                variant={isImmersive ? 'secondary' : 'ghost'}
                size="sm"
                className={currentIndex === 0 ? 'invisible' : ''}
            >
                <ChevronLeft size={16} /> 上一页
            </Button>
            
            <Button 
                onClick={handleNext} 
                disabled={currentIndex === story.scenes.length - 1}
                variant="primary"
                size="sm"
                className={currentIndex === story.scenes.length - 1 ? 'invisible' : ''}
            >
                下一页 <ChevronRight size={16} />
            </Button>
            </div>
        </motion.div>

      </div>
    </div>
  );
};